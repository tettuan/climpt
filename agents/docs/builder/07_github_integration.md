# GitHub Integration Guide

## 概要

Agent は GitHub Issue / PR を読み書きする必要があるが、sandbox 環境下で `gh` CLI
を直接実行することはできない。
ネットワークアクセスと書き込み操作のセキュリティを確保するため、GitHub
連携は以下の3層モデルで提供される。

```
+---------------------------+     読み取り専用
|  GitHubRead MCP Tool      |  <-- Agent が直接呼び出せる唯一の手段
+---------------------------+
            |
+---------------------------+     書き込み (自動)
|  Boundary Hook            |  <-- closure step の intent に連動
+---------------------------+
            |
+---------------------------+     書き込み (制御)
|  Orchestrator / Handoff   |  <-- workflow 定義に基づく
+---------------------------+
            |
+---------------------------+     直接実行
|  sandbox / tool-policy    |  <-- 全てブロック
+---------------------------+
```

- `gh` CLI への依存度が高い理由: Orchestrator と Boundary Hook は内部で `gh`
  を呼び出して GitHub API を操作する。Agent 自身は MCP
  ツール経由でのみ読み取りが可能。
- Agent が `gh` を直接実行できない理由: sandbox のネットワーク制限と tool-policy
  の bash パターンブロックにより、Agent プロセスからの直接実行は全て拒否される。

## 前提条件

### gh CLI インストール

```bash
brew install gh
```

### 認証

```bash
gh auth login
```

必要なスコープ:

| スコープ  | 用途                   |
| --------- | ---------------------- |
| `repo`    | Issue / PR の読み書き  |
| `project` | GitHub Projects の参照 |

### リポジトリコンテキスト

Agent 実行ディレクトリが git リポジトリのルートであること。`gh`
はカレントディレクトリの remote 設定から owner/repo を自動解決する。

## 3層アクセスモデル

### 読み取り: GitHubRead MCP ツール

ツール名: `mcp__github__github_read`

このツールは Agent の tool 定義に自動注入される。`agent.json`
への手動追加は不要。

#### operation 一覧

| operation           | 必須パラメータ | オプション                                  | --json fields                                                    |
| ------------------- | -------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `issue_view`        | `number`       | --                                          | `number,title,body,labels,state,assignees,milestone,comments`    |
| `issue_list`        | --             | `state` (open/closed/all), `label`, `limit` | `number,title,labels,state`                                      |
| `pr_view`           | `number`       | --                                          | `number,title,body,labels,state,mergeable,reviewDecision,checks` |
| `pr_list`           | --             | `state` (open/closed/merged/all), `limit`   | `number,title,labels,state,headRefName`                          |
| `pr_diff`           | `number`       | --                                          | (raw diff)                                                       |
| `pr_checks`         | `number`       | --                                          | (check status)                                                   |
| `project_view`      | `number`       | `owner`                                     | (json format)                                                    |
| `project_list`      | --             | `owner`, `limit`                            | (json format)                                                    |
| `project_item_list` | `number`       | `owner`, `limit`                            | (json format)                                                    |

#### 使用例

```json
{
  "tool": "mcp__github__github_read",
  "input": {
    "operation": "issue_view",
    "number": 42
  }
}
```

```json
{
  "tool": "mcp__github__github_read",
  "input": {
    "operation": "pr_list",
    "state": "open",
    "limit": 10
  }
}
```

### 書き込み: Boundary Hook

Boundary Hook は closure step の closing intent が発火した時点で自動実行される。

#### 発火条件

以下の3経路のいずれかで発火する:

1. **Structured signal**: closure step の structured output に
   `next_action.action === "closing"` が含まれる場合
   (completion-loop-processor.ts:140)
2. **Router の closingReason**: Router が closing reason を返した場合
   (completion-loop-processor.ts:174)
3. **VerdictHandler の `isFinished()`**: handler の `isFinished()` が `true`
   を返した場合 (completion-loop-processor.ts:188)

#### 実行される操作

`defaultClosureAction` に応じて以下の分岐で実行される:

- `close`: Issue クローズのみ (ラベル変更なし)
- `label-only`: `labels.completion` に基づくラベル更新のみ (Issue
  はクローズしない)
- `label-and-close`: `labels.completion` に基づくラベル更新後、Issue をクローズ

#### エラーハンドリング

