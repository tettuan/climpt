# Graph Rules — Formal Definition

`workflow.json` を有向グラフとして抽象化し、9 rule (R1–R9) を node / edge / SCC の用語で確定する。本 doc は SKILL.md §"Decision Rules" の formal companion。

## Notation

- `P` = `phases` の key 集合 (PhaseId)
- `A` = `agents` の key 集合 (AgentId)
- `phaseAgent: P → A ∪ {⊥}` — `phases[p].agent` (actionable のみ非 ⊥)
- `agentPhases: A → 2^P` — `phaseAgent⁻¹` (1 agent が複数 phase を担当しうる)
- `kind: P → {actionable, terminal, blocking}` — `phases[p].type`
- `outForward: A → 2^P` — `outputPhase ∪ outputPhases.values()` (transformer なら singleton, validator なら N)
- `outFallback: A → 2^P` — `fallbackPhase ∪ fallbackPhases.values()`
- `out: A → 2^P` — `outForward(a) ∪ outFallback(a)`
- `labelMap: GhLabel → P` — `labelMapping`
- `entry: 2^P` — `labelMap.values()` (initial label から到達可能な phase)
- `closeBinding: A → ClosePrimary` — `agents[a].closeBinding.primary.kind` ∈ `{direct, boundary, outboxPre, custom, none}`

## Phase Graph G = (V, E)

`V := P`, `E := { (p → q) | ∃ a ∈ A. phaseAgent(p) = a ∧ q ∈ out(a) }`.

各 edge には label を付ける: `forward` (`outForward`) / `fallback` (`outFallback`) / `entry` (`labelMap` 由来の virtual edge `⊥ → p`)。

## Rule Statements

### R1: 1 agent = 1 purpose

`∀ a ∈ A`:
- `agents[a].directory` が unique (collision 不可)
- agent の goal verb (CLAUDE.md / per-agent README で declare) が **単一**
- 違反検出: `directory` collision、または goal 文に「と」「+」「および」が含まれる場合

source: `.agent/CLAUDE.md` §"Directory layout".

### R2: Role purity

`∀ a ∈ A`:
- `role = "transformer" ⇒ outputPhase ∈ P` (singleton, schema enforced via `allOf`)
- `role = "validator" ⇒ outputPhases: P^N` (N ≥ 1)
- `role = "transformer" ∧ fallbackPhases ≠ ∅ ⇒` validator 昇格を検討 (warning)

source: `agents/orchestrator/workflow-schema.json` `properties.agents.additionalProperties.allOf`, `agents/docs/builder/07_flow_design.md` §1.1 / §1.5.

### R3: Completion point per agent

`∀ a ∈ A` (a が actionable phase で参照される場合):
`∃ q ∈ outForward(a). reach(q) ∩ {p ∈ P | kind(p) = terminal} ≠ ∅`

ここで `reach(q)` は q から G で到達可能な phase 集合。`fallbackPhase` 経由の terminal だけでは満たさない (= happy path に terminal を要求)。

source: `agents/docs/builder/07_flow_design.md` §"設計の手順" Step 1 "Done Criteria を定義".

### R4: Reachability from entry

`∀ p ∈ P. ∃ e ∈ entry. p ∈ reach(e) ∪ {e}`

つまり全 phase は initial label-driven entry のいずれかから forward/fallback edge を辿って到達可能。違反 = orphan phase。

source: `agents/docs/design/realistic/12-workflow-config.md` §F W4 "nextPhase 参照" の延長 (本 skill 側で `labelMapping` を含めて closure を取る)。

### R5: State-mutating return-flow (本 skill 固有)

`G` の SCC `S` (size ≥ 2) について、`S` を構成する全 phase の `phaseAgent(p) = a_p` を取り、 `cycle agents = {a_p | p ∈ S}` の各 agent が以下のいずれかを満たす:

- (a) `outForward(a_p) ∪ outFallback(a_p)` の遷移先が **異なる label** (`labelMap` の inverse) を持つ phase
- (b) `workflow.handoff.commentTemplates` に該当 key (`{a_p}{Outcome}` / `{a_p}To{Outcome}`) が存在し本文 ≠ ""
- (c) per-agent `steps_registry.json` の closure step が `handoffFields` に artifact key を declare (skill 外参照)
- (d) `role = "validator"` かつ `outputPhases` の verdict key が SO `outputSchemaRef` の enum に含まれる

`∀ a ∈ cycle agents. (a) ∨ (b) ∨ (c) ∨ (d)`. 1 agent でも全条件を満たさなければ R5 違反。

source: `.agent/workflow-issue-states.md` §"S2.running の kind 分岐", `agents/docs/design/realistic/16-flow-completion-loops.md` §C "CompletionLoop", §F "SO single hinge".

**Why state mutation が必須か**: phase graph 上 cycle が閉じても、loop の各 leg が「label を変える」「comment を投げる」「artifact を出す」「verdict を emit する」のいずれかを行わないと、issue は同じ未変化の状態で再 dispatch され `maxCycles` まで grind する。これは structural reachability では検出できないため per-leg invariant として要求する。

### R6: Cycle bound consistency

- `longestPath(G_acyclic) := max { len(p₀ → p₁ → ... → pₙ) | p₀ ∈ entry, pₙ ∈ terminal phases, no SCC re-entry }`
- `rules.maxCycles ≥ longestPath(G_acyclic) + 1`
- G に SCC (size ≥ 2) が存在する場合 `rules.maxConsecutivePhases ∈ [3, maxCycles - 1]`

source: `agents/docs/builder/07_flow_design.md` §2.3 "収束の保証", §2.4 "Phase Repetition Limit".

### R7: Explicit closeBinding on terminal-producing agents

`∀ a ∈ A`:
- `outForward(a) ∩ {p | kind(p) = terminal} ≠ ∅ ⇒ closeBinding(a) ∈ {direct, boundary, outboxPre, custom}` (= ≠ none, 明示宣言)
- `outForward(a) ∩ {p | kind(p) = terminal} = ∅ ⇒ closeBinding(a) = none` (省略でも default は none、明記推奨)

source: `agents/docs/builder/06_workflow_setup.md` §"Close binding (per agent)" / §"旧 field からの移行".

#### R7-Exception: sentinel-reuse pattern

通常 rule の唯一の例外。terminal を出力しても `closeBinding(a) = none` を許容する条件を formal に定める。

**R7-Exception (Sentinel-reuse pattern)** — A `transformer` agent emitting to a terminal phase MAY set `closeBinding.primary.kind: "none"` if BOTH:

1. The agent operates exclusively on a sentinel subject identified by a marker label, and that label is declared in `workflow.json#labels` with `role: "marker"`. (Full `projectBinding` declaration is REQUIRED only when the workflow also activates cascade-close or parent-project inheritance — see Q2 in `references/examples.md`. Close-skip alone needs only the marker-label declaration.)
2. The agent's prompt or README explicitly documents the sentinel reuse contract — verbatim wording such as "Sentinel reuse — must not be closed" — naming the label and the rationale for skipping close.

If either condition fails, fall back to R7 strict (`closeBinding.primary.kind` must be `direct` or `boundary` for terminal-phase transformers).

formal に書くと:

```
markerDeclared(a) := ∃ ℓ ∈ workflow.labels. role(ℓ) = "marker" ∧ ∀ s ∈ subjects(a). ℓ ∈ labels(s)
documented(a)     := agent a の prompt / README が sentinel reuse を verbatim wording で明記

markerDeclared(a) ∧ documented(a) ⇒ closeBinding(a) = none を許容
```

`projectBinding.sentinelLabel` は cascade-close / parent-project inheritance が必要な場合に限り required。close-skip だけが目的なら marker-label 宣言で十分。

**Justification の要件**: reviewer は exception 主張側に対し、agent prompt または `.agent/<a>/README.md` の該当箇所 (sentinel reuse 旨の記述) の path + line citation を要求する。citation が無い `kind: none` は通常 R7 違反として扱う。

**False negative リスク警告**: exception を誤って主張すると、本来 close すべき issue が滞留する。具体的には sentinel でない subject 経由で agent が dispatch された場合、`{ primary: "none" }` のため `done` ラベル付きで永久に open。リスク mitigation:

- exception 主張時は subject の label 制約 (marker label 必須) を steps_registry / agent.json の precondition に明文化することを推奨
- 通常の `direct` close と sentinel `none` を **同一 agent で混在** させない (single-purpose 原則 R1 と整合)。混在が必要なら別 agent に分割する

**現行 example**: `.agent/workflow.json` の `project-planner` (`outputPhase: "done"`, `closeBinding.primary.kind: "none"`) は本 exception の正例。`labels.project-sentinel.role: "marker"` で marker label として宣言され、`.agent/project-planner/prompts/system.md` に "Sentinel reuse — must not be closed" を明記。`agents/scripts/project-init.ts:108-113` で生成される sentinel issue (body に "Do not close manually." 明記) を反復 trigger として使う設計のため、`agents/orchestrator/orchestrator.ts:1187-1224` の `DirectClose.handleTransition` を発火させない。`projectBinding` ブロックは未宣言だが、close-skip のみが目的のため exception 条件を満たす。

source (exception): `agents/scripts/project-init.ts:108-113` (sentinel 生成 + "Do not close manually."), `agents/orchestrator/orchestrator.ts:1187-1224` (DirectClose semantics), commit `1a51c30` (`closeOnComplete: false` → ADT migration での `kind: "none"` 継承).

### R8: fallbackPhase coverage

`∀ a ∈ A. fallbackPhase(a) ∈ P` (省略禁止)。schema 上は optional だが、`computeTransition` の throw 挙動 (`agents/orchestrator/phase-transition.ts:23-44`) を回避するため strict に要求する。

source: `agents/docs/builder/07_flow_design.md` §1.1 "重要な throw 挙動".

### R9: No bypass self-cycle

`∀ a ∈ A. ∀ q ∈ out(a). q ∈ agentPhases(a) ⇒` 以下のいずれか:

- (i) `q ∈ outFallback(a)` (= retry loop) かつ `rules.maxCycles ≥ 2` (= 停止条件あり)
- (ii) `q ∈ outForward(a)` だが、別 agent `b ≠ a` が `q ∈ out(b)` で経由する path も存在 (= revision loop; q への入り方が複数あり、a 単独 self-cycle ではない)
- 上記いずれも満たさない self-cycle は **禁止**

source: `agents/docs/builder/07_flow_design.md` §3.2 (Retry Loop 明示パターン) / §3.3 (Revision Loop) / §3.5 (Recovery → Resume).

## SCC and Bypass-Loop Invariant

R5 と R9 は SCC 解析を共有する:

1. G から SCC `{S₁, ..., Sₖ}` を計算 (Tarjan / Kosaraju)
2. `|Sᵢ| = 1`:
   - そもそも cycle なし (skip)、または
   - self-loop (Sᵢ の唯一 phase pᵢ について `pᵢ ∈ out(phaseAgent(pᵢ))`) → R9 へ
3. `|Sᵢ| ≥ 2`: cross-agent return-flow → R5 へ
4. SCC が terminal phase に到達可能 (`reach(Sᵢ) ∩ {p | kind(p) = terminal} ≠ ∅`) でなければ即 R3 違反 (該当 agent の completion point 不在)

`flow-validator.ts` は per-agent step graph で SCC を計算する。本 skill は **phase graph (cross-agent)** で同じ計算を行う点が責務分担。

## Edge Type Summary

| Edge label | source field | 目的 | R5 で count するか |
|------------|--------------|------|--------------------|
| `forward` | `outputPhase` / `outputPhases.<key>` | happy path / verdict 分岐 | yes (state mutation の primary surface) |
| `fallback` | `fallbackPhase` / `fallbackPhases.<key>` | error / unknown outcome | yes (recovery agent への hand off も state mutation) |
| `entry` | `labelMap.values()` (virtual `⊥ → p`) | initial dispatch | no (entry は state mutation の対象外) |

R5 / R9 は `forward` + `fallback` のみで closure を取る。`entry` は SCC 解析の seed として扱うが loop 構成 edge には含めない。
