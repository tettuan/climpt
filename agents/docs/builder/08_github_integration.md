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
|  BoundaryHook            |  <-- closure step の intent に連動
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

- `gh` CLI への依存度が高い理由: Orchestrator と BoundaryHook は内部で `gh`
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

### 書き込み: BoundaryHook

BoundaryHook は closure step の closing intent が発火した時点で自動実行される。

#### 発火条件

以下の3経路のいずれかで発火する:

1. **Structured signal**: closure step の structured output に
   `next_action.action === "closing"` が含まれる場合
   (completion-loop-processor.ts:140)
2. **Router の closingReason**: Router が closing reason を返した場合
   (completion-loop-processor.ts:174)
3. **VerdictHandler の `isFinished()`**: handler の `isFinished()` が `true`
   を返した場合 (completion-loop-processor.ts:188)

#### 実行される操作と closure_action

closure step の structured output が制御するフィールド（`closure_action`,
`verdict`, `issue.labels`）、優先順位、ラベルのマージ動作の詳細は
[09_closure_output_contract.md](./09_closure_output_contract.md) を参照。

#### エラーハンドリング

ラベル更新と Issue クローズの両操作は Non-fatal である。`gh` コマンド失敗時は
catch して無視し、Agent の実行を継続する。

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

フレームワーク固定の変数は存在しない。テンプレート変数は各 agent の closure step
の `structuredGate.handoffFields` で指定されたフィールドから供給される。

| 要素   | 定義場所                                                             |
| ------ | -------------------------------------------------------------------- |
| 変数名 | `steps_registry.json` の closure step `structuredGate.handoffFields` |
| 変数値 | closure step の構造化出力（LLM が生成）                              |

未定義の変数はテンプレート中にそのまま残る（例: `{undefined_var}` →
`{undefined_var}`）。

設定例:

```json
{
  "commentTemplates": {
    "reviewerApproved": "## Review Approved\n\n{final_summary}",
    "iteratorToReviewer": "## Iteration Complete\n\n{final_summary}"
  }
}
```

> `final_summary` は closure step の schema に定義されたフィールド名の例。
> 実際の変数名は各 agent の `steps_registry.json` で `handoffFields` に
> 列挙したフィールド名に依存する。

### 直接実行: 禁止

Agent から GitHub API への直接アクセスは2段階でブロックされる。

#### sandbox によるネットワークブロック

sandbox 設定により、Agent プロセスからの外部ネットワークアクセスが制限される。

> **注記**: `excludedCommands` は意図的に空である。sandbox
> をバイパスするコマンドは存在しない設計。

#### tool-policy による bash パターンブロック

**方針**: Agent の bash から GitHub resource への **書き込み系 subcommand
を網羅的にブロック** する。BoundaryHook / OutboxProcessor / Orchestrator
のホストプロセス層が唯一の書き込み経路である
（`agents/runner/github-read-tool.ts:8-9` の明文宣言）。 読み取り系
(`view`/`list`/`diff`/`checks`) と workflow-continuation の create
(`gh issue create`, `gh pr create`) は素通り。

以下のパターン群が tool-policy でブロックされる （`agents/common/tool-policy.ts`
の `BOUNDARY_BASH_PATTERNS`）:

| グループ               | ブロック対象 subcommand (任意オプション込み)                                              |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Issue write            | `edit` / `close` / `delete` / `transfer` / `reopen` / `pin` / `unpin` / `lock` / `unlock` |
| PR write               | `edit` / `close` / `merge` / `ready` / `review` / `reopen` / `lock`                       |
| Release write          | `create` / `edit` / `delete` / `upload`                                                   |
| Project write          | `edit` / `delete` / `close` / `copy` / `field-create` / `field-delete` / `item-*`         |
| Label admin            | `create` / `edit` / `delete` / `clone`                                                    |
| Repo write             | `create` / `delete` / `edit` / `archive` / `unarchive` / `rename` / `fork`                |
| Direct API             | `gh api` (全 method)                                                                      |
| Network tool bypass    | `curl` / `wget` / `python[23]?` / `node` / `ruby` / `perl` / `deno` + `api.github.com`    |
| State mutation payload | JSON `"state":"closed"` ペイロード                                                        |

> **注記**: `gh issue edit` は旧実装では `--state closed` 限定だった。これは
> `--add-label` 等を素通りさせる bypass gap となっていた。BoundaryHook が label
> 付与の唯一経路であるため、`gh issue edit` は全オプションでブロックする。 PR
> 側も同様に `gh pr edit` を全オプションでブロックする。

> **注記**: `gh issue comment` は意図的にブロック対象外である。コメント投稿は
> Handoff Manager および OutboxProcessor がホストプロセスで実行するため、 Agent
> からの直接実行は sandbox のネットワークブロックのみで防止される。

> **注記**: `gh issue create` / `gh pr create` は workflow-continuation の
> 非破壊操作として finalize 層が扱う設計のため、agent bash でも許可する （Agent
> が直接 create を使うことは想定しないが、パターンで block しない）。

> **注記**: Closure step を含む全 step kind で `blockBoundaryBash: true`
> が設定されている。Closure step
> でも有効な理由は、`defaultClosureAction:
> "label-only"` 等の BoundaryHook
> policy をバイパスして Agent が 直接 `gh issue edit --add-label`
> を叩く経路を封じるためである。

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

| フィールド                 | 型       | 説明                                                                                                                                               |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                  | boolean  | GitHub 連携の有効化。`false` の場合、GitHubRead MCP ツールの注入、BoundaryHook の GitHub 操作、closure prompt の adaptation がすべてスキップされる |
| `labels.requirements`      | string   | 要件ラベル                                                                                                                                         |
| `labels.inProgress`        | string   | 作業中ラベル                                                                                                                                       |
| `labels.blocked`           | string   | ブロック中ラベル                                                                                                                                   |
| `labels.completion.add`    | string[] | 完了時に追加するラベル                                                                                                                             |
| `labels.completion.remove` | string[] | 完了時に削除するラベル                                                                                                                             |
| `defaultClosureAction`     | string   | closure 時の動作。詳細は [09_closure_output_contract.md](./09_closure_output_contract.md) 参照                                                     |

詳細は [02_agent_definition.md](./02_agent_definition.md) の
`runner.integrations.github` セクションを参照。

### workflow.json の handoff

```json
{
  "handoff": {
    "commentTemplates": {
      "reviewerApproved": "## Review Approved\n\n{final_summary}",
      "iteratorToReviewer": "## Iteration Complete\n\n{final_summary}"
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
| BoundaryHook           | `agents/runner/boundary-hooks.ts`          |
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
- [09_closure_output_contract.md](./09_closure_output_contract.md) -- Closure
  Output Contract
