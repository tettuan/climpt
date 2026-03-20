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
    "cycleDelayMs": 5000
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

判定結果に応じて異なる phase に遷移。

## Label Mapping

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

| フィールド     | 型     | デフォルト | 説明                       |
| -------------- | ------ | ---------- | -------------------------- |
| `maxCycles`    | number | 5          | 同一 issue の最大遷移回数  |
| `cycleDelayMs` | number | 5000       | サイクル間の待機（ミリ秒） |

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

> **現状 (v1.13):** Orchestrator 側の IssueStore クラスは実装済みだが、Agent に
> `issueStorePath` を渡す仕組みが未接続。Agent は従来どおり `--issue` 番号のみで
> 動作し、gh への直接アクセスは制限されない。Batch モードでは Orchestrator が
> IssueStore を内部利用するが、Agent 側のデータ境界は未適用。

```json
{
  "issueStore": {
    "path": ".agent/issues"
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

## 実行

### 基本

```bash
# 単一 issue を処理
deno task workflow --issue 123

# 単一 issue をドライラン
deno task workflow --issue 123 --dry-run --verbose

# 単一ラベルでフィルタして batch 処理
deno task workflow --label docs --state open

# カスタム workflow ファイル指定
deno task workflow --label docs --workflow .agent/workflow-docs-user.json

# 優先度付けのみ実行
deno task workflow --label docs --prioritize

# 複数ラベルでフィルタ
deno task workflow --label P1 --label docs --state open --limit 10

# ドライラン（gh 操作を実行しない）
deno task workflow --label docs --dry-run --verbose
```

### CLI 引数

| 引数           | 型      | デフォルト             | 説明                                       |
| -------------- | ------- | ---------------------- | ------------------------------------------ |
| `--issue`      | number  | —                      | 単一 issue を処理（batch sync をスキップ） |
| `--workflow`   | string  | `.agent/workflow.json` | workflow ファイルパス                      |
| `--label`      | string  | —                      | ラベルフィルタ（複数指定可、batch 用）     |
| `--repo`       | string  | カレント               | リポジトリ（`owner/repo`）                 |
| `--state`      | string  | `open`                 | `open` / `closed` / `all`                  |
| `--limit`      | number  | `30`                   | 最大取得 issue 数                          |
| `--prioritize` | boolean | `false`                | Prioritizer のみ実行（batch 用）           |
| `--verbose`    | boolean | `false`                | 詳細ログ出力                               |
| `--dry-run`    | boolean | `false`                | gh 操作を実行せず表示のみ                  |

## よくあるエラー

| エラー                                     | 原因                                              | 対処                                    |
| ------------------------------------------ | ------------------------------------------------- | --------------------------------------- |
| `Phase "X" references unknown agent "Y"`   | `phases[X].agent` が `agents` に存在しない        | `agents` セクションに `Y` を追加        |
| `Label "X" maps to unknown phase "Y"`      | `labelMapping[X]` の値が `phases` に存在しない    | `phases` セクションに `Y` を追加        |
| `Agent "X" outputPhase "Y" is unknown`     | `agents[X].outputPhase` が `phases` に存在しない  | 遷移先 phase を `phases` に追加         |
| `Actionable phase "X" missing agent`       | `actionable` type の phase に `agent` が未定義    | `agent` フィールドを追加                |
| `Actionable phase "X" missing priority`    | `actionable` type の phase に `priority` が未定義 | `priority` フィールドを追加             |
| `Cycle limit exceeded`                     | `maxCycles` 回の遷移が発生                        | ワークフロー定義を見直すか maxCycles 増 |
| `--prioritize requires prioritizer config` | `prioritizer` セクションが未定義                  | workflow.json に `prioritizer` を追加   |
