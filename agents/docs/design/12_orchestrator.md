# Orchestrator

Label 駆動のワークフロー状態機械。Runner の上位レイヤーとして、複数 Agent
の協調を制御する。

## 役割

| What                                    | Why                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------- |
| workflow.json の読み込みと検証          | 宣言的定義から状態機械を構築し、設定漏れを起動前に排除                     |
| GitHub label → Phase → Agent の解決     | label が唯一の遷移トリガーであり、外部から可視                             |
| Agent ディスパッチと完了ハンドリング    | Runner 呼び出しを一方向依存で委譲                                          |
| Phase 遷移とラベル更新                  | 遷移ロジックを Agent から分離し、予測可能性を保つ                          |
| サイクル追跡とループ防止                | maxCycles で無限ループを防ぎ、maxConsecutivePhases で局所 stuck を早期検知 |
| Issue Store によるデータ境界 _(計画中)_ | Agent の gh 直接アクセスを禁止し、破損リスクを排除 _(v1.14 で導入予定)_    |
| Outbox Pattern _(計画中)_               | Agent のリクエストを検証してから実行 _(v1.14 で導入予定)_                  |
| Batch 処理と優先度ソート                | 複数 issue を一括で効率的に処理                                            |

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

## Verdict 伝搬

Validator Agent の verdict が Orchestrator の phase 遷移に到達するまでの
データフローを示す。

### 伝搬チェーン

```
Layer 1: VerdictResult.verdict    (verdict/types.ts)
  AI structured output の verdict フィールドを BoundaryHook が抽出

Layer 2: VerdictHandler
  VerdictResult を評価し、isFinished + verdict を返す

Layer 3: AgentResult.verdict      (src_common/contracts.ts)
  Runner が VerdictHandler の結果を AgentResult に格納

Layer 4: DispatchOutcome.outcome  (orchestrator/dispatcher.ts)
  Dispatcher が verdict ?? (success ? "success" : "failed") にマッピング

Layer 5: computeTransition()      (orchestrator/phase-transition.ts)
  outcome を outputPhases のキーとして遷移先 phase を解決
```

### computeTransition の判定ロジック

| Agent role    | outcome                         | 遷移先                  |
| ------------- | ------------------------------- | ----------------------- |
| `transformer` | `"success"`                     | `outputPhase`           |
| `transformer` | それ以外                        | `fallbackPhase`         |
| `validator`   | `outputPhases` に存在するキー   | `outputPhases[outcome]` |
| `validator`   | `outputPhases` に存在しないキー | `fallbackPhase`         |

### BoundaryHook の structured output ラベル読み取り

BoundaryHook は `github.labels.completion` 設定に加え、AI の structured output
からもラベル変更指示を読み取る:

- `issue.labels.add`: 完了時に追加するラベル
- `issue.labels.remove`: 完了時に削除するラベル

structured output のラベル指示は設定値を上書きする。これにより Validator Agent
が verdict に応じて動的にラベルを制御できる （参照:
`design/04_step_flow_design.md` L311）。

## 実行フロー

### 単一 Issue サイクル

