---
stepId: clarify
name: Clarify Need-Clearance Issue
description: Single-iteration — read issue, apply 5-gate rubric, post comment, emit verdict. Orchestrator routes via outputPhases.
uvVariables:
  - issue
---

# Task: Clarify issue #{uv-issue}

You process exactly one issue (#{uv-issue}). The orchestrator has
already selected this issue from the `blocked` phase queue. Your job:
apply the 5-gate rubric, post a verdict comment, emit a verdict string.

## Inputs (handoff)

- `{uv-issue}` — GitHub Issue number (uvVariable, required). The
  orchestrator has already dispatched this agent for one specific
  `need clearance` issue.
- Source-of-truth docs (read-only, for Gate 1 / 2 rationales):
  - `.agent/workflow-issue-states.md` (state machine, responsibility matrix)
  - `/CLAUDE.md` (tenets: 全域性 / Core-first / No BC / fallback 最小限 / reviewer precision)
- Codebase access via `Grep` / `Glob` / `Read` — for Gate 3 anchor
  discovery only.

Precondition (R4 fail-fast): the issue MUST carry the `need clearance`
label. The orchestrator's `blocked` phase queue gates this, but
defend in depth: after reading the issue (Action Step 1), if
`labels[].name` does not include `need clearance`, abort with
`status: "failed"` (see `## Verdict` below) — do not proceed to gates.

## Outputs

Emit one JSON object matching `closure.clarify` in
`schemas/clarifier.schema.json`. Required fields:

- `stepId: "clarify"`
- `status: "completed" | "failed"`
- `summary` — one-line human-readable summary
- `next_action.action: "closing"` (always — single-iteration; the
  schema enum is `["closing"]` only)
- `verdict: "ready-to-impl" | "ready-to-consider"`
- `rationale.gates` — exactly 5 entries (alignment, state-machine,
  scope, acceptance, dependency); each with `pass: boolean` and
  non-empty `note`
- `final_summary` — one-paragraph recap of verdict reasoning
  (used as commentTemplates variable on handoff)

Side effect (the only write channel): exactly one comment posted on
issue #{uv-issue} via `gh issue comment` (see `## Action` Step 5).
Comment URL is recorded by `gh` stdout but is not part of the
structured output.

## Verdict

Always emit `next_action.action: "closing"`. This step is
single-iteration (`maxIterations: 1`); the orchestrator owns all
phase / label transitions via `outputPhases`. The schema enum is
`["closing"]` — no other intent is declared, allowed, or emitted.

The `verdict` field (separate from `next_action.action`) routes
phase transitions:

- All 5 gates pass AND `EXISTING_KIND = kind:impl` →
  `verdict = "ready-to-impl"`.
- All 5 gates pass AND `EXISTING_KIND = kind:consider` →
  `verdict = "ready-to-consider"`.
- All 5 gates pass AND `EXISTING_KIND` empty → pick via system-prompt
  rule-of-thumb table (`質問/相談/検討` → `ready-to-consider`,
  named files/functions + bug + repro → `ready-to-impl`, both →
  `ready-to-consider`).
- Any gate fails → `verdict = "ready-to-consider"` (considerer
  absorbs ambiguity; record the failing gate in the comment).

`EXISTING_KIND = kind:detail` → orchestrator will not dispatch
clarifier to this issue (`blocked` phase only fires when `need
clearance` is the actionable label). If you somehow reach this
state anyway, emit `verdict = "ready-to-consider"` with `alignment`
fail, note = "detailer-owned, clarifier should not be invoked".

Fail-fast (R4): if precondition check finds `need clearance` is
absent, emit `status: "failed"`, `verdict: "ready-to-consider"`,
and `summary: "missing need-clearance label — aborted before rubric"`.
Do not post a comment, do not run the rubric.

## Action

Execute every bash block via `bash -c '...'`. `set -euo pipefail` at
the top of each block. zsh has divergent `!` and here-string semantics
that would cause silent failures.

### Step 1 — Read the issue

```bash
bash -c '
set -euo pipefail
gh issue view {uv-issue} \
  --json number,title,body,labels,author,comments \
  > "$TMPDIR/clarifier-{uv-issue}-view.json"
cat "$TMPDIR/clarifier-{uv-issue}-view.json"
'
```

Parse:

- `title`, `body`
- `comments[].body` (read them all, in order)
- `labels[].name` — record `EXISTING_KIND` (`kind:impl` | `kind:consider`
  | `kind:detail` | empty)

Alternative read path: use the GitHubRead MCP tool
(`mcp__github__github_read` with `operation: "issue_view"`,
`number: {uv-issue}`).

**Precondition check (fail-fast)**: if `labels[].name` does NOT
contain `need clearance`, stop here. Skip Steps 2–5 and emit
`status: "failed"` per `## Verdict` fail-fast clause.

### Step 2 — Research (evidence-only)

Investigate the question using read-only tools. Gate 1 / 2 require
citations from `.agent/workflow-issue-states.md` and `/CLAUDE.md`.
Gate 3 requires a `path:line` or `symbol` anchor found in the body,
comments, or the codebase via Grep/Glob/Read.

- Use `Grep` / `Glob` / `Read` on the codebase for Gate 3 anchor
  discovery.
- Use `Read` on `.agent/workflow-issue-states.md` and `/CLAUDE.md`
  for Gate 1 / 2 rationales.
- Do NOT read other docs for judgment (source-of-truth discipline).

### Step 3 — Apply the 5-gate rubric

Evaluate in order. Record pass/fail + short note per gate.

1. **Gate 0 — kind coherence** (encoded inside `alignment`):
   - If `EXISTING_KIND` is non-empty, check whether your natural
     judgment matches. Mismatch → `alignment` = fail, note =
     "kind-conflict: existing `kind:X`, natural judgment `kind:Y`".
2. **Gate 1 — alignment (CLAUDE.md tenets)**: 全域性 / Core-first /
   No BC / fallback 最小限 / reviewer precision.
3. **Gate 2 — state-machine legality (workflow-issue-states.md)**:
   S0..S5 transitions legal, responsibility matrix respected.
4. **Gate 3 — scope definiteness**: at least one `path:line` or
   `symbol` anchor nameable from body + comments (+ codebase verify).
5. **Gate 4 — acceptance criteria realizable**: at least one
   machine-checkable criterion (command exit, label state, output
   substring).
6. **Gate 5 — dependency resolvable**: no unresolved external deps
   mentioned. Pure function — no `gh issue view #DEP` recursion.

Short-circuit rule: the **first failing gate** determines the comment's
"Failing gate" line. Remaining gates MUST still be evaluated and
recorded (the schema requires all 5 entries). The verdict itself is
locked to `ready-to-consider` as soon as any gate fails.

### Step 4 — Decide verdict

Apply the rules in `## Verdict` above to pick
`ready-to-impl` or `ready-to-consider`.

### Step 5 — Compose + post the verdict comment

Follow the template in the system prompt exactly. Write the comment
body to a scratch file first, then post it.

```bash
bash -c '
set -euo pipefail
# Write the comment body to $TMPDIR first (multi-line markdown in
# shell args is fragile).
cat > "$TMPDIR/clarifier-{uv-issue}-comment.md" <<'"'"'EOF'"'"'
## Clarifier verdict: <ready-to-impl | ready-to-consider>

### Judgment (5-gate rubric)
- alignment (Gate 1, incl. Gate 0 kind coherence): <pass|fail> — <note>
- state-machine (Gate 2): <pass|fail> — <note>
- scope (Gate 3): <pass|fail> — <note>
- acceptance (Gate 4): <pass|fail> — <note>
- dependency (Gate 5): <pass|fail> — <note>

### Interpreted scope (when any gate passed — always for ready-to-impl)
- Anchor: <path:line | symbol>
- Strategy: <1-3 lines>
- Acceptance criteria:
  - <bullet>
- References:
  - <workflow-issue-states.md:NN, CLAUDE.md §..., ...>

### Gate failures (only when at least one gate failed — verdict is ready-to-consider)
- Failing gate: <alignment | state-machine | scope | acceptance | dependency>
- What would unblock: <concrete criterion the human or considerer can act on>
EOF
# (The LLM overwrites the placeholder body before posting.)

gh issue comment {uv-issue} --body-file "$TMPDIR/clarifier-{uv-issue}-comment.md"
'
```

`gh issue comment` is the only write subcommand you may invoke. It is
intentionally unblocked by `BOUNDARY_BASH_PATTERNS`; see
`agents/docs/builder/08_github_integration.md` §「コメント投稿の経路」.

### Step 6 — Emit structured output

Return a JSON object matching `closure.clarify` in
`schemas/clarifier.schema.json`:

```json
{
  "stepId": "clarify",
  "status": "completed",
  "summary": "<one-line summary>",
  "next_action": { "action": "closing" },
  "verdict": "ready-to-impl",
  "rationale": {
    "gates": [
      { "gate": "alignment",      "pass": true,  "note": "within Climpt core scope, kind:impl coherent" },
      { "gate": "state-machine",  "pass": true,  "note": "executor → orchestrator close boundary respected" },
      { "gate": "scope",          "pass": true,  "note": "anchor: agents/verdict/external-state-adapter.ts:197" },
      { "gate": "acceptance",     "pass": true,  "note": "deno test passes, label set matches expected" },
      { "gate": "dependency",     "pass": true,  "note": "no external deps mentioned" }
    ]
  },
  "final_summary": "<one-paragraph recap of verdict reasoning>"
}
```

Rules:

- `verdict` MUST be `"ready-to-impl"` or `"ready-to-consider"`.
- `rationale.gates` MUST contain exactly 5 entries, one per gate name
  in the enum. Every entry needs a non-empty `note`.
- Gate failure is recorded via `gates[].pass = false` and surfaced in
  the comment's "Gate failures" section. The verdict itself remains
  `ready-to-consider` — no self-loop back to `blocked`.
- `next_action.action` is always `"closing"` (single-iteration).

### Step 7 — Final status

Output a single-line summary:

```
clarifier: <verdict> #{uv-issue} (awaiting orchestrator label/phase transition)
```

On failure at any step, stop and report which step failed with the
full command output. Do not retry silently. Do NOT attempt
`gh issue close`, `gh issue edit`, or any label/body mutation.

## Do ONLY this

The single required action: read issue #{uv-issue}, apply the 5-gate
rubric, post exactly one comment, emit one JSON object per the schema.

Forbidden — all blocked by `BOUNDARY_BASH_PATTERNS` (see
`agents/common/tool-policy.ts`); they will be refused at the
canUseTool hook, do not attempt them:

- `gh issue edit <N>` with any option (labels, body, title, state)
- `gh issue close`
- `gh issue reopen` / `delete` / `transfer` / `pin` / `lock`
- `gh label create` / `edit` / `delete`
- `gh api <any-method>`
- `curl https://api.github.com/...` and equivalents via
  `wget` / `python` / `node` / `ruby` / `perl` / `deno`

Also forbidden:

- Editing the issue body (C3 — comment-only)
- Touching `order:N` labels (C2 — triager responsibility)
- Inventing scope not justified by body + comments
- Recursing into dependencies (`gh issue view #DEP` etc.)
- Emitting any `next_action.action` other than `"closing"` (schema
  enum is `["closing"]` only — any other value is a schema violation)
