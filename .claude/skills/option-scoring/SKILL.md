---
name: option-scoring
description: MUST run before recommending when 2+ implementation options are compared. Triggers: '選択肢を並べて', '案を比較', '設計適合度', 'tradeoff', 'which approach'. Scores each option on weighted axes (climpt fixed spine + 2–3 doc-cited derived), outputs a matrix with fit % and DQ rule for w=2 violations, picks the highest non-DQ option with a single reason.
allowed-tools: [Read, Grep, Glob]
---

# Option Scoring

Score N implementation candidates against a small fixed spine of project principles plus task-specific axes derived from the relevant design doc. Output: comparison matrix + trade-off narrative + recommendation with reversal conditions.

## When to Use

**Always run this skill when presenting two or more implementation options.** Enumerating options without scoring them leaves the user to do the design-fit work — that is the failure mode this skill exists to prevent.

Trigger conditions:

- About to write "Option A / Option B", "案1 / 案2", or any numbered/bulleted list of approaches
- Comparing candidates for a decision that is reversible only at high cost (schema, CLI shape, persistence format, public API)
- User explicitly asks for trade-off analysis or 適合度評価

Skip only when:

- There is genuinely one option (no comparison to make)
- The choice is pure style with no design consequence (naming a local variable)
- The user explicitly says "don't score, just list"

## Phase 1: Anchor the Axes

### Fixed spine (always included)

Climpt's core tenets from `CLAUDE.md`:

| Axis | Question |
|------|----------|
| 全域性 | Does it handle the full domain, or leave undefined corners? |
| Core-first (惑星モデル) | Does it build from the core, or patch at the edge? |
| No backward-compat | Does it avoid carrying dead weight for old callers? |
| Fallback minimality | Are fallback branches small, explicit, and few? |
| Reviewer precision | Will it survive 激的に細かい review without rework? |

### Derived axes (2–3 per task)

Read the relevant design doc (`docs/internal/*`, `agents/docs/*`, or a user-cited constraint) and extract axes that matter for **this** decision. Examples:

- Prompt resolution change → `edition/adaptation coverage`, `breakdown wrapper compatibility`
- CLI option change → `unified-help-concept fit`, `--help protocol stability`
- Agent runner change → `definition.parameters purity`, `verdict-type correctness`

Every derived axis must cite a source line: `from docs/internal/unified-help-concept.md §3`. If no citation is possible, the axis is invented — drop it.

## Phase 2: Enumerate Options

List options as `Option A`, `Option B`, … . Each option gets:

- **Sketch** (1 sentence): what it does
- **Change surface**: which files/modules it touches
- **Cost signal**: new code / removed code / migration shape

Do not pre-rank here — just lay them out at the same abstraction level. If one option is described as a design shape and another as an implementation detail, re-level before scoring.

## Phase 3: Score Matrix (Quantified)

### Scoring scale

Each axis is scored 0 / 1 / 2:

| Symbol | Score | Meaning |
|:------:|:-----:|---------|
| ✓ | **2** | Aligns — no friction |
| △ | **1** | Partial — friction exists but manageable |
| ✗ | **0** | Violates — requires an exception or breaks the principle |

### Weights

Each axis carries a weight `w ∈ {1, 2}`:

- **w = 2** — critical / non-negotiable (a violation here likely sinks the option)
- **w = 1** — supportive (a violation here costs quality but does not sink the option)

Default weights for the fixed spine:

| Axis | Default weight | Why |
|------|:--------------:|-----|
| 全域性 | **2** | Foundational — partial-domain solutions are not acceptable |
| Core-first (惑星モデル) | **2** | Foundational — edge-patches accumulate complexity |
| No backward-compat | 1 | Quality concern, not a foundational gate |
| Fallback minimality | 1 | Quality concern |
| Reviewer precision | 1 | Quality concern |

Derived axes default to `w = 1`. Raise to `w = 2` only when the cited doc explicitly marks the constraint as blocking (e.g. "MUST", "non-negotiable", "breaks the protocol").

### Aggregation

For each option:

- `total = Σ(score × weight)` across all axes
- `max   = Σ(2 × weight)` — same denominator for every option
- `fit % = total / max`

### Disqualification rule

An option is **DQ** (disqualified) if **any axis with `w = 2` scores 0**, regardless of total. Foundational violations cannot be outweighed by quality wins elsewhere. A DQ option may still be presented for context, but it cannot be the recommendation.

### Example

