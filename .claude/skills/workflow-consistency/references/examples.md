# Worked Examples — Valid return-flow vs invalid bypass-loop

R5 (state-mutating return-flow) と R9 (no bypass self-cycle) を 2 つの具体例で示す。実例は `.agent/workflow.json` v1.14.0 系統 (consider → detail → impl の 3 段) を題材にする。

## Example 1: Valid return-flow (現行 `.agent/workflow.json`)

### Phase graph

```
[entry: kind:consider]
       │
       ▼
consider-pending ── considerer (validator) ──┐
       ▲                                     │
       │ (no path back)                      │
       │                                     │
       │  ┌──────────── handoff-detail ──────┘
       │  │                outputPhases.handoff-detail = detail-pending
       │  ▼
detail-pending ── detailer (validator) ──┐
       ▲                                 │
       │                                 │
       │  ┌────────── handoff-impl ──────┘
       │  │              outputPhases.handoff-impl = impl-pending
       │  ▼
impl-pending ── iterator (transformer) ──┐
       │                                 │
       │ outputPhase = done              │
       ▼                                 ▼
[done (terminal)] ◀──────────────────────┘
```

### State mutation per leg

| Leg | Agent | Mutation kind | 確認 |
|-----|-------|---------------|------|
| `consider-pending → detail-pending` | `considerer` (validator) | (a) label change `kind:consider → kind:detail` (orchestrator が `labelMapping` で実施) + (b) comment via `commentTemplates.considererHandoffDetail` + (d) verdict `handoff-detail` emit | workflow.json 内で全て確認可 |
| `detail-pending → impl-pending` | `detailer` (validator) | (a) label change `kind:detail → kind:impl` + (b) comment via `commentTemplates.detailerHandoffImpl` (`## Implementation Spec\n\n{detail_summary}`) + (d) verdict `handoff-impl` emit | workflow.json + per-agent steps_registry.json の closure step で `detail_summary` を produce することを確認 |
| `impl-pending → done` | `iterator` (transformer) | (a) label change `kind:impl → done` + (c) artifact emit (commit / PR) + closeBinding `direct` で issue close | workflow.json + iterator の steps_registry で commit / PR step を確認 |

### Why R5 が満たされる

各 leg で **(a)/(b)/(c)/(d) のいずれか 2 つ以上**が成立している。特に detailer は (b) comment 投稿 + (d) verdict emit + per-agent registry で artifact path を持つため、考察 → 仕様化 → 実装 の chain が **意味のある状態前進** を伴う。

### Why R9 が満たされる

各 agent の output phases を集計:

- `considerer`: `outputPhases = { done: done, handoff-detail: detail-pending }`. `agentPhases(considerer) = {consider-pending}`. `done`, `detail-pending` ∉ `agentPhases(considerer)` → self-cycle なし
- `detailer`: `outputPhases = { handoff-impl: impl-pending, blocked: blocked }`. `agentPhases(detailer) = {detail-pending}`. `impl-pending`, `blocked` ∉ `agentPhases(detailer)` → self-cycle なし
- `iterator`: `outputPhase = done`, `fallbackPhase = blocked`. `agentPhases(iterator) = {impl-pending}`. `done`, `blocked` ∉ `agentPhases(iterator)` → self-cycle なし
- `clarifier`: `outputPhases = { ready-to-impl: impl-pending, ready-to-consider: consider-pending }`, `fallbackPhase = consider-pending`. `agentPhases(clarifier) = {blocked}`. `impl-pending`, `consider-pending` ∉ `agentPhases(clarifier)` → self-cycle なし。逆に clarifier 自身が `blocked` 担当で、`blocked → consider-pending → considerer → detail-pending → ...` という cross-agent 経路で revision loop を構成している (R9 §"Pattern table" の Revision Loop 相当)

### maxCycles validation (R6)

最長 legitimate path (acyclic):
```
blocked → consider-pending → detail-pending → impl-pending → done
  = 4 transitions
```

更に clarifier が `blocked` から戻る path を含めても 5 transitions。`rules.maxCycles = 7` で +2 余裕、`maxConsecutivePhases = 3` で revision stuck も catch。R6 OK。

## Example 2: Invalid bypass-loop (反例)

### 仮想 workflow

```jsonc
{
  "phases": {
    "consider-pending": { "type": "actionable", "priority": 3, "agent": "considerer" },
    "detail-pending":   { "type": "actionable", "priority": 2, "agent": "detailer" },
    "impl-pending":     { "type": "actionable", "priority": 1, "agent": "iterator" },
    "done":             { "type": "terminal" },
    "blocked":          { "type": "blocking" }
  },
  "labelMapping": {
    "kind:consider": "consider-pending",
    "kind:detail":   "detail-pending",
    "kind:impl":     "impl-pending",
    "done":          "done"
  },
  "agents": {
    "considerer": {
      "role": "validator",
      "outputPhases": { "done": "done", "handoff-detail": "detail-pending" },
      "fallbackPhase": "blocked",
      "closeBinding": { "primary": { "kind": "direct" }, "condition": "done" }
    },
    "detailer": {
      "role": "validator",
      // ✗ outputPhases.handoff-impl = impl-pending だが
      // ✗ commentTemplates.detailerHandoffImpl が未定義
      // ✗ per-agent steps_registry の closure step も handoffFields = ["verdict"] のみ (artifact なし)
      "outputPhases": { "handoff-impl": "impl-pending", "blocked": "blocked" },
      "fallbackPhase": "blocked",
      "closeBinding": { "primary": { "kind": "none" } }
    },
    "iterator": {
      "role": "transformer",
      // ✗ outputPhase が iterator 自身の phase (impl-pending) を指す
      "outputPhase": "impl-pending",
      "fallbackPhase": "blocked",
      "closeBinding": { "primary": { "kind": "direct" } }
    }
  },
  "handoff": {
    "commentTemplates": {
      "considererHandoffDetail": "## Specification Requested\n\n{final_summary}"
      // detailerHandoffImpl 欠落
    }
  },
  "rules": { "maxCycles": 5 }
}
```

