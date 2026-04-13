# 05. Implementation Plan

> **Canonical source**: 00-design-decisions.md § T14 (2026-04-13, 最新指示).
> Runner-mediated flow
> (`orchestrator → agents/scripts/run-agent.ts → AgentRunner → closure step → merge-pr.ts`)
> および issue.payload → agent.parameters binding、`${context.*}` template
> substitution、BOUNDARY_BASH_PATTERNS nested subprocess escape 方針は § T14 が
> authoritative で、T12 の「orchestrator → merge-pr.ts 直接起動」寄りの記述を
> supersede する。canMerge 責務分離 (mergePr wrapper / canMerge pure) は
> Amendment T12 を継承。Scheduler + Reason taxonomy (T10 継承) と outcome
> canonical 5 値 (T8 継承) は引き続き authoritative。

本ドキュメントは PR Merger の実装着手に必要なファイル一覧、責務、
テスト方針、ロールアウト・ロールバック手順を定義する。実装コードは
含まず、擬似コードで責務のみを示す。

## 1. 追加ファイル一覧

### 1.1 新規・変更ファイル

| パス                              | 役割                                                                               | 新規/変更 | 概算 LOC |
| --------------------------------- | ---------------------------------------------------------------------------------- | --------- | -------- |
| `agents/scripts/merge-pr.ts`      | merger-cli 本体 (deterministic)                                                    | 新規      | ~150     |
| `.agent/workflow-merge.json`      | merger 用 workflow 定義                                                            | 新規      | ~50      |
| `.agent/merger/agent.json`        | merger agent 定義 (validator role, closure step で merge-pr.ts を subprocess 起動) | 新規      | ~40      |
| `.agent/verdicts/.gitkeep`        | verdict-store ディレクトリ (初期化用)                                              | 新規      | 0        |
| `agents/scripts/merge-pr_test.ts` | merger-cli ユニットテスト                                                          | 新規      | ~200     |
| `deno.json`                       | `merge-pr` タスク追加                                                              | 変更      | +2 行    |

### 1.2 変更しないファイル (非干渉制約)

以下のファイルには本機能で一切手を加えない。Design Principle #3 の 非干渉
(iterator / reviewer の挙動を変えない) を保証する。

| パス                                       | 理由                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `agents/verdict/external-state-adapter.ts` | closure step の外部状態取得ロジックは触らない (F6)                              |
| `agents/orchestrator/query-executor.ts`    | `github_read` MCP 注入は既存のまま (F9)                                         |
| `.agent/workflow.json`                     | 既存 impl サイクルの workflow は独立運用 (F1)                                   |
| `.agent/iterator/agent.json`               | iterator agent 定義は不変                                                       |
| `.agent/reviewer/agent.json`               | reviewer agent 定義は不変 (verdict emit は 3 節参照)                            |
| `.agent/reviewer/steps_registry.json`      | reviewer step 構成は不変                                                        |
| `agents/common/worktree.ts`                | `finalizeWorktreeBranch()` の `gh pr create` 実行パターンを参考にするのみ (F10) |

### 1.2.1 依存ファイル (本設計で直接変更しないが、Phase 0 prerequisite として runtime 拡張が必要)

本設計 (PR Merger) は以下の climpt runtime 側ファイルに **依存** するが、本 PR
では これらを直接変更しない。Runner-mediated flow (Amendment T14 Decision 1)
を成立させる ために、**Phase 0 prerequisite として別 PR または本 PR
の先行コミットで runtime 拡張を 実施する**。本 PR は runtime
拡張を前提として設計のみを定義する。