| Axis | w | Option A | Option B | Option C |
|------|:-:|:--------:|:--------:|:--------:|
| 全域性 | 2 | ✓ (2) | △ (1) | ✓ (2) |
| Core-first | 2 | ✗ (0) | ✓ (2) | ✓ (2) |
| No backward-compat | 1 | ✓ (2) | ✓ (2) | △ (1) |
| Fallback minimality | 1 | ✓ (2) | ✓ (2) | ✗ (0) |
| Reviewer precision | 1 | △ (1) | ✓ (2) | △ (1) |
| *(derived)* edition coverage | 1 | ✓ (2) | ✗ (0) | ✓ (2) |
| *(derived)* breakdown compat | 1 | ✓ (2) | ✓ (2) | △ (1) |
| **Weighted total** | | 13/18 | 15/18 | 14/18 |
| **Fit %** | | 72% | **83%** | 78% |
| **DQ?** | | **DQ** (Core-first, w=2 scored 0) | — | — |

Every ✗ and △ must have a one-line rationale directly below the table. Every weight that deviates from the default must also have a one-line rationale ("Reviewer precision raised to w=2 because PR will go through external auditor").

## Phase 4: Trade-off Narrative

After the matrix, write:

1. **Dominant axis** — which axis actually drives the decision (often the highest-weight axis where options diverge)
2. **What each option sacrifices** — one sentence per option, citing the axes where it lost points
3. **Recommendation** — the pick (highest fit % among non-DQ options), and the single reason it wins
4. **Reversal conditions** — what new signal would flip the recommendation (typically: a weight change, or a new axis surfacing)

If the top two non-DQ options are within **5 percentage points**, declare it a near-tie and name the tie-breaker axis explicitly — do not let the numeric ranking hide a judgment call.

## Output Template

```
## Decision: <short title>

### Options
- Option A: <sketch>
- Option B: <sketch>
- Option C: <sketch>

### Axes (sources)
- Fixed: 全域性 / Core-first / No backward-compat / Fallback / Reviewer
- Derived: <axis> (<doc>§<section>)

### Matrix
<scored table including w column, weighted total, fit %, DQ?>

Rationale for ✗/△:
- A × Core-first (score 0): <reason>
- B × 全域性 (score 1): <reason>
- ...

Rationale for non-default weights (omit if all weights are default):
- <axis>: raised to w=2 because <reason>

### Trade-offs
- Option A sacrifices: …
- Option B sacrifices: …
- Option C sacrifices: …

### Recommendation
Option <X> — because <single reason tied to dominant axis>.
Reverse if: <signal>.
```

## Anti-Patterns

- **Invented axes**: derived axes without a doc citation — drop them
- **Score inflation**: every option scores ✓ everywhere — axes are too coarse, split them
- **Hidden options**: sketching a 4th option mid-analysis — restart Phase 2 so all options are at parity
- **Narrative without matrix**: trade-off prose with no scored grid — scores must anchor the prose
- **Dead-level compare**: scoring Option A's *implementation detail* against Option B's *design shape* — re-level first
- **Tie-avoidance**: ranking without naming a *dominant* axis — ties come from missing the real driver, not from genuine equivalence
- **Weight gaming**: bumping a weight to make the preferred option win — weights must be set before scoring and justified against the cited doc, not adjusted to fit the conclusion
- **DQ ignoring**: recommending an option that violates a w=2 axis because its total is high — DQ is absolute, not advisory
- **False precision**: reporting fit % to decimal places — the underlying scale is 0/1/2; round to whole percent

## Checklist

```
Phase 1: - [ ] Fixed spine listed
         - [ ] 2–3 derived axes cited with doc source
Phase 2: - [ ] All options sketched at the same level with change surface
Phase 3: - [ ] Weights set (default unless cited reason given) before scoring
         - [ ] Matrix filled; every ✗/△ has a one-line rationale
         - [ ] Weighted total, fit %, and DQ status computed for each option
Phase 4: - [ ] Dominant axis named
         - [ ] Recommendation = highest fit % among non-DQ options
         - [ ] Near-tie (≤5pp gap) flagged with explicit tie-breaker
         - [ ] Reversal condition stated
```

## References

- `CLAUDE.md` — fixed spine source
- `docs/internal/` — derived axes source
- `docs-writing` skill — if the decision produces a doc, apply 5-level framework after the pick
- `simplify` skill — if the chosen option still feels heavy, run simplify on it before committing
