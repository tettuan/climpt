# Orchestrator

Label 駆動のワークフロー状態機械。Runner の上位レイヤーとして、複数 Agent
の協調を制御する。

## 役割

| What                                    | Why                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------- |
| workflow.json の読み込みと検証          | 宣言的定義から状態機械を構築し、設定漏れを起動前に排除                  |
| GitHub label → Phase → Agent の解決     | label が唯一の遷移トリガーであり、外部から可視                          |
| Agent ディスパッチと完了ハンドリング    | Runner 呼び出しを一方向依存で委譲                                       |
| Phase 遷移とラベル更新                  | 遷移ロジックを Agent から分離し、予測可能性を保つ                       |
| サイクル追跡とループ防止                | maxCycles で無限ループを防ぎ、blocking に強制遷移                       |
| Issue Store によるデータ境界 _(計画中)_ | Agent の gh 直接アクセスを禁止し、破損リスクを排除 _(v1.14 で導入予定)_ |
| Outbox Pattern _(計画中)_               | Agent のリクエストを検証してから実行 _(v1.14 で導入予定)_               |
| Batch 処理と優先度ソート                | 複数 issue を一括で効率的に処理                                         |

## Phase 型

| Type         | 説明                   | Agent 実行 |
| ------------ | ---------------------- | ---------- |
| `actionable` | Agent が処理を実行する | yes        |
| `terminal`   | ワークフロー完了       | no         |
| `blocking`   | 人間の介入待ち         | no         |

`actionable` phase に到達すると対応する Agent が起動される。`terminal`
に到達するとワークフローは完了する。`blocking` は自動解決できない状態を示し、
人間がラベルを操作して再開する。

## Agent 型

### Transformer

入力を変換して単一の出力先に遷移する Agent。

- 遷移: `outputPhase`（正常完了）/ `fallbackPhase`（エラー）
- 例: `iterator` — issue 要件に基づきコードを実装し、review phase へ遷移

### Validator

入力を検証し、判定結果に応じて異なる phase に遷移する Agent。

- 遷移: `outputPhases` のマッピングに従う
- 例: `reviewer` — approved なら complete、rejected なら revision

### fallbackPhase

Agent がエラーで失敗した場合の遷移先。通常は `blocking` phase
にフォールバックし、人間の介入を待つ。

## 実行フロー

### 単一 Issue サイクル

```
deno task workflow --issue 123
  │
  ▼
1. loadWorkflow(cwd)
   └─ .agent/workflow.json → WorkflowConfig
  │
  ▼
2. Orchestrator.run(issueNumber=123)
   │
   ▼
   ┌─── LOOP (cycle 1..maxCycles) ────────────────────────────┐
   │                                                           │
   │  3. gh issue view → currentLabels を取得                  │
   │  4. resolvePhase(currentLabels, config)                   │
   │     ├─ terminal  → return "completed"                     │
   │     ├─ blocking  → return "blocked"                       │
   │     └─ actionable → continue                              │
   │  5. resolveAgent(phaseId, config) → agentId               │
   │  6. cycleTracker.isExceeded? → yes: blocked / no: continue│
   │  7. dispatcher.dispatch(agentId, issueNumber)             │
   │     └─ AgentRunner.run() → outcome                        │
   │  8. computeTransition(agent, outcome) → targetPhase       │
   │  9. computeLabelChanges(currentLabels, targetPhase)       │
   │ 10. gh issue edit → ラベル更新                            │
   │ 11. cycleTracker.record(...)                              │
   │ 12. handoff comment（optional）                           │
   │ 13. sleep(cycleDelayMs)                                   │
   │     └─── next cycle ────────────────────────────────────→ │
   └───────────────────────────────────────────────────────────┘
   │
   ▼
14. return OrchestratorResult
```

### Batch 処理フロー

