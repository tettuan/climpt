# Workflow Setup

workflow.json の書き方とワークフロー実行の手引き。

## 前提

- Runner セットアップ完了済み（`builder/01_quickstart.md` 参照）
- 対象 Agent の `agent.json` が `.agent/{name}/` に存在する
- `gh` CLI がインストール済みで認証済み

## workflow.json の作成

`.agent/workflow.json` を作成する。

```json
{
  "$schema": "../../agents/orchestrator/workflow-schema.json",
  "version": "1.0.0",
  "phases": {
    "implementation": {
      "type": "actionable",
      "priority": 3,
      "agent": "iterator"
    },
    "review": {
      "type": "actionable",
      "priority": 2,
      "agent": "reviewer"
    },
    "revision": {
      "type": "actionable",
      "priority": 1,
      "agent": "iterator"
    },
    "complete": { "type": "terminal" },
    "blocked": { "type": "blocking" }
  },
  "labelMapping": {
    "ready": "implementation",
    "review": "review",
    "implementation-gap": "revision",
    "from-reviewer": "revision",
    "done": "complete",
    "blocked": "blocked"
  },
  "agents": {
    "iterator": {
      "role": "transformer",
      "directory": "iterator",
      "outputPhase": "review",
      "fallbackPhase": "blocked"
    },
    "reviewer": {
      "role": "validator",
      "directory": "reviewer",
      "outputPhases": {
        "approved": "complete",
        "rejected": "revision"
      },
      "fallbackPhase": "blocked"
    }
  },
  "rules": {
    "maxCycles": 5,
    "cycleDelayMs": 10000
  }
}
```

## Phase 定義

Phase は `type` で分類する。

| type         | 用途               | `agent` 必須 | `priority` 必須 |
| ------------ | ------------------ | ------------ | --------------- |
| `actionable` | Agent が処理を実行 | yes          | yes             |
| `terminal`   | ワークフロー完了   | no           | no              |
| `blocking`   | 人間の介入待ち     | no           | no              |

`priority` は複数ラベルが同時に存在する場合の解決に使用する。**値が小さいほど高
優先**。

## Agent 定義

### Transformer（単一出力）

```json
{
  "role": "transformer",
  "directory": "iterator",
  "outputPhase": "review",
  "fallbackPhase": "blocked"
}
```

正常完了 → `outputPhase`、エラー → `fallbackPhase`。

### Validator（複数出力）

```json
{
  "role": "validator",
  "directory": "reviewer",
  "outputPhases": {
    "approved": "complete",
    "rejected": "revision"
  },
  "fallbackPhase": "blocked"
}
```

判定結果（verdict）に応じて異なる phase に遷移する。`outputPhases` のキーが
verdict 値に対応し、値が遷移先 phase を示す。

#### Verdict 伝搬フロー

Validator Agent の verdict は以下の経路で Orchestrator に伝搬する:

```
AI structured output       { "intent": "closing", "verdict": "approved" }
  │
  ▼
BoundaryHook               verdict 値を抽出 → VerdictResult.verdict
  │
  ▼
Runner                     AgentResult.verdict = "approved"
  │
  ▼
Dispatcher                 DispatchOutcome.outcome = verdict ?? (success ? "success" : "failed")
  │
  ▼
Orchestrator               computeTransition(agent, outcome)
  │                          outputPhases["approved"] → "complete"
  ▼
Phase 遷移                 review → complete
```

- AI は closure step の structured output で `verdict` フィールドを返す
- `outputPhases` に一致するキーがあれば、その値の phase に遷移する
- 一致しない、または verdict が未指定の場合は `fallbackPhase` に遷移する

#### Reviewer ワークフロー例

```json
{
  "phases": {
    "implementation": {
      "type": "actionable",
      "priority": 3,
      "agent": "iterator"
    },
    "review": { "type": "actionable", "priority": 2, "agent": "reviewer" },
    "revision": { "type": "actionable", "priority": 1, "agent": "iterator" },
    "complete": { "type": "terminal" },
    "blocked": { "type": "blocking" }
  },
  "agents": {
    "iterator": {
      "role": "transformer",
      "directory": "iterator",
      "outputPhase": "review",
      "fallbackPhase": "blocked"
    },
    "reviewer": {
      "role": "validator",
      "directory": "reviewer",
      "outputPhases": {
        "approved": "complete",
        "rejected": "revision"
      },
      "fallbackPhase": "blocked"
    }
  }
}
```