| パス                                           | 依存内容 / 必要な runtime 拡張                                                                                                                                                                                                          | Phase                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `agents/scripts/run-agent.ts`                  | CLI → `agent.parameters` 既存 mapping (run-agent.ts:517-529) を活用。新規: `${context.*}` template substitution 導入のため `context = { ...issuePayload, ...agentParameters }` 合成ロジック追加                                         | Phase 0-b            |
| `agents/runner/boundary-hooks.ts`              | 参照のみ、未変更。**推奨 (任意)**: merge-pr.ts の subprocess stdout JSON を event として re-emit する hook 追加 (監査性向上)                                                                                                            | Phase 0-d (任意)     |
| `agents/common/tool-policy.ts`                 | `BOUNDARY_BASH_PATTERNS` / `BOUNDARY_TOOLS` は **非変更**。nested subprocess escape により merge-pr.ts 内部の `gh pr merge` は enforcement 対象外となる (T14 Decision 3)                                                                | 非変更               |
| `agents/orchestrator/dispatcher.ts` (相当箇所) | issue.payload → run-agent.ts CLI 引数変換 (`--pr <n> --verdict-path <p>`) のため payload unpack ロジック追加                                                                                                                            | Phase 0-a            |
| `agents/runner/runner.ts` (AgentRunner)        | closure step の subprocess runner kind 新設 **または** 既存 closure 内 `runner.command` が存在する場合に `Deno.Command` で spawn する拡張。`runner.args` 中の `${context.*}` を agent parameters 値から substitute (未解決参照は abort) | Phase 0-b, Phase 0-c |

本設計は上記 runtime 拡張 (template substitution, issue.payload →
agent.parameters binding, closure subprocess runner) が climpt runtime
側で実装されていることを前提と する。本 PR Merger
設計自体はこれらのファイルを編集しない。

### 1.3 verdict-store レイアウト

```
.agent/verdicts/
├── .gitkeep
├── 123.json     # PR #123 の reviewer verdict
├── 124.json
└── ...
```

verdict-store ディレクトリは `.agent/` 配下。各 PR 番号ごとに 1 ファイル。
スキーマ・書式は `03-data-flow.md` の verdict schema 参照。

## 2. merge-pr.ts の責務 (擬似コード)

実装は別タスク。ここでは signature と責務のみを示す。LLM 呼出なし、
`@anthropic-ai/*` import なし、`Deno.Command` のみで完結する。

