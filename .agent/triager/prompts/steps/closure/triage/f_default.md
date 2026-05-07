---
stepId: triage
name: Triage Single Issue
description: Per-issue classification — read, classify, emit closing SO with the kind label.
uvVariables:
  - issue
  - workflow
---

# Task: Classify one open GitHub Issue

You are dispatched with `--issue {uv-issue}`. Classify it into one of
`kind:impl`, `kind:detail`, `kind:consider`, `kind:plan` (the `kind:*`
subset of `workflow.json#labelMapping`), and emit a closing structured
output. The poll:state boundary hook applies the chosen label via
`gh issue edit`. Do **not** call `gh issue edit` yourself. You do **not**
assign `order:N` — that is the prioritizer's role.

The eligibility predicate is "carries no `kind:*` label". The kind label
set is derived from the workflow JSON passed via `--workflow`
({uv-workflow}) — specifically the entries of `labelMapping` whose keys
start with `kind:`. Other workflow labels (`order:*`, `done`,
`need clearance`) and unrelated tags (`enhancement`, etc.) do not affect
eligibility.

Execute every bash block via `bash -c '...'`. zsh has divergent semantics
for `!` negation and here-strings that cause silent failures. `set -euo
pipefail` at the top of each block.

## Step 0 — Read target issue

```bash
bash -c '
set -euo pipefail
gh issue view {uv-issue} --json number,title,body,labels,state
'
```

If `state` is not `OPEN`, abort: emit closure SO with `status: "failed"`
and a summary `"issue #{uv-issue} is not open (state=<state>)"` — do not
emit `issue.labels.add`. Stop.

## Step 1 — Verify eligibility (no kind:* present)

Compute the `kind:*` label set from the workflow JSON, then check the
target's existing labels.

```bash
bash -c '
set -euo pipefail
WORKFLOW="{uv-workflow}"

if [ ! -f "$WORKFLOW" ]; then
  echo "workflow JSON not found: $WORKFLOW" >&2
  exit 1
fi

KIND_LABELS=$(jq -r "
  .labelMapping // {}
  | keys[]
  | select(startswith(\"kind:\"))
" "$WORKFLOW")

ISSUE_LABELS=$(gh issue view {uv-issue} --json labels | jq -r ".labels[].name")

# Print intersection — non-empty means already classified
comm -12 <(echo "$KIND_LABELS" | sort -u) <(echo "$ISSUE_LABELS" | sort -u)
'
```

If the intersection is non-empty, the issue already carries a `kind:*`
label — abort: emit closure SO with `status: "failed"` and a summary
naming the conflicting label. Do not emit `issue.labels.add`. Stop.

## Step 2 — Classify the issue

Apply the classification heuristics from the system prompt to the
`title + body` you fetched in Step 0. Choose exactly one of:

- `kind:impl` — concrete code/config change with clear scope and
  acceptance condition (→ iterator)
- `kind:detail` — implementation specification (target files, functions,
  approach, acceptance criteria) needed before iterator can pick it up
  (→ detailer)
- `kind:consider` — question, design review, decision-needed
  (→ considerer)
- `kind:plan` — project-level sentinel asking the planner to derive
  follow-up issues from the project README goal vs current state
  (→ project-planner)

Apply tie-breakers from the system prompt:
1. consider vs detail → consider
2. impl vs consider → consider
3. impl vs detail → detail
4. `kind:plan` is sentinel-only — never pick it for a single feature
   request.

## Step 3 — Emit closing structured output

Output **only** the closure structured output as your final assistant
message. Do not call `gh issue edit`. The boundary hook handles labels.

```json
{
  "stepId": "triage",
  "status": "completed",
  "summary": "classified #{uv-issue} as <kind>",
  "next_action": { "action": "closing" },
  "issue": {
    "number": {uv-issue},
    "labels": {
      "add": ["<kind>"]
    }
  }
}
```

Replace `<kind>` with the chosen
`kind:impl|kind:detail|kind:consider|kind:plan`.
The `add` array MUST contain exactly one string.

Do not write any files. Do not post issue comments. Do not call
`gh issue edit` — the boundary hook owns label mutations.
