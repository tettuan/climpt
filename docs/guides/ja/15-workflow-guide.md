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
  "rules": { "maxCycles": 5, "cycleDelayMs": 5000 }
}
```

2. GitHub issue に `ready` ラベルを付与する。

3. ワークフローを実行:

```bash
deno task orchestrator --label ready --state open
```

## workflow.json の構造

### トップレベルフィールド

| フィールド     | 必須 | デフォルト                             | 説明                                                          |
| -------------- | ---- | -------------------------------------- | ------------------------------------------------------------- |
| `version`      | yes  | —                                      | スキーマバージョン（例: `"1.0.0"`）                           |
| `phases`       | yes  | —                                      | Phase 定義（後述）                                            |
| `labelMapping` | yes  | —                                      | GitHub ラベル → phase ID マッピング                           |
| `agents`       | yes  | —                                      | Agent 定義（後述）                                            |
| `rules`        | yes  | —                                      | 実行制約（後述）                                              |
| `labelPrefix`  | no   | —                                      | ラベル名前空間（例: `"docs"` → ラベルが `docs:ready` になる） |
| `issueStore`   | no   | `{ path: ".agent/climpt/tmp/issues" }` | ローカル issue ストアのディレクトリ                           |
| `handoff`      | no   | —                                      | Agent 間ハンドオフのコメントテンプレート                      |
| `prioritizer`  | no   | —                                      | Prioritizer Agent 設定（`--prioritize` に必須）               |

### phases

ワークフローの状態を定義する。各 phase は `type` を持つ:

- `actionable` — Agent が実行される。`agent` と `priority` が必須。
- `terminal` — ワークフロー完了。
- `blocking` — 人間の介入待ち。

| フィールド | 必須            | 説明                                                       |
| ---------- | --------------- | ---------------------------------------------------------- |
| `type`     | yes             | `"actionable"`、`"terminal"`、または `"blocking"`          |
| `priority` | actionable のみ | 小さいほど高優先。複数ラベルがマッチしたときの選択に使用。 |
| `agent`    | actionable のみ | ディスパッチする Agent ID（`agents` に存在する必要がある） |

### labelMapping

GitHub ラベルから phase ID へのマッピング。複数ラベルが同一 phase
にマッピング可能。未定義ラベルは無視される。

### agents

Agent の動作を定義:

- **Transformer** (`role: "transformer"`) — 単一出力。正常完了で `outputPhase`
  へ、エラーで `fallbackPhase` へ遷移。
- **Validator** (`role: "validator"`) — 複数出力。`outputPhases`
  で判定結果に応じた遷移先を定義。

| フィールド      | 必須             | 説明                                                       |
| --------------- | ---------------- | ---------------------------------------------------------- |
| `role`          | yes              | `"transformer"` または `"validator"`                       |
| `directory`     | no               | `.agent/` 配下の Agent ディレクトリ名（省略時は Agent ID） |
| `outputPhase`   | transformer のみ | 成功時の遷移先 phase                                       |
| `outputPhases`  | validator のみ   | 判定キー → 遷移先 phase のマッピング                       |
| `fallbackPhase` | no               | エラー時の遷移先 phase（通常 `"blocked"`）                 |

### rules

| フィールド     | デフォルト | 説明                       |
| -------------- | ---------- | -------------------------- |
| `maxCycles`    | 5          | issue あたりの最大遷移回数 |
| `cycleDelayMs` | 5000       | サイクル間の待機（ミリ秒） |

### prioritizer

`--prioritize` 使用時に必須。優先度ラベル付与 Agent の設定。

| フィールド     | 必須 | 説明                                                         |
| -------------- | ---- | ------------------------------------------------------------ |
| `agent`        | yes  | 優先度付与に使用する Agent ID                                |
| `labels`       | yes  | 許可する優先度ラベルの順序リスト（例: `["P1", "P2", "P3"]`） |
| `defaultLabel` | no   | 優先度が未設定・無効な場合のフォールバックラベル             |

## ワークフローの実行

```bash
# 単一 issue を処理
deno task orchestrator --issue 123

# 単一 issue をドライラン
deno task orchestrator --issue 123 --dry-run --verbose

# 特定ラベルの open issue を処理（batch モード）
deno task orchestrator --label ready --state open

# カスタム workflow ファイル指定
deno task orchestrator --label docs --workflow .agent/workflow-docs.json