この例では:

- `iterator` が実装を完了すると `review` phase に遷移
- `reviewer` が `approved` を返すと `complete`（terminal）に遷移
- `reviewer` が `rejected` を返すと `revision` phase に遷移し `iterator`
  が再実行
- verdict が不明な場合は `blocked` に遷移し人間の介入を待つ

## Label Mapping

`labelMapping` で定義するラベルは、two-tier label model における「Orchestrator
ラベル」に相当する（`08_closure_output_contract.md` R3 参照）。

GitHub issue label をキー、phase ID を値とする。

```json
{
  "ready": "implementation",
  "review": "review",
  "done": "complete"
}
```

複数ラベルが同一 phase にマッピング可能（例: `implementation-gap` と
`from-reviewer` → `revision`）。未定義ラベルは無視される。

## Rules

| フィールド     | 型     | デフォルト | 説明                                           |
| -------------- | ------ | ---------- | ---------------------------------------------- |
| `maxCycles`    | number | 5          | 同一 issue の最大遷移回数                      |
| `cycleDelayMs` | number | 10000      | サイクル間の待機（ミリ秒）; カウントダウン表示 |

## Handoff

Handoff は Agent 間の遷移時に GitHub Issue へ定型コメントを投稿する設定。

### commentTemplates

テンプレートキーの命名規則:

1. `{agentId}{Outcome}` を先に検索（例: `iteratorSuccess`）
2. 見つからなければ `{agentId}To{Outcome}` にフォールバック（例:
   `iteratorToSuccess`）

Outcome は先頭大文字化される（`approved` →
`Approved`）。テンプレートが見つからない場合はコメント投稿をスキップする（エラーにならない）。

### テンプレート変数

テンプレート変数はフレームワーク固定ではない。全て設定者が定義する。

設定箇所は 2 箇所:

1. **closure step の schema にフィールドを定義する** 例:
   `"final_summary": { "type": "string" }`
2. **closure step の `handoffFields` に orchestrator
   に伝搬するフィールドを列挙する** 例: `"handoffFields": ["final_summary"]`

これにより、テンプレート内で `{final_summary}` として利用可能になる。

未定義の変数はそのまま `{variable}` として出力される。

### テンプレートキーの対応表

agents セクションの role/outputPhase/outputPhases と commentTemplates
キーの対応:

| Agent    | Role        | Outcome                   | テンプレートキー候補                     |
| -------- | ----------- | ------------------------- | ---------------------------------------- |
| iterator | transformer | success (→ outputPhase)   | `iteratorSuccess`, `iteratorToSuccess`   |
| iterator | transformer | failed (→ fallbackPhase)  | `iteratorFailed`, `iteratorToFailed`     |
| reviewer | validator   | approved (→ outputPhases) | `reviewerApproved`, `reviewerToApproved` |
| reviewer | validator   | rejected (→ outputPhases) | `reviewerRejected`, `reviewerToRejected` |

### 設定例

```json
// steps_registry.json — closure step
{
  "stepId": "closure.issue",
  "structuredGate": {
    "allowedIntents": ["closing", "repeat"],
    "intentField": "next_action.action",
    "handoffFields": ["final_summary"]
  }
}
```

```json
// workflow.json
{
  "handoff": {
    "commentTemplates": {
      "iteratorSuccess": "[Handoff] Implementation complete.\n\n{final_summary}",
      "reviewerApproved": "[Review Complete] All requirements verified.\n\n{final_summary}",
      "reviewerRejected": "[Review] Gaps found.\n\n{final_summary}"
    }
  }
}
```

## Label Prefix

複数ワークフローの共存。

```json
{
  "labelPrefix": "docs",
  "labelMapping": {
    "ready": "implementation"
  }
}
```

GitHub 上のラベルは `docs:ready` になるが、`labelMapping` のキーはベア名
`"ready"` のまま記述する。

## Issue Store _(計画中 — v1.14 で導入予定)_

Agent の gh 直接アクセスを禁止するための設定。