```typescript
// agents/scripts/merge-pr.ts
//
// 責務: verdict.json と PR 実状態から merge 可否を純関数で判定し、
//      可なら `gh pr merge` を実行する決定論 CLI。LLM 呼出禁止。

import type { MergePrResult, PrData, Verdict } from "./merge-pr.types.ts";

interface MergePrArgs {
  pr: number; // PR 番号
  verdictPath: string; // .agent/verdicts/<pr>.json
  dryRun: boolean; // 判定のみで gh 実行しない
}

// Reason: 内部判定用の細分化 (10 値、Amendment T10 準拠)
type CanMergeReason =
  | "verdict-missing"
  | "pr-number-mismatch"
  | "rejected-by-reviewer"
  | "unknown-mergeable"
  | "conflicts"
  | "approvals-missing"
  | "ci-pending"
  | "ci-failed"
  | "base-branch-mismatch"
  | "schema-mismatch";

// Canonical Outcome: 外部契約の 5 値 (00-design-decisions.md § T8)
type CanonicalOutcome =
  | "merged"
  | "ci-pending"
  | "approvals-missing"
  | "conflicts"
  | "rejected";

type MergeDecision =
  | { kind: "merged" }
  | { kind: CanonicalOutcome; reason: CanMergeReason; detail: string };

// 起動経路 (00-design-decisions.md § T14 Decision 1):
//   closure step runner が本 merge-pr.ts を subprocess として spawn する
//   (runner-mediated flow)。本 CLI は agents/scripts/run-agent.ts の孫 subprocess
//   として実行されるため、SDK tool-policy (BOUNDARY_BASH_PATTERNS) は内部の
//   gh pr merge 呼出に発動しない (T14 Decision 3 nested subprocess escape)。
//   詳細フローは section 2.3 Runner-mediated 起動経路 を参照。
//
// 責務分離は 2 ブロック構造 (00-design-decisions.md § T12 Decision 1):
//
//   ブロック A: mergePr(args) CLI wrapper (7 steps, I/O + GitHub API 境界)
//     step 1 (wrapper): verdict ファイル存在確認 → verdict-missing (早期 return)
//     step 2 (wrapper): verdict.json parse + JSON Schema validate → schema-mismatch
//     step 3 (wrapper): args.pr === verdict.pr_number 照合 → pr-number-mismatch
//                       (純ローカル比較、GitHub API 呼出前に実施)
//     step 4 (wrapper): gh pr view で prData 取得
//     step 5 (wrapper): canMerge(prData, verdict) 呼出 (純関数)
//     step 6 (wrapper): dry-run 分岐
//     step 7 (wrapper): gh pr merge 実行 + ラベル付替
//
//   ブロック B: canMerge(prData, verdict) 純関数 (step 0-5, 引数のみで判定完結)
//     step 0: schema_version (major=1) → schema-mismatch
//     step 1: verdict.verdict === "approved" → rejected-by-reviewer
//     step 2: prData.mergeable (MERGEABLE/CONFLICTING/UNKNOWN)
//     step 3: prData.reviewDecision === "APPROVED"
//     step 4: verdict.ci_required=true のとき statusCheckRollup 評価
//     step 5: verdict.base_branch === prData.baseRefName
//
// 扱う Reason 分担:
//   - mergePr wrapper: verdict-missing / pr-number-mismatch (I/O + CLI 引数保持)
//   - canMerge pure:   schema-mismatch / rejected-by-reviewer / unknown-mergeable /
//                      conflicts / approvals-missing / ci-pending / ci-failed /
//                      base-branch-mismatch (計 8 値)
// canMerge の署名は (pr: PrData, verdict: Verdict) のみで cli_args を含めない。
export function canMerge(pr: PrData, verdict: Verdict): MergeDecision {
  // step 0: schema_version major 一致チェック
  //   verdict.schema_version の major !== 1 → Err("schema-mismatch") → rejected
  //
  // step 1: reviewer 承認チェック
  //   verdict.verdict !== "approved" → Err("rejected-by-reviewer") → rejected
  //
  // step 2: mergeable チェック
  //   pr.mergeable === "CONFLICTING"      → Err("conflicts") → conflicts
  //   pr.mergeable === "UNKNOWN" || null  → Err("unknown-mergeable") → ci-pending
  //   pr.mergeable === "MERGEABLE"        → continue
  //
  // step 3: approvals チェック
  //   pr.reviewDecision !== "APPROVED"    → Err("approvals-missing") → approvals-missing
  //   (REVIEW_REQUIRED / CHANGES_REQUESTED / null はすべて approvals-missing)
  //
  // step 4: CI チェック (verdict.ci_required === true のときのみ)
  //   any conclusion ∈ {FAILURE, CANCELLED, TIMED_OUT} → Err("ci-failed") → rejected
  //   any status     ∈ {QUEUED, IN_PROGRESS, PENDING}  → Err("ci-pending") → ci-pending
  //   all success                                       → continue
  //   verdict.ci_required === false のときは step 4 を skip し step 5 へ
  //
  // step 5: base branch 一致チェック
  //   verdict.base_branch !== pr.baseRefName → Err("base-branch-mismatch") → rejected
  //
  // step 6: 全通過 → Ok → { kind: "merged" }
}

async function mergePr(args: MergePrArgs): Promise<MergePrResult> {
  // step 1 (verdict 存在チェック): args.verdictPath のファイル存在確認
  //    - 不在 → outcome=rejected, reason=verdict-missing (exit code 2)
  //    - JSON parse / schema 検証より前に実行 (ファイルがないと parse 不能のため)
  //
  // step 2 (parse + schema validate): verdict.json 読取 & JSON Schema validate
  //    - schema_version の major が 1 でない場合 → outcome=rejected, reason=schema-mismatch
  //    - JSON Schema 違反 (必須フィールド欠落等) も outcome=rejected, reason=schema-mismatch
  //
  // step 3 (pr_number 照合): args.pr === verdict.pr_number
  //    - NO → outcome=rejected, reason=pr-number-mismatch
  //    - 純ローカル比較、GitHub API 呼出前に実施 (誤 verdict 参照の早期検出)
  //
  // step 4 (PR 実状態取得):
  //    `gh pr view <pr> --json mergeable,mergeStateStatus,
  //     reviewDecision,statusCheckRollup,baseRefName,headRefName,state`
  //    で PR 実状態取得 (F8: read-only, BOUNDARY 非該当)
  //
  // step 5 (canMerge): canMerge(prData, verdict) で判定
  //    - canMerge 純関数は step 0-5 (schema / verdict / mergeable / approvals / CI / base_branch)
  //      のみを扱う。step -1, -0.5 は本 wrapper (step 1, 3) で既に処理済み
  //
  // step 6 (dry-run): args.dryRun が true なら判定結果を stdout に JSON で出力して return
  //
  // step 7 (merge 実行): decision.kind === "merged" なら
  //     Deno.Command("gh", ["pr", "merge", "<pr>",
  //       "--" + verdict.merge_method,
  //       ...(verdict.delete_branch ? ["--delete-branch"] : [])])
  //     を parent プロセスで実行 (F10 と同じパターン)
  //
  // step 8 (ラベル付替): Canonical Outcome に応じラベル付替 (5 分類):
  //    - merged:             `merge:ready` 剥離 → `merge:done` 付与
  //    - ci-pending:         `merge:ready` 維持 (retry)
  //    - approvals-missing:  `merge:ready` 剥離 → `merge:blocked` 付与
  //    - conflicts:          `merge:ready` 剥離 → `merge:blocked` 付与
  //    - rejected:           `merge:ready` 剥離 → `merge:blocked` 付与
  //
  // step 9 (output): 判定・実行結果を MergePrResult (JSON) として stdout に出力
}