# ドライラン（GitHub の変更なし）
deno task orchestrator --label ready --dry-run --verbose

# 優先度付けのみ（Agent ディスパッチなし）
deno task orchestrator --label ready --prioritize

# 複数ラベルフィルタ
deno task orchestrator --label P1 --label docs --state open --limit 10
```

### `--label` と `labelPrefix` の違い

`--label` と `labelPrefix` は独立した概念である:

| 概念          | 設定場所        | 役割                                                                        |
| ------------- | --------------- | --------------------------------------------------------------------------- |
| `--label`     | CLI 引数        | GitHub から取得する issue のフィルタ（`gh issue list --label <値>` に変換） |
| `labelPrefix` | `workflow.json` | Phase 遷移ラベルの名前空間（例: `ready` → `docs:ready`）                    |

`--label` は処理対象の issue を選別する。`labelPrefix` は遷移時のラベル読み書き
を制御する。両者は互いに影響しない。

例: `--label docs` は `docs` ラベルが付いた issue を取得する。Orchestrator
はその issue の他のラベル（例: `ready`）から現在の phase を解決し、
`labelMapping` に従って遷移を管理する。`docs` ラベル自体は `labelMapping`
に含まれないため、ワークフロー全体を通じて変更されない。

### CLI オプション

| オプション     | 型      | デフォルト             | 説明                                          |
| -------------- | ------- | ---------------------- | --------------------------------------------- |
| `--issue`      | number  | —                      | 単一 issue を処理（batch sync をスキップ）    |
| `--workflow`   | string  | `.agent/workflow.json` | workflow ファイルパス                         |
| `--label`      | string  | —                      | GitHub issue フィルタ（複数指定可、batch 用） |
| `--repo`       | string  | カレント               | リポジトリ（`owner/repo`）                    |
| `--state`      | string  | `open`                 | `open` / `closed` / `all`                     |
| `--limit`      | number  | `30`                   | 最大取得 issue 数                             |
| `--prioritize` | boolean | false                  | Prioritizer のみ実行（batch 用）              |
| `--verbose`    | boolean | false                  | 詳細ログ出力                                  |
| `--dry-run`    | boolean | false                  | 実行せず結果を表示                            |
| `--local`      | boolean | false                  | ローカル IssueStore を使用（GitHub 同期なし） |

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

### Issue 単位の status

- `"completed"` — terminal phase に到達。
- `"blocked"` — blocking phase に到達、またはアクション可能なラベルなし。
- `"cycle_exceeded"` — `maxCycles` 制限に到達。
- `"dry-run"` — actionable phase を解決済み。`--dry-run`
  によりディスパッチをスキップ。

### Batch の status

- `"completed"` — 全 issue がエラーなく処理完了（空バッチ・全件 terminal
  含む）。
- `"partial"` — 1 件以上の issue で処理エラーが発生。
- `"failed"` — バッチ開始不可（例: ワークフローロック競合）。

### 終了コード

| モード     | 条件                                       | 終了コード |
| ---------- | ------------------------------------------ | ---------- |
| 単一 issue | status が `"completed"` または `"dry-run"` | 0          |
| 単一 issue | status が `"blocked"` 等                   | 1          |
| Batch      | status が `"completed"`                    | 0          |
| Batch      | status が `"partial"` または `"failed"`    | 1          |

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
deno task orchestrator --label docs:ready --workflow .agent/workflow-docs.json
deno task orchestrator --label impl:ready --workflow .agent/workflow-impl.json
```

## トラブルシューティング

| 症状                                 | 原因                                    | 対処                                       |
| ------------------------------------ | --------------------------------------- | ------------------------------------------ |
| issue が処理されない                 | マッチするラベルが open issue にない    | `--label` と `--state` フィルタを確認      |
| Agent がディスパッチされない         | Phase が blocking/terminal に解決された | `labelMapping` と phase type を確認        |
| Cycle limit exceeded                 | 遷移回数が多すぎる                      | `maxCycles` を増やすかループ原因を修正     |
| ラベルが無視される                   | `labelMapping` に未定義                 | ラベルを `labelMapping` に追加             |
| ロード時バリデーションエラー         | workflow.json の相互参照不整合          | agent/phase の参照先が存在するか確認       |
| `--prioritize` が失敗 (WF-BATCH-001) | `prioritizer` 設定がない                | workflow に `prioritizer` セクションを追加 |
