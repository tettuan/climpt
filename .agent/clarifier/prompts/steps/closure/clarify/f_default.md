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

Execute every bash block via `bash -c '...'`. `set -euo pipefail` at
the top of each block. zsh has divergent `!` and here-string semantics
that would cause silent failures.

## Step 1 — Read the issue

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

## Step 2 — Research (evidence-only)

Investigate the question using read-only tools. Gate 1 / 2 require
citations from `.agent/workflow-issue-states.md` and `/CLAUDE.md`.
Gate 3 requires a `path:line` or `symbol` anchor found in the body,
comments, or the codebase via Grep/Glob/Read.

- Use `Grep` / `Glob` / `Read` on the codebase for Gate 3 anchor
  discovery.
- Use `Read` on `.agent/workflow-issue-states.md` and `/CLAUDE.md`
  for Gate 1 / 2 rationales.
- Do NOT read other docs for judgment (source-of-truth discipline).

## Step 3 — Apply the rubric

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

Short-circuit rule: the **first failing gate** determines the
`still-blocked` reason; remaining gates MAY still be evaluated and
recorded (encouraged for transparency) but the verdict is locked.

## Step 4 — Decide verdict

- All 5 gates pass AND issue has `EXISTING_KIND = kind:impl` →
  verdict = `ready-to-impl`.
- All 5 gates pass AND `EXISTING_KIND = kind:consider` →
  verdict = `ready-to-consider`.
- All 5 gates pass AND `EXISTING_KIND` empty → pick via system-prompt
  table (`質問/相談/検討` → `ready-to-consider`, named files/functions
  + bug + repro → `ready-to-impl`, both → `ready-to-consider`).
- Any gate fails → verdict = `still-blocked`.

`EXISTING_KIND = kind:detail` → orchestrator will not dispatch
clarifier to this issue (`blocked` phase only fires when `need
clearance` is the actionable label). If you somehow reach this state
anyway, emit `still-blocked` with `alignment` fail, note =
"detailer-owned, clarifier should not be invoked".

## Step 5 — Compose + post the verdict comment

Follow the template in the system prompt exactly. Write the comment
body to a scratch file first, then post it.

```bash
bash -c '
set -euo pipefail
# Write the comment body to $TMPDIR first (multi-line markdown in
# shell args is fragile).
cat > "$TMPDIR/clarifier-{uv-issue}-comment.md" <<'"'"'EOF'"'"'
## Clarifier verdict: <fill in>

### Judgment (5-gate rubric)
- alignment (Gate 1, incl. Gate 0 kind coherence): <pass|fail> — <note>
- state-machine (Gate 2): <pass|fail> — <note>
- scope (Gate 3): <pass|fail> — <note>
- acceptance (Gate 4): <pass|fail> — <note>
- dependency (Gate 5): <pass|fail> — <note>

### Interpreted scope (only when verdict is ready-*)
- Anchor: <path:line | symbol>
- Strategy: <1-3 lines>
- Acceptance criteria:
  - <bullet>
- References:
  - <workflow-issue-states.md:NN, CLAUDE.md §..., ...>

### Still-blocked reason (only when verdict is still-blocked)
- Failing gate: <alignment | state-machine | scope | acceptance | dependency>
- What would unblock: <concrete criterion the human can act on>
EOF
# (The LLM overwrites the placeholder body before posting.)

gh issue comment {uv-issue} --body-file "$TMPDIR/clarifier-{uv-issue}-comment.md"
'
```

`gh issue comment` is the only write subcommand you may invoke. It is
intentionally unblocked by `BOUNDARY_BASH_PATTERNS`; see
`agents/docs/builder/08_github_integration.md` §「コメント投稿の経路」.

## Step 6 — Emit structured output

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

- `verdict` MUST be `"ready-to-impl"`, `"ready-to-consider"`, or
  `"still-blocked"`.
- For `verdict: "still-blocked"`, at least one `gates[].pass` MUST be
  `false` (schema-enforced via `allOf`/`contains`).
- `rationale.gates` MUST contain exactly 5 entries, one per gate name
  in the enum. Every entry needs a non-empty `note`.
- `next_action.action` is always `"closing"` (single-iteration).

## Step 7 — Final status

Output a single-line summary:

```
clarifier: <verdict> #{uv-issue} (awaiting orchestrator label/phase transition)
```

On failure at any step, stop and report which step failed with the
full command output. Do not retry silently. Do NOT attempt
`gh issue close`, `gh issue edit`, or any label/body mutation.

## Forbidden commands

All of these are blocked by `BOUNDARY_BASH_PATTERNS` (see
`agents/common/tool-policy.ts`). They will be refused at the canUseTool
hook — do not attempt them:

- `gh issue edit <N>` with any option (labels, body, title, state)
- `gh issue close`
- `gh issue reopen` / `delete` / `transfer` / `pin` / `lock`
- `gh label create` / `edit` / `delete`
- `gh api <any-method>`
- `curl https://api.github.com/...` and equivalents via
  `wget` / `python` / `node` / `ruby` / `perl` / `deno`