> **現状 (v1.13):** 以下の設定は v1.14 で有効化予定。現在は：
>
> - `issueStore.path` を設定しても、単一 issue モード (`--issue N`) では
>   IssueStore を使用しない。`run()` は毎サイクル gh から直接ラベルを取得する
> - Batch モード (`--label`) では IssueStore を同期・キュー構築に使用するが、 各
>   issue の処理は gh 直接アクセス
> - Agent に `issueStorePath` を渡す仕組みは未接続
> - OutboxProcessor は batch モードでのみ動作

```json
{
  "issueStore": {
    "path": ".agent/climpt/tmp/issues"
  }
}
```

## Prioritizer

issue の優先度を自動判定する Agent の設定。

```json
{
  "prioritizer": {
    "agent": "triage-agent",
    "labels": ["P1", "P2", "P3"],
    "defaultLabel": "P3"
  }
}
```

> **v1.13 制約:** Prioritizer Agent は `issue-list.json` を IssueStore パスから
> 読み、`priorities.json` を同パスに書く規約で動作する。Store が空の場合は
> ディスパッチをスキップし空の結果を返す。

## 実行

### 基本

```bash
# 単一 issue を処理
deno task orchestrator --issue 123

# 単一 issue をドライラン
deno task orchestrator --issue 123 --dry-run --verbose

# 単一ラベルでフィルタして batch 処理
deno task orchestrator --label docs --state open

# カスタム workflow ファイル指定
deno task orchestrator --label docs --workflow .agent/workflow-docs-user.json

# 優先度付けのみ実行
deno task orchestrator --label docs --prioritize

# 複数ラベルでフィルタ
deno task orchestrator --label P1 --label docs --state open --limit 10

# ドライラン（gh 操作を実行しない）
deno task orchestrator --label docs --dry-run --verbose
```

### CLI 引数

| 引数           | 型      | デフォルト             | 説明                                          |
| -------------- | ------- | ---------------------- | --------------------------------------------- |
| `--issue`      | number  | —                      | 単一 issue を処理（batch sync をスキップ）    |
| `--workflow`   | string  | `.agent/workflow.json` | workflow ファイルパス                         |
| `--label`      | string  | —                      | ラベルフィルタ（複数指定可、batch 用）        |
| `--repo`       | string  | カレント               | リポジトリ（`owner/repo`）                    |
| `--state`      | string  | `open`                 | `open` / `closed` / `all`                     |
| `--limit`      | number  | `30`                   | 最大取得 issue 数                             |
| `--prioritize` | boolean | `false`                | Prioritizer のみ実行（batch 用）              |
| `--verbose`    | boolean | `false`                | 詳細ログ出力                                  |
| `--dry-run`    | boolean | `false`                | 実行せず結果を表示（終了コード 0）            |
| `--local`      | boolean | `false`                | ローカル IssueStore を使用（GitHub 同期なし） |

## よくあるエラー

| エラー                                                   | 原因                                              | 対処                                    |
| -------------------------------------------------------- | ------------------------------------------------- | --------------------------------------- |
| `Phase "X" references unknown agent "Y"`                 | `phases[X].agent` が `agents` に存在しない        | `agents` セクションに `Y` を追加        |
| `Label "X" maps to unknown phase "Y"`                    | `labelMapping[X]` の値が `phases` に存在しない    | `phases` セクションに `Y` を追加        |
| `Agent "X" outputPhase "Y" is unknown`                   | `agents[X].outputPhase` が `phases` に存在しない  | 遷移先 phase を `phases` に追加         |
| `Actionable phase "X" missing agent`                     | `actionable` type の phase に `agent` が未定義    | `agent` フィールドを追加                |
| `Actionable phase "X" missing priority`                  | `actionable` type の phase に `priority` が未定義 | `priority` フィールドを追加             |
| `Cycle limit exceeded`                                   | `maxCycles` 回の遷移が発生                        | ワークフロー定義を見直すか maxCycles 増 |
| `WF-BATCH-001: --prioritize requires prioritizer config` | `prioritizer` セクションが未定義                  | workflow.json に `prioritizer` を追加   |

## 関連ドキュメント

- [02_agent_definition.md](./02_agent_definition.md) -- Agent 定義ファイルの構造
- [07_github_integration.md](./07_github_integration.md) -- GitHub
  連携の3層アクセスモデル
- [08_closure_output_contract.md](./08_closure_output_contract.md) -- Closure
  Output Contract