### R5 違反: detailer leg で state mutation が無い

`considerer → detailer → iterator` の return-flow を構成する各 leg を確認:

| Leg | Agent | (a) label | (b) comment | (c) artifact | (d) verdict | 判定 |
|-----|-------|-----------|-------------|--------------|-------------|------|
| consider-pending → detail-pending | considerer | ✓ (kind:consider → kind:detail) | ✓ (`considererHandoffDetail`) | – | ✓ (handoff-detail emit) | OK |
| detail-pending → impl-pending | **detailer** | ✓ (kind:detail → kind:impl) | ✗ template 不在 | ✗ steps_registry に artifact なし | ✓ (handoff-impl emit) | (a) と (d) のみ |
| impl-pending → impl-pending | iterator | ✗ 同 phase | – | – | – | (R9 で reject 済) |

detailer は (b) (c) を欠く。label と verdict は変わるが、issue body / comment が **何も変化しない** ため、iterator が dispatch されたとき detailer が「何を仕様化したか」が観測できない。iterator は同じ未仕様 issue に取り組み、`done` verdict を出せず `fallbackPhase: blocked` に落ちるか、最悪 `cycle_exceeded` まで grind する。

**Skill report**:
```
[skill:WF-CONSISTENCY-R5] Bypass return-flow detected: agent "detailer" lacks state mutation in leg "detail-pending → impl-pending".
Design: agents/docs/design/realistic/16-flow-completion-loops.md §C, .agent/workflow-issue-states.md §"S2.running の kind 分岐" (detailer's role is to post implementation spec comment, not just verdict)
Fix: Add "detailerHandoffImpl" to workflow.json#handoff.commentTemplates with body referencing {detail_summary} or similar handoffField; or have detailer's per-agent closure step emit an artifact under .agent/climpt/tmp/issues-execute/<N>/.
```

### R9 違反: iterator self-cycle

`iterator.outputPhase = impl-pending` は iterator 自身が担当する phase。retry loop パターン (`fallbackPhase` 経由) ではないため R9 違反。

**Skill report**:
```
[skill:WF-CONSISTENCY-R9] Unbounded forward self-cycle detected: agent "iterator" outputPhase "impl-pending" equals iterator's own dispatch phase.
Design: agents/docs/builder/07_flow_design.md §3.2 (Retry Loop must use fallbackPhase, §3.5 Recovery → Resume requires a separate recovery agent)
Fix: Set iterator.outputPhase to "done" (or another terminal-bound phase). If retry on success failure is desired, move the impl-pending reference into iterator.fallbackPhase and rely on rules.maxCycles for stopping.
```

### R3 collateral: completion point が無い

iterator が self-cycle に閉じている結果、`reach(impl-pending)` の forward 集合は `{impl-pending}` のみで terminal `done` に到達しない。R3 (each agent has a clear completion point) も同時違反。修正は R9 と同じ (outputPhase を done に向ける)。

### Why per-agent `--validate` だけでは検出できないか

- per-agent `flow-validator.ts` は **steps_registry.json 内** の step graph を見る。workflow.json の `outputPhase` / `outputPhases` は対象外
- `workflow-loader.ts` の `validateCrossReferences` は phase / agent ID の **存在** を確認するが、graph 上の意味 (cycle / completion point / state mutation) は確認しない
- したがって R3 / R5 / R6 / R9 は本 skill の手診断 (Process Flow §5–§7) でしか捕まえられない

## Example 3 (補足): Recovery → Resume が R5 R9 を満たす理由

```jsonc
{
  "phases": {
    "a-pending":        { "type": "actionable", "priority": 1, "agent": "A" },
    "recovery-pending": { "type": "actionable", "priority": 2, "agent": "recovery" },
    "done":             { "type": "terminal" },
    "blocked":          { "type": "blocking" }
  },
  "agents": {
    "A": {
      "role": "transformer",
      "outputPhase": "done",
      "fallbackPhase": "recovery-pending",   // recovery への hand off
      "closeBinding": { "primary": { "kind": "direct" } }
    },
    "recovery": {
      "role": "transformer",
      "outputPhase": "a-pending",            // 元 phase に戻す
      "fallbackPhase": "blocked",
      "closeBinding": { "primary": { "kind": "none" } }
    }
  }
}
```

- R9: `A.fallbackPhase = recovery-pending ∉ agentPhases(A) = {a-pending}` → A は self-cycle なし。`recovery.outputPhase = a-pending ∉ agentPhases(recovery) = {recovery-pending}` → recovery も self-cycle なし。`A → recovery → A` の cross-agent loop は revision-loop pattern として承認 (§3.5)
- R5: SCC `{a-pending, recovery-pending}` の各 leg について、A が auth 失敗 / lock 取得失敗 などを fallback path に流すこと自体が (d) verdict emit、recovery が cache 再構築 / token 再取得などの artifact を残せば (c) artifact を満たす
- maxCycles は `A → recovery → A → done = 3` + 余裕で 5 程度

このように **別 agent を挟む** ことで R9 を回避し、recovery agent が実体作業をすれば R5 も満たす。本 skill の R5 / R9 が同時に満たされる canonical な pattern。