```
deno task orchestrator --issue 123
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
deno task orchestrator --label docs --state open
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

| status                        | 条件                                                                                                            | log event                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `"completed"`                 | terminal phase に到達                                                                                           | —                            |
| `"blocked"`                   | blocking phase、ラベルなし、Agent 未解決                                                                        | —                            |
| `"phase_repetition_exceeded"` | 同一 phase が `rules.maxConsecutivePhases` 回連続で出現 (`cycle_exceeded` より先に評価。default `0` = disabled) | `consecutive_phase_exceeded` |
| `"cycle_exceeded"`            | `rules.maxCycles` 超過                                                                                          | `cycle_exceeded`             |
| `"dry-run"`                   | actionable phase を解決済み、`--dry-run` 中止                                                                   | —                            |

`phase_repetition_exceeded` は局所 stuck (同一 phase への連続遷移) を検知し、
`cycle_exceeded` (全体の総遷移数) より先に発火する。event payload は `phase` /
`consecutiveCount` / `maxConsecutivePhases` を含む。詳細:
[`builder/07_flow_design.md` §2.4](../builder/07_flow_design.md)。

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

## Lock

カーネルレベルの `flock(fd, LOCK_EX)`
を使用し、同一ワークフローの並行実行を防止する。 Deno の `FsFile.lock(true)`
に短いタイムアウト（`Promise.race`）を組み合わせ、
ノンブロッキング的な振る舞いをエミュレートする。

### Two-Layer Lock

| レイヤー  | ロックファイル                                 | 取得タイミング                           |
| --------- | ---------------------------------------------- | ---------------------------------------- |
| **Batch** | `{storePath}/.lock.{workflowId}`               | `BatchRunner` がバッチ実行開始時         |
| **Issue** | `{storePath}/.lock.{workflowId}.{issueNumber}` | `Orchestrator.run()` が issue 処理開始時 |

### API

| 関数                                        | 説明                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `acquireLock(workflowId)`                   | バッチレベルの排他ロックを取得                                                          |
| `acquireIssueLock(workflowId, issueNumber)` | Issue レベルの排他ロック（内部で `acquireLock("${workflowId}.${issueNumber}")` に委譲） |

両関数とも `{ release: () => void } | null` を返す。`null`
は既にロックされていることを示す。

### 自動クリーンアップ

カーネルが fd のクローズまたはプロセス終了時（SIGKILL を含む）に flock
を自動解放する。 PID チェック、stale 検出、シグナルハンドラは不要。

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

### Outbox Pattern

Agent は gh 操作をファイルとして `outbox/` に書き出す。Orchestrator が Agent
完了後に `OutboxProcessor.process()` で順次 gh API を実行する。

サポートする操作: `comment`, `create-issue`, `update-labels`, `close-issue`,
`add-to-project`, `update-project-item-field`, `close-project`,
`remove-from-project`

#### `OutboxProcessor.process()` Sequence Contract

1. **Filename-ordered execution**: outbox ディレクトリ内の `.json` ファイルを
   ファイル名の辞書順でソートし、先頭から順次実行する。ファイル名の数値プレフィクス
   (例: `001-comment.json` の `001`) がシーケンス番号となる。
2. **Phase filter**: 各アクションの `trigger`
   フィールドで実行フェーズを分離する。 `process()` は `trigger` なし
   (pre-close) のアクションのみ実行し、 `trigger: "post-close"` のアクションは
   `processPostClose()` で実行する。
3. **Per-file success tracking (issue #486)**: アクション成功時にそのファイルを
   即座に削除する。失敗したファイルはディスク上に残り、次サイクルで再試行される。
   これにより、部分失敗後の次サイクルで成功済みアクションが再実行されない。
4. **Late-binding (issue #487)**: `add-to-project` アクションの `issueNumber` が
   省略された場合、同一 family 内の直前の `create-issue` 結果から解決する。
   family ID はファイル名 `000-deferred-NNN-action.json` の `NNN`
   から抽出される。
5. **Return contract**: 各アクションの結果を `OutboxResult[]` で返す。`success`,
   `sequence`, `action`, `filename` を含み、呼び出し側 (Orchestrator) が
   per-file の成功/失敗を判別できる。

#### C1 Idempotency 統合 (issues #484, #486)

`DeferredItemsEmitter` の idempotency key と `OutboxProcessor` の per-file
deletion は相互補完的に動作する:

- **C1 (emitter 側)**: `emit()` 時に SHA-256 idempotency key で重複を検出し、
  確認済みアイテムの再 emit を防止する。
- **C3 (processor 側)**: per-file deletion で成功済みファイルを除去し、
  次サイクルでの再実行を防止する。
- **統合点**: Orchestrator Step 7b.1 で、OutboxProcessor の結果から成功した
  deferred-item の idempotency key を `confirmEmitted()` に渡す。
  部分失敗時は成功分のみ confirm され、失敗分は次サイクルで emitter が再 emit
  し、 processor が再実行する。

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

## Phase 遷移 Transaction

Phase 遷移に伴う gh 複合操作 (label add / label remove / handoff comment /
close) を unit-atomic に扱うための saga スコープ。単一サイクルの副作用を 1 つの
`TransactionScope` に束ね、途中失敗時は LIFO で補償を走らせて issue の観測状態を
一貫させる。

- **Level 1 (Why)**: label だけ付いて issue が open のまま残る「G2 label
  宙ぶらり」等の片側成功を阻止し、phase 遷移を unit-atomic に保つため。
- 契約とパターンの source of truth: `agents/docs/design/09_contracts.md` の
  「Phase 遷移の契約」セクション。ここでは Orchestrator 側の適用と補償挙動のみ
  記述する。

### T1〜T7 シーケンス

`agents/orchestrator/orchestrator.ts:484-720` の実装と 1:1 対応する。pure
計算→可逆操作→不可逆操作の順で、各境界で fail-fast する。

```
T1  pure: compute plan = { labelsToAdd, labelsToRemove, handoffComment?, closeIntent? }
T2  snapshot: preImage = currentLabels, cycleSeq = tracker.getCount(n) + 1
T3  scope.step("add-labels", gh.updateIssueLabels([], add),
        compensation: gh.updateIssueLabels(add, []))
