# Orchestrator

Label 駆動のワークフロー状態機械。Runner の上位レイヤーとして、複数 Agent
の協調を制御する。

## 役割

| What                                    | Why                                                    |
| --------------------------------------- | ------------------------------------------------------ |
| workflow.json の読み込みと検証          | 宣言的定義から状態機械を構築し、設定漏れを起動前に排除 |
| GitHub label → Phase → Agent の解決     | label が唯一の遷移トリガーであり、外部から可視         |
| Agent ディスパッチと完了ハンドリング    | Runner 呼び出しを一方向依存で委譲                      |
| Phase 遷移とラベル更新                  | 遷移ロジックを Agent から分離し、予測可能性を保つ      |
| サイクル追跡とループ防止                | maxCycles で無限ループを防ぎ、blocking に強制遷移      |
| Issue Store によるデータ境界            | Agent の gh 直接アクセスを禁止し、破損リスクを排除     |
| Outbox Pattern による gh 操作の事後実行 | Agent のリクエストを検証してから実行                   |
| Batch 処理と優先度ソート                | 複数 issue を一括で効率的に処理                        |

## Phase 型

| Type         | 説明                   | Agent 実行 |
| ------------ | ---------------------- | ---------- |
| `actionable` | Agent が処理を実行する | yes        |
| `terminal`   | ワークフロー完了       | no         |
| `blocking`   | 人間の介入待ち         | no         |
| `inProgress` | Agent 実行中の一時状態 | no         |

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
scripts/run-workflow.ts --issue 123
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
scripts/run-workflow.ts --label docs --state open
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

## Issue Store

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

### gh Access Boundary

| 層               | gh アクセス | ファイルアクセス                       |
| ---------------- | ----------- | -------------------------------------- |
| **Agent**        | **禁止**    | Issue Store 読み取り + outbox 書き出し |
| **Orchestrator** | **許可**    | Issue Store 管理（同期・outbox 実行）  |

### Outbox Pattern

Agent は gh 操作をファイルとして `outbox/` に書き出す。Orchestrator が Agent
完了後に順次 gh コマンドで実行する。

サポートする操作: `comment`, `create-issue`, `update-labels`, `close-issue`

## コンポーネント一覧

| モジュール             | What                                               | Why                                  |
| ---------------------- | -------------------------------------------------- | ------------------------------------ |
| `workflow-loader.ts`   | workflow.json 読み込み・スキーマ検証・相互参照検証 | 設定漏れを起動前に排除               |
| `workflow-types.ts`    | Phase, Agent, Transition 等の型定義                | 全モジュールの型安全性を保証         |
| `workflow-schema.json` | JSON Schema                                        | IDE 補完とバリデーション             |
| `label-resolver.ts`    | Label → Phase → Agent 解決                         | priority による優先度制御            |
| `phase-transition.ts`  | 遷移ロジック・ラベル変更計算・テンプレート展開     | Agent から遷移ロジックを分離         |
| `cycle-tracker.ts`     | Issue ごとの遷移回数追跡                           | maxCycles でループ防止               |
| `dispatcher.ts`        | Agent 起動・完了ハンドリング                       | Runner 呼び出しのラッパー            |
| `github-client.ts`     | gh コマンドのラッパー                              | gh アクセスを単一モジュールに集約    |
| `orchestrator.ts`      | メインループ（全モジュール統合）                   | 単一 issue サイクル + batch 処理     |
| `issue-store.ts`       | ローカルファイルシステムの issue ストア            | Agent と gh の境界を保証             |
| `issue-syncer.ts`      | gh → Issue Store 同期                              | リモートデータのローカル反映         |
| `outbox-processor.ts`  | outbox ファイル読み込み・gh 実行                   | Agent の gh リクエストを検証して実行 |
| `prioritizer.ts`       | 優先度ラベルの自動付与                             | batch 処理の順序最適化               |
| `queue.ts`             | issue のソート・キュー構築                         | 優先度順の処理を保証                 |

## Runner との境界

```
scripts/run-workflow.ts
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
