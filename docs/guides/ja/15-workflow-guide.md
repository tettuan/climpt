# ワークフローガイド

Orchestrator によるマルチエージェントワークフローの定義と実行方法。

## 概要

Orchestrator は Label 駆動の状態機械で複数 Agent を協調させる。`workflow.json`
に Phase、Agent、遷移を定義し、GitHub issue のラベルをワークフロー状態として
使用する。Orchestrator はラベルを読み取り、Agent をディスパッチし、結果に応じて
ラベルを更新する。

## 前提条件

- Climpt インストール・設定済み （[02-climpt-setup.md](02-climpt-setup.md)）
- `.agent/` 配下に Agent が1つ以上セットアップ済み
- `gh` CLI インストール・認証済み
- 処理対象の issue がある GitHub リポジトリ

## クイックスタート

1. `.agent/workflow.json` を作成:

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
    "review": { "type": "actionable", "priority": 2, "agent": "reviewer" },
    "revision": { "type": "actionable", "priority": 1, "agent": "iterator" },
    "complete": { "type": "terminal" },
    "blocked": { "type": "blocking" }
  },
  "labelMapping": {
    "ready": "implementation",
    "review": "review",
    "implementation-gap": "revision",
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
      "outputPhases": { "approved": "complete", "rejected": "revision" },
      "fallbackPhase": "blocked"
    }
  },
  "rules": { "maxCycles": 5, "maxConcurrent": 1, "cycleDelayMs": 5000 }
}
```

2. GitHub issue に `ready` ラベルを付与する。

3. ワークフローを実行:

```bash
deno task workflow --label ready --state open
```

## workflow.json の構造

### phases

ワークフローの状態を定義する。各 phase は `type` を持つ:

- `actionable` — Agent が実行される。`agent` と `priority` が必須。
- `terminal` — ワークフロー完了。
- `blocking` — 人間の介入待ち。

### labelMapping

GitHub ラベルから phase ID へのマッピング。複数ラベルが同一 phase
にマッピング可能。未定義ラベルは無視される。

### agents

Agent の動作を定義:

- **Transformer** (`role: "transformer"`) — 単一出力。正常完了で `outputPhase`
  へ、エラーで `fallbackPhase` へ遷移。
- **Validator** (`role: "validator"`) — 複数出力。`outputPhases`
  で判定結果に応じた遷移先を定義。

### rules

| フィールド    | デフォルト | 説明                       |
| ------------- | ---------- | -------------------------- |
| maxCycles     | 5          | issue あたりの最大遷移回数 |
| maxConcurrent | 1          | 同時実行 Agent 数          |
| cycleDelayMs  | 5000       | サイクル間の待機（ミリ秒） |

## ワークフローの実行

```bash
# 特定ラベルの open issue を処理
deno task workflow --label ready --state open

# カスタム workflow ファイル指定
deno task workflow --label docs --workflow .agent/workflow-docs.json

# ドライラン（GitHub の変更なし）
deno task workflow --label ready --dry-run --verbose

# 優先度付けのみ（Agent ディスパッチなし）
deno task workflow --label ready --prioritize

# 複数ラベルフィルタ
deno task workflow --label P1 --label docs --state open --limit 10
```

### CLI オプション

| オプション     | 型      | デフォルト             | 説明                         |
| -------------- | ------- | ---------------------- | ---------------------------- |
| `--workflow`   | string  | `.agent/workflow.json` | workflow ファイルパス        |
| `--label`      | string  | —                      | ラベルフィルタ（複数指定可） |
| `--project`    | string  | —                      | GitHub Project 名            |
| `--repo`       | string  | カレント               | リポジトリ（`owner/repo`）   |
| `--state`      | string  | `open`                 | `open` / `closed` / `all`    |
| `--limit`      | number  | `30`                   | 最大取得 issue 数            |
| `--prioritize` | boolean | false                  | Prioritizer のみ実行         |
| `--verbose`    | boolean | false                  | 詳細ログ出力                 |
| `--dry-run`    | boolean | false                  | 変更を表示のみ               |

## 出力の見方

Orchestrator は JSON で結果を出力する:

```json
{
  "processed": [
    {
      "issueNumber": 123,
      "finalPhase": "complete",
      "cycleCount": 2,
      "status": "completed"
    }
  ],
  "skipped": [],
  "totalIssues": 1,
  "status": "completed"
}
```

- `status: "completed"` — terminal phase に到達。
- `status: "blocked"` — blocking phase
  に到達、またはアクション可能なラベルなし。
- `status: "cycle_exceeded"` — `maxCycles` 制限に到達。

## マルチワークフロー設定

`labelPrefix` を使い、同一リポジトリで複数ワークフローをラベル衝突なく運用:

```json
{
  "labelPrefix": "docs",
  "labelMapping": {
    "ready": "implementation",
    "review": "review"
  }
}
```

GitHub ラベルは `docs:ready`、`docs:review` になる。`labelMapping`
のキーはベア名のまま。

カスタム workflow ファイルで実行:

```bash
deno task workflow --label docs:ready --workflow .agent/workflow-docs.json
deno task workflow --label impl:ready --workflow .agent/workflow-impl.json
```

## トラブルシューティング

| 症状                         | 原因                                    | 対処                                       |
| ---------------------------- | --------------------------------------- | ------------------------------------------ |
| issue が処理されない         | マッチするラベルが open issue にない    | `--label` と `--state` フィルタを確認      |
| Agent がディスパッチされない | Phase が blocking/terminal に解決された | `labelMapping` と phase type を確認        |
| Cycle limit exceeded         | 遷移回数が多すぎる                      | `maxCycles` を増やすかループ原因を修正     |
| ラベルが無視される           | `labelMapping` に未定義                 | ラベルを `labelMapping` に追加             |
| ロード時バリデーションエラー | workflow.json の相互参照不整合          | agent/phase の参照先が存在するか確認       |
| `--prioritize` が失敗        | `prioritizer` 設定がない                | workflow に `prioritizer` セクションを追加 |
