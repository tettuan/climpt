---
stepId: triage
name: Triage Single Issue
description: Per-issue classification — read, classify, emit closing SO with labels.
uvVariables:
  - issue
  - workflow
---

# Task: Triage one open GitHub Issue

You are dispatched with `--issue {uv-issue}`. Classify it into one of
`kind:impl`, `kind:consider`, `kind:design`, pick the smallest unused
`order:N`, and emit a closing structured output. The poll:state boundary
hook will apply both labels via `gh issue edit`. Do **not** call
`gh issue edit` yourself.

The triage-eligibility predicate is derived dynamically from the workflow
JSON passed via `--workflow` ({uv-workflow}) — specifically the union of
`labelMapping` keys and `prioritizer.labels`. Issues carrying unrelated
labels such as `enhancement`, `bug`, `documentation` are still eligible.

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

## Step 1 — Verify eligibility against workflow labels

Compute the workflow label set, then check the target's existing labels.

```bash
bash -c '
set -euo pipefail
WORKFLOW="{uv-workflow}"

if [ ! -f "$WORKFLOW" ]; then
  echo "workflow JSON not found: $WORKFLOW" >&2
  exit 1
fi

WORKFLOW_LABELS=$(jq -r "
  [ (.labelMapping // {} | keys[]),
    (.prioritizer.labels // [])[] ]
  | unique[]
" "$WORKFLOW")

ISSUE_LABELS=$(gh issue view {uv-issue} --json labels | jq -r ".labels[].name")

# Print intersection — non-empty means already triaged
comm -12 <(echo "$WORKFLOW_LABELS" | sort -u) <(echo "$ISSUE_LABELS" | sort -u)
'
```

If the intersection is non-empty, the issue already carries a workflow
label — abort: emit closure SO with `status: "failed"` and a summary
naming the conflicting label. Do not emit `issue.labels.add`. Stop.

## Step 2 — List `order:N` already in use on open issues

```bash
bash -c '
set -euo pipefail
gh issue list --state open --search "-label:done" --json labels \
  | jq -r ".[] | .labels[].name" \
  | grep -E "^order:[1-9]$" \
  | sort -u
'
```

Call this set `USED`. The available set is `{order:1..order:9} \ USED`,
iterated in ascending numeric order. Pick the smallest member as
`order:N`. If `USED` covers the full range, abort: emit closure SO with
`status: "failed"` and `summary: "no order:N capacity available"`. Stop.

The `-label:done` filter is a safety net: with `closeOnComplete` in the
execute workflow, done issues are closed and excluded by `--state open`
already, but the explicit filter guards against the rare case where a
done-labeled issue remains open due to close failure.

## Step 3 — Classify the issue

Apply the classification heuristics from the system prompt to the
`title + body` you fetched in Step 0. Choose exactly one of:

- `kind:impl` — concrete code/config change, scope clear
- `kind:consider` — question, design review, decision-needed
- `kind:design` — design document or architectural blueprint requested

When `impl` and `consider` both apply, prefer `kind:consider`.

## Step 4 — Emit closing structured output

Output **only** the closure structured output as your final assistant
message. Do not call `gh issue edit`. The boundary hook handles labels.

```json
{
  "stepId": "triage",
  "status": "completed",
  "summary": "classified #{uv-issue} as <kind>, <order>",
  "next_action": { "action": "closing" },
  "issue": {
    "number": {uv-issue},
    "labels": {
      "add": ["<kind>", "<order>"]
    }
  }
}
```

Replace `<kind>` with the chosen `kind:impl|kind:consider|kind:design`
and `<order>` with the chosen `order:N`. The `add` array MUST contain
exactly two strings, in that order.

Do not write any files. Do not post issue comments. Do not call
`gh issue edit` — the boundary hook owns label mutations.