```
deno task workflow --label docs --state open
  │
  ▼
1. loadWorkflow(cwd, workflowPath)
2. fetchIssues(filters) → issue リスト
3. IssueStore.sync(issueNumbers) → gh → ローカル同期
4. sortByPriority → priorities.json 順 or issue 番号順
5. FOR EACH issue:
   ├─ Orchestrator.run(issueNumber)
   ├─ OutboxProcessor.process(issueNumber)
   └─ 結果を集約
6. BatchResult 出力
```

### Status 判定ロジック

**per-issue status** (`OrchestratorResult.status`):

| status             | 条件                                          |
| ------------------ | --------------------------------------------- |
| `"completed"`      | terminal phase に到達                         |
| `"blocked"`        | blocking phase、ラベルなし、Agent 未解決      |
| `"cycle_exceeded"` | `maxCycles` 超過                              |
| `"dry-run"`        | actionable phase を解決済み、`--dry-run` 中止 |

**batch status** (`BatchResult.status`):

| status        | 条件                                                   |
| ------------- | ------------------------------------------------------ |
| `"completed"` | 処理エラー 0 件（空バッチ・全件 terminal/skip も含む） |
| `"partial"`   | 処理エラー 1 件以上                                    |
| `"failed"`    | バッチ開始不可（ワークフローロック競合）               |

**exit code** (`@aidevtool/climpt/agents/orchestrator`):

- 単一 issue: `status === "completed" \|\| status === "dry-run"` → 0、それ以外 →
  1
- Batch: `status === "failed" \|\| status === "partial"` → 1、それ以外 → 0

## Label Prefix

複数ワークフローの共存。`labelPrefix: "docs"` を設定すると、GitHub ラベルは
`docs:ready`、`docs:review` のようにプレフィクス付きで管理される。

- `labelMapping` のキーはベア名（`"ready"`）のまま維持
- プレフィクスの付与・除去は label-resolver と phase-transition が担う
- プレフィクスなしの場合、ラベルはそのまま使用される

```
workflow-docs-user.json  → labelPrefix: "user-docs"  → user-docs:ready
workflow-docs-designer.json → labelPrefix: "designer-docs" → designer-docs:ready
```

## 現状 (v1.13)

v1.13 における IssueStore / Outbox の接続状況を明記する。以下のセクションで
記述する Issue Store・Outbox Pattern は **v1.14 の設計目標** であり、v1.13 では
下記の動作が実態である。

| 項目                       | v1.13 の動作                                                              |
| -------------------------- | ------------------------------------------------------------------------- |
| `run()` のラベル取得       | 毎サイクル gh から直接取得（IssueStore を参照しない）                     |
| `runBatch()` の IssueStore | gh → IssueStore 同期後にキューを構築するが、内部で呼ぶ `run()` は gh 直接 |
| OutboxProcessor            | batch モードでのみ動作。単一 issue モード (`run()`) では呼ばれない        |
| Agent への引数             | `--issue` 番号のみ。`--issue-store-path` / `--outbox-path` は渡されない   |
| Dispatcher の転送          | `issueStorePath` / `outboxPath` を Agent に転送する仕組みは未接続         |

## Issue Store _(計画中 — v1.14 で導入予定)_

> **注意:** 以下は v1.14 の設計目標である。v1.13 の実態は上記「現状 (v1.13)」
> セクションを参照のこと。Orchestrator 側の IssueStore / OutboxProcessor
> クラスは実装済みだが、Agent 側の接続が未完了であり、データ境界は未適用である。

Agent から gh API への直接アクセスを排除し、ローカルファイルシステムを
唯一のインターフェースとする。

```
{issueStore.path}/
  {number}/
    meta.json       # issue メタデータ（number, title, labels, state）
    body.md         # issue 本文
    comments/       # 各コメント
    outbox/         # Agent → Orchestrator への gh 操作リクエスト
  priorities.json   # Prioritizer Agent の出力
```

### gh Access Boundary _(目標)_