// CLI entrypoint
if (import.meta.main) {
  const args = parseArgs(Deno.args); // --pr <n> --verdict <path> [--dry-run]
  const result = await mergePr(args);
  console.log(JSON.stringify(result, null, 2));
  Deno.exit(result.ok ? 0 : 1);
}
```

### 2.1 禁則事項 (implementer 向けチェックリスト)

- [ ] `import ... from "@anthropic-ai/..."` を含めない
- [ ] `import ... from "jsr:@anthropic-ai/..."` を含めない
- [ ] MCP / Agent SDK への依存を持たない
- [ ] `Deno.Command` 以外の外部プロセス実行経路を持たない
- [ ] `gh pr merge` 実行前に必ず `canMerge()` を通す (bypass 経路なし)
- [ ] stdout 出力は常に JSON (パースしやすさのため)
- [ ] `canMerge()` は 03-data-flow.md の step 0-5 順序を遵守 (schema_version →
      verdict → mergeable → approvals → CI → base_branch)
- [ ] `verdict.ci_required === false` のとき step 4 を
      skip、他ステップは通常適用
- [ ] CI FAILURE / CANCELLED / TIMED_OUT は `ci-failed` → canonical `rejected`
      (retry 不可)
- [ ] verdict ファイル不在時 (step 1) は schema 検証前に即
      `outcome=rejected, reason=verdict-missing` を返す
- [ ] `args.pr !== verdict.pr_number` (step 3) は `gh pr view` 呼出前に即
      `outcome=rejected, reason=pr-number-mismatch` を返す

### 2.2 merge-watcher.ts は廃止 (Amendment T10 / T12)

merge-watcher.ts は廃止 (T10 Decision 2)。代替トリガは
`.agent/merger/agent.json` の closure step (validator agent 既存機構)
で、orchestrator が `agents/scripts/run-agent.ts` 経由で merger agent を
dispatch し、AgentRunner が closure step runner 経由で
`agents/scripts/merge-pr.ts` を `--pr <n> --verdict .agent/verdicts/<n>.json` で
subprocess として spawn する runner-mediated flow (Amendment T14 Decision 1、
詳細は section 2.3)。verdict 不在は merge-pr.ts の step 1 (verdict-missing →
rejected) で処理する。

構造上の利点:

- Scheduler 責務が orchestrator に単一化され、04 state machine (per-workflow
  lock / maxCycles / cycleDelayMs) と整合する
- 2 段呼出 (watcher → merge-pr.ts) が runner-mediated 4 層 (orchestrator →
  run-agent.ts → AgentRunner → closure step → merge-pr.ts、section 2.3 参照) に
  整理され、climpt runtime の正規経路と揃う
- 案 A (agent.json closure step) は既存 validator agent 機構 + F6
  パターンを再利用するため 新規トリガ機構を設計・実装する必要がない (closure
  step runner を Phase 0-c で subprocess kind 対応拡張した上で再利用する)
- `args.pr !== verdict.pr_number` 検出が wrapper step 3 (pr-number-mismatch)
  で自然に成立
- LLM 非介在は closure step が prompt 呼出を伴わないこと + `merge-pr.ts` の
  `@anthropic-ai/*` import 禁則 (2.1) の 2 重で担保

### 2.3 Runner-mediated 起動経路 (T14 Decision 1)

本設計の起動経路は **orchestrator → run-agent.ts → AgentRunner → closure step
runner → merge-pr.ts** の 4 層 subprocess 構造として構成される。T12
の「orchestrator が merge-pr.ts を直接起動」寄りの記述を本節が supersede する。

#### 4 層起動ツリー (ASCII 図)

```
[ L0 ] workflow-merge orchestrator (別プロセス、agents/orchestrator)
   │   merge-ready phase issue を pick (per-workflow lock, 04 state machine 参照)
   │   issue.payload = { prNumber, verdictPath } を抽出
   │
   ├─▶ Deno.Command(run-agent.ts, ["--issue", N, "--pr", P, "--verdict-path", V])
   │
[ L1 ] agents/scripts/run-agent.ts  (新規 subprocess、parent-process 相当)
   │   .agent/merger/agent.json (validator role) を読込
   │   CLI args → definition.parameters へ mapping (run-agent.ts:517-529)
   │
   ├─▶ AgentRunner.run(definition, context)
   │
[ L2 ] AgentRunner  (agents/runner/runner.ts)
   │   context = { ...issuePayload, ...agentParameters } を合成
   │   closure step "merge" を dispatch
   │   runner.args 中の ${context.prNumber} / ${context.verdictPath} を substitute
   │
   ├─▶ Deno.Command("deno", ["run", "--allow-read", "--allow-run",
   │                          "--allow-net", "agents/scripts/merge-pr.ts",
   │                          "--pr", "<N>", "--verdict", "<V>"])
   │
[ L3 ] agents/scripts/merge-pr.ts  (孫 subprocess、決定論 CLI)
       mergePr() 実行: verdict 読込 → canMerge() → gh pr merge (条件成立時)
       stdout に MergePrResult (JSON) を emit して exit
```

#### 6-step シーケンス (データ受渡し)

1. **workflow-merge orchestrator** が `merge:ready` phase の issue を pick
   (per-workflow lock、04 state machine 準拠)。
2. **orchestrator (`agents/orchestrator/dispatcher.ts` 相当)** が issue.payload
   から `{ prNumber, verdictPath }` を展開し、`agents/scripts/run-agent.ts` を
   CLI args (`--issue N --pr P --verdict-path V`) 付きで subprocess 起動する。 →
   **Phase 0-a prerequisite**: issue.payload → CLI 引数変換ロジック追加。
3. **`agents/scripts/run-agent.ts`** が `.agent/merger/agent.json` を load、
   `definition.parameters.pr` / `definition.parameters.verdictPath` を既存
   CLI→parameters mapping (run-agent.ts:517-529) で bind。AgentRunner.run()
   を起動。 → 既存機構で対応、run-agent.ts 自体には新パラメータ定義は不要
   (agent.json の `parameters` に宣言すれば自動 forward)。
4. **AgentRunner** が closure step `merge` を
   dispatch。`context = { ...issuePayload,
   ...agentParameters }`
   を合成し、`runner.args` 中の `${context.prNumber}` / `${context.verdictPath}`
   を context 値から substitute する。 → **Phase 0-b prerequisite**: template
   substitution。未解決 `${context.*}` は 起動前検査で abort (T14 Decision 3
   Risk #3 緩和)。
5. **closure step runner** が `runner.command` + substituted `runner.args` を
   `Deno.Command` で spawn する。これは `merge-pr.ts` を孫 subprocess として
   起動する経路。 → **Phase 0-c prerequisite**: closure step subprocess runner
   kind の新設 (現行 closure は prompt-only のみで subprocess spawn
   機構を持たない)。
6. **`merge-pr.ts`** が section 2 で定義した責務 (verdict 読込 → `canMerge()` →
   条件成立時 `gh pr merge` 実行 → label 付替 → stdout JSON emit) を決定論的に
   実行する。本 step は本設計の scope 内 (section 2 定義済)。

#### データ受渡しの起点と到達点

- **起点**: reviewer agent が `reviewer:approved` phase 到達時に issueStore へ
  `payload: { prNumber, verdictPath }` を書込 (05 section 3.2 拡張ポイント)。
- **中継**: orchestrator → run-agent.ts → AgentRunner → closure runner の各層で
  CLI args / parameters / context namespace に順次 forward される。
- **到達点**: `merge-pr.ts` の argv (`--pr N --verdict <path>`)。

本経路は 02 Mermaid / 03 sequenceDiagram / 04 sequenceDiagram の各図で
AgentRunner (RUN) participant を含む 3 ホップ構造として描画される (T14 Done
Criteria 参照)。

## 3. reviewer agent 側の変更方針

### 3.1 非干渉制約

既存の `.agent/reviewer/agent.json` と `.agent/reviewer/steps_registry.json` は
**直接変更しない**。reviewer の評価責務・プロンプト・phase 遷移は
そのまま維持する。

### 3.2 拡張ポイント (具体実装は別タスク)

verdict JSON を `.agent/verdicts/<pr-number>.json` に emit するために、
以下の**局所的な追加**で対応する:

- `.agent/reviewer/closure_handoff_fields.json` (新規) — closure step の
  structured output に `verdict_payload` フィールドを追加する設定。
  `verdict_payload` の内部フィールド名は 03-data-flow.md の JSON Schema に
  厳密一致させる: `schema_version`, `pr_number`, `base_branch`, `verdict` (値は
  `"approved"` | `"rejected"`), `merge_method`, `delete_branch`,
  `reviewer_summary`, `evaluated_at`, `reviewer_agent_version`, `ci_required`。
  旧命名 (`type` 等) は使用しない。
- workflow-impl 側 `handoff.commentTemplates.reviewerApproved` (既存) の
  拡張で、`verdict_payload` を `.agent/verdicts/<pr>.json` にファイル 書出する
  (書出タイミング: reviewer が `reviewer:approved` phase に 到達した時点、F4
  相当のパス)

### 3.3 未決事項 (設計段階では判断しない)

- **既存 reviewer prompt の変更可否**: structured output に `verdict_payload`
  を追加するために prompt 改訂が必要かは実装時に判断。 prompt を変えずに既存
  `completion_fields` を流用できる場合はそちらを優先。
- **書出の実装位置**: workflow-impl のハンドラか、reviewer runner の closure
  step か。F6 の既存パターンとの整合で決定。

## 4. テスト方針

### 4.1 merge-pr_test.ts (ユニット)

`canMerge()` を中心に条件網羅で検証する。純関数なので stub 不要。

各ケースは 03-data-flow.md の早期失敗順序 (step -1, 0, -0.5, 1-5) を検証する。
ケース 1-2 は CLI wrapper `mergePr()` の早期ローカルチェック (step -1, -0.5)、
ケース 3-12 は純関数 `canMerge()` 経路 (step 0-5)。

| #  | ケース              | verdict                                                               | prData                                                | 期待 Reason          | 期待 Outcome      |
| -- | ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- | -------------------- | ----------------- |
| 1  | verdict 不在        | (ファイル欠落)                                                        | —                                                     | verdict-missing      | rejected          |
| 2  | pr-number mismatch  | approved, pr_number=200 (args.pr=100)                                 | —                                                     | pr-number-mismatch   | rejected          |
| 3  | 正常系              | approved, ci_required=true, base_branch=develop, schema_version=1.0.0 | MERGEABLE, APPROVED, all SUCCESS, baseRefName=develop | (Ok)                 | merged            |
| 4  | schema drift        | schema_version=2.0.0                                                  | —                                                     | schema-mismatch      | rejected          |
| 5  | reviewer 拒否       | verdict=rejected                                                      | MERGEABLE, APPROVED                                   | rejected-by-reviewer | rejected          |
| 6  | conflicts           | approved                                                              | mergeable=CONFLICTING                                 | conflicts            | conflicts         |
| 7  | unknown mergeable   | approved                                                              | mergeable=UNKNOWN                                     | unknown-mergeable    | ci-pending        |
| 8  | approvals missing   | approved                                                              | REVIEW_REQUIRED                                       | approvals-missing    | approvals-missing |
| 9  | CI pending          | approved, ci_required=true                                            | status=IN_PROGRESS                                    | ci-pending           | ci-pending        |
| 10 | CI failed           | approved, ci_required=true                                            | conclusion=FAILURE                                    | ci-failed            | rejected          |
| 11 | CI skip (emergency) | approved, ci_required=false                                           | any status                                            | (skip CI, 次へ)      | (step 5 へ)       |
| 12 | base mismatch       | approved, base_branch=develop                                         | baseRefName=main                                      | base-branch-mismatch | rejected          |

補足:

- **ケース 1 (verdict-missing)**: `mergePr()` は args.verdictPath
  のファイル存在を JSON parse より前にチェックする。テストでは `testdata/`
  に存在しないパスを渡すだけ。 canMerge 純関数は呼ばれない (step -1 で早期
  return)。
- **ケース 2 (pr-number-mismatch)**: `mergePr()` は verdict parse
  後、`gh pr view` 呼出前に `args.pr === verdict.pr_number`
  を照合する。テストでは args.pr=100、fixture verdict.pr_number=200
  のミスマッチで検証。GitHub API 呼出が発生しないことも assertion で確認する。
- **ケース 10**: CI 失敗は `rejected` に写像され retry されない (無限 retry
  防止)。 `ci-failed` を `ci-pending` 扱いにすると CI 側の原因
  (テスト恒常失敗等) が解消されるまで ループし続けるため、03 では明示的に
  `rejected` へ落としている。
- **ケース 11**: `ci_required=false` は step 4 (CI チェック) のみ skip
  するが、後続ゲート (step 5 の base_branch チェック) は通常通り適用される。緊急
  bypass でも base branch の 整合性は崩さない。

`mergePr()` 本体については `gh` 呼出を関数境界で inject (stubbing) して
テストする:

- `fetchPrData(pr)` を interface として切り出し、テスト時は fake を渡す
- `executeMerge(pr, method)` / `setLabels(pr, add, remove)` も同様
- `Deno.Command("gh", ...)` を直接呼ばず、上記 interface 経由で呼ぶ構造にする

### 4.2 モック方針

- 実 `gh` コマンド呼出なし (ネットワーク非依存、CI で決定論的に走る)
- verdict JSON は fixture で渡す (`testdata/verdicts/*.json`)
- PR データも fixture (`testdata/pr-views/*.json`)
- verdict-missing ケースは存在しないパス (`testdata/verdicts/nonexistent.json`
  等) を args.verdictPath に渡すことで再現
- pr-number-mismatch ケースは args.pr と fixture verdict.pr_number
  を意図的にずらす

### 4.3 E2E は別タスク

`examples/` 配下での手動確認を推奨。orchestrator (workflow-merge.json) +
merge-pr.ts + 実 PR を使った E2E 自動化は Phase 4 で検討。

### 4.4 BOUNDARY_BASH_PATTERNS 遵守策 (T14 Decision 3)

`merge-pr.ts` は agent runner の孫 subprocess として実行されるため、内部の
`gh pr merge` 呼出は SDK tool-policy (`BOUNDARY_BASH_PATTERNS`) の enforcement
対象外となる (nested subprocess escape)。SDK の Bash tool-policy は agent が
`Bash` tool を直接呼出した時点 (`query-executor.ts` の `canUseTool`) でのみ
発動し、nested subprocess からの `gh` 呼出は SDK tool-invocation
経路を通らない。 本構造は F10 (`finalizeWorktreeBranch` の parent-process 免除)
と同原理で成立する。

BOUNDARY_BASH_PATTERNS の本来目的 (LLM による任意コマンド実行の制限) は、
`merge-pr.ts` の禁則事項 (section 2.1: `@anthropic-ai/*` import 禁止、
`Deno.Command` 以外の外部 process 実行経路なし、`canMerge()` bypass 不可) に
よってコード境界で満たされる。LLM 生成 bash 文字列を `gh pr merge` に流し込む
経路は構造上存在しない。

#### Risk

1. **Boundary policy の意図崩壊 risk**: nested subprocess escape を汎用的に
   許容すると、BOUNDARY_BASH_PATTERNS の policy 意図が崩れる。
   - **緩和**: `merge-pr.ts` の禁則事項 (section 2.1) を厳守。実装レビュー時
     に禁則違反を reject する運用を確立。
   - **緩和**: nested subprocess escape は `merge-pr.ts` に限定し、他 agent
     で同パターンを横展開する際は **別途設計レビューを要する** ことを本節に
     明記する。
2. **監査性 low risk**: `gh pr merge` が boundary 経由でないため、agent runner
   内の実行ログに乗らない。
   - **緩和**: `merge-pr.ts` は stdout に JSON (outcome / pr_number /
     executed_command) を emit する責務を持ち、`agents/scripts/run-agent.ts`
     はその JSON を boundary hook 相当の event として re-emit する (Phase 0-d
     推奨、任意)。
3. **Template substitution 失敗 risk**: `${context.prNumber}` /
   `${context.verdictPath}` が未解決のまま subprocess 起動されると、
   `merge-pr.ts` が literal 文字列 "${context.prNumber}" を argv に受け取り
   parse 失敗する。
   - **緩和**: Phase 0-b 実装時に未解決テンプレートを起動前に検査し、
     未解決があれば agent 起動を abort + log。

## 5. ロールアウト段階

| Phase   | 内容                                                                                                                                                                                                 | 影響範囲                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Phase 0 | climpt runtime 拡張 (T14 Phase 0 prerequisites): (a) dispatcher.ts の issue.payload → CLI 引数変換、(b) AgentRunner の `${context.*}` template substitution、(c) closure subprocess runner kind 追加 | runtime 横断、全 agent に影響あり可 — 慎重に互換性検証 |
| Phase 1 | `merge-pr.ts` + `merge-pr_test.ts` (dry-run のみ動作)                                                                                                                                                | merger-cli 単体、影響ゼロ                              |
| Phase 2 | `.agent/workflow-merge.json` + `.agent/merger/agent.json` (validator agent, closure step で runner-mediated に merge-pr.ts を subprocess 起動、Phase 0 runtime 拡張を前提) を追加                    | merger workflow が並走可能になる (F1)                  |
| Phase 3 | reviewer agent の verdict emit 拡張 (3 節)                                                                                                                                                           | reviewer 出力に `verdict_payload` 追加                 |
| Phase 4 | 既存リポジトリでの試験運用 (1-2 PR)                                                                                                                                                                  | 実運用検証                                             |

**Phase 0 は別 PR または本 PR の先行コミットとして独立実装する**。runtime 拡張は
PR Merger 以外の全 agent にも影響し得るため、scope を切り分けて後方互換性検証を
行う。Phase 1 以降は Phase 0 完了を前提として着手する。

各 Phase は (Phase 0 を除き) 独立に merge 可能。Phase 1 は dry-run 限定なので
本番影響なし。Phase 2 完了時点でも、reviewer verdict が emit されていなければ
merge-pr.ts は step 1 (verdict-missing → rejected) で `merge:blocked` に
ラベル付替するだけで安全。

## 6. ロールバック手順

| 対処               | 手順                                                                                                                                          | 影響                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 2 以降の撤退 | `.agent/workflow-merge.json` と `.agent/merger/agent.json` を削除                                                                             | 既存 orchestration に影響なし (F1 並走モデル)                                                                                        |
| Phase 3 の撤退     | `closure_handoff_fields.json` を削除、workflow-impl の拡張を revert                                                                           | reviewer 出力は従来形式に戻る                                                                                                        |
| 完全撤退           | 上記 + `.agent/workflow-merge.json` / `agents/scripts/merge-pr.ts` / `.agent/merger/` 削除                                                    | `BOUNDARY_BASH_PATTERNS` 未変更 (F5) のため手動 `gh pr merge` 時の挙動も不変                                                         |
| Phase 0 の撤退     | runtime 拡張 (dispatcher.ts の payload 展開 / AgentRunner の `${context.*}` template substitution / closure subprocess runner kind) を revert | 全 agent runtime に影響、本設計の撤退だけでなく他機能利用部位の確認要。Phase 0 を他機能が利用していない段階 (先行 revert) が望ましい |

ロールバックは逆順に実行すれば、どの時点でも既存の iterator / reviewer /
workflow.json に対して非破壊で撤退可能。

## Canonical Names 再掲

00-design-decisions.md との整合を保つため本ドキュメントで使う名称を固定する。

- merger-cli: `agents/scripts/merge-pr.ts`
- verdict-store: `.agent/verdicts/<pr-number>.json`
- Phase: `merge-ready` / `merge-blocked` / `merged`
- Label (with prefix): `merge:ready` / `merge:blocked` / `merge:done`