ラベル更新と Issue クローズの両操作は Non-fatal である。`gh` コマンド失敗時は
catch して無視し、Agent の実行を継続する。

#### defaultClosureAction

| 値                | 動作                                           |
| ----------------- | ---------------------------------------------- |
| `close`           | Issue をクローズ (ラベル変更なし) (デフォルト) |
| `label-only`      | ラベル変更のみ。Issue は OPEN のまま           |
| `label-and-close` | ラベル変更後に Issue をクローズ                |

**優先順位**: AI structured output の `closure_action` フィールド >
`defaultClosureAction` > `"close"`

closure step の structured output に `closure_action` フィールド (`"close"` /
`"label-only"` / `"label-and-close"`) を含めることで、config の
`defaultClosureAction` を動的に上書きできる。

### 書き込み: Orchestrator / Handoff

#### Orchestrator の GitHubClient 操作一覧

| メソッド            | 説明                   | 内部コマンド                                   |
| ------------------- | ---------------------- | ---------------------------------------------- |
| `getIssueLabels`    | Issue のラベル取得     | `gh issue view <N> --json labels`              |
| `updateIssueLabels` | Issue のラベル更新     | `gh issue edit <N> --add-label/--remove-label` |
| `addIssueComment`   | Issue へのコメント追加 | `gh issue comment <N> --body <comment>`        |
| `createIssue`       | 新規 Issue 作成        | `gh issue create`                              |
| `closeIssue`        | Issue のクローズ       | `gh issue close <N>`                           |
| `listIssues`        | Issue 一覧取得         | `gh issue list --json ...`                     |
| `getIssueDetail`    | Issue 詳細取得         | `gh issue view <N> --json ...`                 |

#### コメント投稿の経路

Issue コメントは以下の2経路で投稿される。いずれも Orchestrator 層の内部であり、
ホストプロセス（サンドボックス外）で `gh issue comment` を実行する。

| 経路            | 主導者       | 用途                                                  | 実装                               |
| --------------- | ------------ | ----------------------------------------------------- | ---------------------------------- |
| Handoff Manager | Orchestrator | 定型の handoff 通知（`commentTemplates` で定義）      | `orchestrator/handoff-manager.ts`  |
| OutboxProcessor | Agent        | Agent が任意に投稿するコメント（outbox に JSON 出力） | `orchestrator/outbox-processor.ts` |

実行順序: Agent dispatch 完了後に OutboxProcessor（Step 7b,
`orchestrator.ts:269`） → Handoff Manager（Step 12,
`orchestrator.ts:370`）の順で実行される。

#### Handoff Manager によるコメント投稿

Orchestrator の Handoff 時に `workflow.json` の `commentTemplates`
で定義されたテンプレートを使用して Issue にコメントを投稿する。
`commentTemplates` は `agent.json` ではなく `workflow.json` の `handoff`
セクションに記述する。

#### commentTemplates の設定方法

テンプレート命名規則:

1. `{agentId}{Outcome}` を先に検索 (例: `reviewerApproved`)
2. 見つからない場合 `{agentId}To{Outcome}` を検索 (例: `iteratorToReviewer`)

利用可能な変数:

| 変数            | 説明                                     |
| --------------- | ---------------------------------------- |
| `{session_id}`  | 現在のセッション ID                      |
| `{issue_count}` | 現在の実装では常に `1` (単一 Issue 処理) |
| `{summary}`     | 実行結果の要約                           |

設定例:

```json
{
  "commentTemplates": {
    "reviewerApproved": "Review approved. Session: {session_id}. Summary: {summary}",
    "iteratorToReviewer": "Iteration complete ({issue_count} issues). Handing off to reviewer."
  }
}
```

### 直接実行: 禁止

Agent から GitHub API への直接アクセスは2段階でブロックされる。

#### sandbox によるネットワークブロック

sandbox 設定により、Agent プロセスからの外部ネットワークアクセスが制限される。

> **注記**: `excludedCommands` は意図的に空である。sandbox
> をバイパスするコマンドは存在しない設計。

#### tool-policy による bash パターンブロック

以下のパターンが tool-policy
でブロックされる（実装上は20の正規表現エントリ。下表では論理グループとして記載）:

| #  | パターン                                                                                  |
| -- | ----------------------------------------------------------------------------------------- |
| 1  | `gh issue close`                                                                          |
| 2  | `gh issue delete`                                                                         |
| 3  | `gh issue transfer`                                                                       |
| 4  | `gh issue reopen`                                                                         |
| 5  | `gh issue edit --state closed`                                                            |
| 6  | `gh pr close`                                                                             |
| 7  | `gh pr merge`                                                                             |
| 8  | `gh pr ready`                                                                             |
| 9  | `gh release create`                                                                       |
| 10 | `gh release edit`                                                                         |
| 11 | `gh api`                                                                                  |
| 12 | `curl`/`wget`/`python`/`python2`/`python3`/`node`/`ruby`/`perl`/`deno` + `api.github.com` |
| 13 | JSON `state:closed` ペイロード                                                            |

> **注記**: `gh issue comment` は意図的にブロック対象外である。コメント投稿は
> Handoff Manager および OutboxProcessor がホストプロセスで実行するため、 Agent
> からの直接実行は sandbox のネットワークブロックのみで防止される。

> **注記**: Closure step を含む全 step kind で `blockBoundaryBash: true`
> が設定されている。Closure step
> でも有効な理由は、`defaultClosureAction: "label-only"`
> のバイパスを防止するためである。

## 設定リファレンス

### runner.integrations.github

```json
{
  "runner": {
    "integrations": {
      "github": {
        "enabled": true,
        "labels": {
          "requirements": "docs",
          "inProgress": "in-progress",
          "blocked": "need clearance",
          "completion": {
            "add": ["done"],
            "remove": ["in-progress"]
          }
        },
        "defaultClosureAction": "close"
      }
    }
  }
}
```

| フィールド                 | 型       | 説明                                                                                                                                                |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                  | boolean  | GitHub 連携の有効化。`false` の場合、GitHubRead MCP ツールの注入、Boundary Hook の GitHub 操作、closure prompt の adaptation がすべてスキップされる |
| `labels.requirements`      | string   | 要件ラベル                                                                                                                                          |
| `labels.inProgress`        | string   | 作業中ラベル                                                                                                                                        |
| `labels.blocked`           | string   | ブロック中ラベル                                                                                                                                    |
| `labels.completion.add`    | string[] | 完了時に追加するラベル                                                                                                                              |
| `labels.completion.remove` | string[] | 完了時に削除するラベル                                                                                                                              |
| `defaultClosureAction`     | string   | closure 時の動作 (下表参照)                                                                                                                         |

詳細は [02_agent_definition.md](./02_agent_definition.md) の
`runner.integrations.github` セクションを参照。

### workflow.json の handoff

```json
{
  "handoff": {
    "commentTemplates": {
      "reviewerApproved": "Review approved. Session: {session_id}.",
      "iteratorToReviewer": "Iteration complete. Issues: {issue_count}."
    }
  }
}
```

## Worktree PR 作成

worktree 環境で作業が完了すると、`createPr` オプションが有効かつ `autoMerge`
が無効の場合に、worktree ブランチをリモートに push してから PR を作成する。

内部では以下の `gh` コマンドが実行される:

```bash
gh pr create --head <worktree-branch> --base <base-branch> --fill
```

`--fill` により、コミットメッセージから PR タイトル・本文が自動生成される。

## 実装ファイル一覧

| コンポーネント         | パス                                       |
| ---------------------- | ------------------------------------------ |
| GitHubRead MCP Tool    | `agents/runner/github-read-tool.ts`        |
| Tool Policy            | `agents/common/tool-policy.ts`             |
| Sandbox Defaults       | `agents/runner/sandbox-defaults.ts`        |
| Boundary Hook          | `agents/runner/boundary-hooks.ts`          |
| External State Adapter | `agents/verdict/external-state-adapter.ts` |
| Handoff Manager        | `agents/orchestrator/handoff-manager.ts`   |
| Outbox Processor       | `agents/orchestrator/outbox-processor.ts`  |
| GitHub Client          | `agents/orchestrator/github-client.ts`     |
| Query Executor         | `agents/runner/query-executor.ts`          |
| Worktree               | `agents/common/worktree.ts`                |

## 関連ドキュメント

- [02_agent_definition.md](./02_agent_definition.md) -- Agent 定義ファイルの構造
- [05_troubleshooting.md](./05_troubleshooting.md) -- トラブルシューティング
- [06_workflow_setup.md](./06_workflow_setup.md) -- Workflow 設定