| 層               | gh アクセス (目標) | ファイルアクセス (目標)                | 現状 (v1.13)                                                        |
| ---------------- | ------------------ | -------------------------------------- | ------------------------------------------------------------------- |
| **Agent**        | **禁止**           | Issue Store 読み取り + outbox 書き出し | gh 制限なし。`--issue` 番号のみ受け取り、gh に直接アクセス          |
| **Orchestrator** | **許可**           | Issue Store 管理（同期・outbox 実行）  | gh 操作はすべて直接実行。IssueStore は batch のキュー構築にのみ使用 |

### Outbox Pattern _(未接続)_

Agent は gh 操作をファイルとして `outbox/` に書き出す。Orchestrator が Agent
完了後に順次 gh コマンドで実行する。

サポートする操作: `comment`, `create-issue`, `update-labels`, `close-issue`

> **v1.14 実装予定:**
>
> 1. Dispatcher が `--issue-store-path` を Agent CLI 引数に追加
> 2. `run-agent.ts` が Issue Store パスを受け取り、Agent に渡す
> 3. 単一 issue モードでも OutboxProcessor を実行する

## Dual Truth Source _(v1.13 の既知制約)_

`runBatch()` は gh → IssueStore 同期後にキューを構築するが、各 issue の 処理時に
`run()` が gh から直接ラベルを再取得する。これにより：

- キュー構築: IssueStore のスナップショットに基づく
- ディスパッチ判定: gh の最新状態に基づく

この二重基準は v1.13 では許容される。`run()` は常に gh から最新状態を取得
するため、ディスパッチ判定は正確である。ストアが古い場合の最悪ケースは、
非アクション可能な issue にディスパッチを試み `status: "blocked"` で返る
ことであり、データ破損は起きない。

v1.14 では `run()` がストアを単一の真実源として使用し、この二重基準を解消する。

## コンポーネント一覧

| モジュール             | What                                               | Why                                    |
| ---------------------- | -------------------------------------------------- | -------------------------------------- |
| `workflow-loader.ts`   | workflow.json 読み込み・スキーマ検証・相互参照検証 | 設定漏れを起動前に排除                 |
| `workflow-types.ts`    | Phase, Agent, Transition 等の型定義                | 全モジュールの型安全性を保証           |
| `workflow-schema.json` | JSON Schema                                        | IDE 補完とバリデーション               |
| `label-resolver.ts`    | Label → Phase → Agent 解決                         | priority による優先度制御              |
| `phase-transition.ts`  | 遷移ロジック・ラベル変更計算・テンプレート展開     | Agent から遷移ロジックを分離           |
| `cycle-tracker.ts`     | Issue ごとの遷移回数追跡                           | maxCycles でループ防止                 |
| `dispatcher.ts`        | Agent 起動・完了ハンドリング                       | Runner 呼び出しのラッパー              |
| `github-client.ts`     | gh コマンドのラッパー                              | gh アクセスを単一モジュールに集約      |
| `orchestrator.ts`      | メインループ（全モジュール統合）                   | 単一 issue サイクル + batch 処理       |
| `issue-store.ts`       | ローカルファイルシステムの issue ストア            | Agent と gh の境界を保証 _(v1.14)_     |
| `issue-syncer.ts`      | gh → Issue Store 同期                              | リモートデータのローカル反映           |
| `outbox-processor.ts`  | outbox ファイル読み込み・gh 実行                   | Agent の gh リクエストを検証 _(v1.14)_ |
| `prioritizer.ts`       | 優先度ラベルの自動付与                             | batch 処理の順序最適化                 |
| `queue.ts`             | issue のソート・キュー構築                         | 優先度順の処理を保証                   |

## Runner との境界

```
@aidevtool/climpt/agents/orchestrator
  → orchestrator/orchestrator.ts
    → orchestrator/workflow-loader.ts
    → orchestrator/label-resolver.ts
    → orchestrator/phase-transition.ts
    → orchestrator/dispatcher.ts
      → runner/runner.ts              ← 既存 AgentRunner
    → orchestrator/cycle-tracker.ts
```

**原則**: orchestrator → runner は一方向依存。runner は orchestrator
を知らない。 Runner は単一 Agent の Flow/Completion ループに徹し、Orchestrator
は複数 Agent の協調と状態遷移を担う。