T4  scope.step("remove-labels", gh.updateIssueLabels(remove, []),
        compensation: gh.updateIssueLabels([], remove))
T5  scope.step("handoff-comment", handoff.renderAndPost(...),
        compensation: restore preImage labels)
T6  scope.record({ label: "compensation-comment", ... });   // pre-register
    await gh.closeIssue(n);                                 // irreversible
T_rec  tracker.record(...)     // T3..T6 全成功時のみ
T_commit  scope.commit()       // 補償スタックを破棄
T7  store.updateMeta / writeWorkflowState   // best-effort、commit 後
        ─ 失敗は次サイクル頭の gh 再読込でセルフヒール

途中失敗:  catch → scope.rollback(err) が LIFO で補償を実行
           → status="blocked" で break、次サイクルで同 phase を再試行
finally:   commit も rollback も走らなかった場合の保険として rollback を呼ぶ
```

### 可逆性分類

| 操作                 | 可逆性     | 冪等性                            | 反対操作     |
| -------------------- | ---------- | --------------------------------- | ------------ |
| label 追加           | 可逆       | 冪等 (gh は重複追加を no-op 扱い) | label 削除   |
| label 削除           | 可逆       | 冪等                              | label 追加   |
| handoff comment      | **不可逆** | 非冪等 (重複投稿)                 | 追記 comment |
| issue close          | 可逆       | 冪等 (既 close は 409 = 実質成功) | reopen       |
| issue reopen         | 可逆       | 冪等                              | close        |
| compensation comment | **不可逆** | マーカーで冪等化 (下記参照)       | —            |

**原則**: 可逆で冪等な操作から並べ、不可逆な状態変化 (close) を最後に置く。
前段失敗時は後段をスキップし、既成功ぶんだけを補償で巻き戻す。

### 補償マトリクス

failed step に対し、どこまでの step が成功しているかで補償内容が決まる。

| 成功した step     | 失敗した step    | 補償シーケンス                                   | 冪等性         |
| ----------------- | ---------------- | ------------------------------------------------ | -------------- |
| (なし)            | T3 add-labels    | なし (状態変化なし)                              | —              |
| T3                | T4 remove-labels | T3 で add した label を remove                   | 冪等 (gh)      |
| T3 + T4           | T5 handoff       | label を preImage に復元 (add ↔ remove 逆)       | 冪等 (gh)      |
| T3 + T4 + T5      | T6 close         | **補償 comment 追記** (マーカー付き)             | マーカーで冪等 |
| T3 + T4 + T5 + T6 | T7 local persist | 補償不要。次サイクル頭の gh 再読込でセルフヒール | —              |

補償自身の失敗は `CompensationReport.failed` に集約され rollback は throw しない
(`agents/orchestrator/transaction-scope.ts:116-160`)。log に
`event:
"compensation_ran"` / `"compensation_failed"` を残し、呼び出し側
(orchestrator) は status="blocked"
で当該サイクルを終え、次サイクルで再試行する。

### 補償マーカーによる冪等化

補償 comment は gh に delete API が無いため不可逆。再実行時の重複投稿を防ぐため
決定論的マーカーを body に埋め込む。

**source of truth**: `agents/orchestrator/orchestrator.ts` に export された
`compensationMarker(issueNumber, cycleSeq)` factory を唯一の生成元とする。
producer (T6 rollback の comment body 組み立て) と consumer (`getRecentComments`
による事前 dedup チェック) は共にこの factory から文字列を取得する。テストも 同
factory を import して期待値を導出する。

**表示形式**: 可視 footer 署名方式。comment 本文末尾に `<sub>🤖 <marker></sub>`
として埋め込む (旧: 不可視 HTML コメント `<!-- ... -->` は廃止)。ユーザが GitHub
UI 上で補償 comment を 視認できることを優先しつつ、マーカー文字列は grep
可能な形で保持する。

**冪等性プロトコル**:

1. 補償実行時に `github.getRecentComments(n, 20)` でマーカー存在を確認
2. マーカーが見つかれば skip (return 早期リターン)
3. 見つからなければ body に同マーカーを付けて `addIssueComment` を投稿

参照実装: `agents/orchestrator/orchestrator.ts` の `compensationMarker` export
と T6 の pre-register 箇所。

### TransactionScope API (要約)

実装: `agents/orchestrator/transaction-scope.ts`。契約の source of truth
はコード コメント (同ファイル L20-30) 側。

| メソッド                       | 役割                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `step(label, action, factory)` | action を実行し、成功時のみ factory() が返す補償を push        |
| `record(comp)`                 | action を伴わず補償を先行登録 (T6 close の pre-register 用)    |
| `commit()`                     | 補償スタックを破棄し `committed` 状態へ遷移 (冪等)             |
| `rollback(cause)`              | LIFO で補償を実行し `CompensationReport` を返す (throw しない) |

**不変条件**:

- `record` / `step` は `state !== "open"` では no-op (commit/rollback
  後の呼び出し は無視)
- 補償は全て best-effort。個別失敗は `report.failed` に収集され、
  `report.partial=true` として surface される
- retry policy は各 `Compensation.run` の内部責務。TransactionScope は関与しない

### 適用範囲

TransactionScope は `GitHubClient` interface にしか依存せず、orchestrator の
メインループ (phase 遷移) における gh 複合操作を unit-atomic に統合する。

## コンポーネント一覧

| モジュール             | What                                                      | Why                                            |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| `workflow-loader.ts`   | workflow.json 読み込み・スキーマ検証・相互参照検証        | 設定漏れを起動前に排除                         |
| `workflow-types.ts`    | Phase, Agent, Transition 等の型定義                       | 全モジュールの型安全性を保証                   |
| `workflow-schema.json` | JSON Schema                                               | IDE 補完とバリデーション                       |
| `label-resolver.ts`    | Label → Phase → Agent 解決                                | priority による優先度制御                      |
| `phase-transition.ts`  | 遷移ロジック・ラベル変更計算・テンプレート展開            | Agent から遷移ロジックを分離                   |
| `cycle-tracker.ts`     | Issue ごとの遷移回数追跡と連続 phase カウント             | maxCycles / maxConsecutivePhases でループ防止  |
| `dispatcher.ts`        | Agent 起動・完了ハンドリング                              | Runner 呼び出しのラッパー                      |
| `github-client.ts`     | gh コマンドのラッパー                                     | gh アクセスを単一モジュールに集約              |
| `orchestrator.ts`      | メインループ（全モジュール統合）                          | 単一 issue サイクル + batch 処理               |
| `transaction-scope.ts` | Phase 遷移 saga の補償レジストリ (record/commit/rollback) | gh 複合操作を unit-atomic に保ち片側成功を阻止 |
| `issue-store.ts`       | ローカルファイルシステムの issue ストア                   | Agent と gh の境界を保証 _(v1.14)_             |
| `issue-syncer.ts`      | gh → Issue Store 同期                                     | リモートデータのローカル反映                   |
| `outbox-processor.ts`  | outbox ファイル読み込み・gh 実行                          | Agent の gh リクエストを検証 _(v1.14)_         |
| `prioritizer.ts`       | 優先度ラベルの自動付与                                    | batch 処理の順序最適化                         |
| `queue.ts`             | issue のソート・キュー構築                                | 優先度順の処理を保証                           |

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
