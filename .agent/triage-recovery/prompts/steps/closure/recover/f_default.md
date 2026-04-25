---
stepId: recover
name: Recover Single Orphan Issue
description: Per-issue closure — assess one issue's eligibility, compute orphan labels, emit issue.labels.remove. Boundary hook applies the removal.
uvVariables:
  - issue
  - workflow
---

# Task: Strip orphan workflow labels from a single OPEN issue

The CLI passes `--issue {uv-issue}` and `--workflow {uv-workflow}`.
Treat issue `#{uv-issue}` as your entire scope. Do not iterate over
other issues.

Predicates are derived **dynamically** from the workflow JSON. Do not
hardcode label names. The workflow set adapts automatically when phases
are added or removed.

Execute every bash block via `bash -c '...'`. zsh (the login shell on
macOS) has divergent semantics for `!` negation and here-strings that
cause silent failures. Use `set -euo pipefail` at the top of each block.

You **never** mutate labels yourself. Emit the orphan labels under
`issue.labels.remove` in the structured output; the poll:state boundary
hook runs `gh issue edit --remove-label`.

## Step 0 — Derive label taxonomy from workflow JSON

Compute two sets:

- `WORKFLOW_LABELS`: triager's skip set.
- `ACTIONABLE_LABELS`: orchestrator's pickup set.

```bash
bash -c '
set -euo pipefail
WORKFLOW="{uv-workflow}"

if [ ! -f "$WORKFLOW" ]; then
  echo "workflow JSON not found: $WORKFLOW" >&2
  exit 1
fi

echo "-- WORKFLOW_LABELS --"
jq -r "
  [ (.labelMapping // {} | keys[]),
    (.prioritizer.labels // [])[] ]
  | unique[]
" "$WORKFLOW"

echo "-- ACTIONABLE_LABELS --"
jq -r "
  . as \$w
  | (.labelMapping // {} | keys[])
  | select(\$w.labelMapping[.] as \$ph
           | \$ph != null
           and \$w.phases[\$ph].type == \"actionable\")
" "$WORKFLOW"
'
```

If `ACTIONABLE_LABELS` is empty (workflow JSON has no actionable
phase), or if `WORKFLOW_LABELS ∖ ACTIONABLE_LABELS` is empty (every
workflow label is actionable), no issue can ever be orphaned. Emit
`closing` with `status: "skipped"`, empty `issue.labels.remove`, and a
reason citing the workflow shape.

## Step 1 — Read the target issue

```bash
bash -c '
set -euo pipefail
N={uv-issue}

gh issue view "$N" --json number,state,labels,title
'
```

Parse the JSON:

- If `state` ≠ `"OPEN"`: emit `closing`, `status: "skipped"`, reason
  `"issue not open (state=<X>)"`, empty `issue.labels.remove`.
- Otherwise, capture `L = labels[].name` for Step 2.

If the `gh issue view` call fails (network / 404 / permission), emit
`repeat` once. If a second invocation also fails, emit `closing` with
`status: "failed"` and an empty remove list.

## Step 2 — Decide eligibility and compute orphan_labels

Given the target's `L` and the two sets from Step 0:

- `wfHit = L ∩ WORKFLOW_LABELS`
- `acHit = L ∩ ACTIONABLE_LABELS`
- `orphan_labels = L ∩ (WORKFLOW_LABELS ∖ ACTIONABLE_LABELS)`

Decision table:

| Condition                                | status     | issue.labels.remove |
|------------------------------------------|------------|---------------------|
| `wfHit = ∅`                              | skipped    | `[]` (triager picks up)            |
| `wfHit ≠ ∅` AND `acHit ≠ ∅`              | skipped    | `[]` (orchestrator picks up)       |
| `wfHit ≠ ∅` AND `acHit = ∅` AND `orphan_labels ≠ ∅` | completed  | `orphan_labels`     |
| `wfHit ≠ ∅` AND `acHit = ∅` AND `orphan_labels = ∅` | skipped    | `[]` (defensive — should not occur) |

Verify in the same bash block (no mutation):

```bash
bash -c '
set -euo pipefail
N={uv-issue}
WORKFLOW="{uv-workflow}"

WORKFLOW_LABELS_JSON=$(jq "
  [ (.labelMapping // {} | keys[]),
    (.prioritizer.labels // [])[] ]
  | unique
" "$WORKFLOW")

ACTIONABLE_LABELS_JSON=$(jq "
  . as \$w
  | [ (.labelMapping // {} | keys[])
      | select(\$w.labelMapping[.] as \$ph
               | \$ph != null
               and \$w.phases[\$ph].type == \"actionable\") ]
  | unique
" "$WORKFLOW")

gh issue view "$N" --json number,state,labels \
  | jq --argjson wl "$WORKFLOW_LABELS_JSON" \
       --argjson al "$ACTIONABLE_LABELS_JSON" "
      . as \$iss
      | (\$iss.labels | map(.name)) as \$names
      | (\$names | map(select(. as \$n | \$wl | index(\$n)))) as \$wfHit
      | (\$names | map(select(. as \$n | \$al | index(\$n)))) as \$acHit
      | (\$wfHit - \$acHit) as \$orphan
      | { number: \$iss.number,
          state: \$iss.state,
          labels: \$names,
          wf_hit: \$wfHit,
          ac_hit: \$acHit,
          orphan_labels: \$orphan,
          eligible: ((\$wfHit | length) > 0 and (\$acHit | length) == 0 and (\$orphan | length) > 0) }
    "
'
```

Use the `orphan_labels` array from this output verbatim as
`issue.labels.remove` when `eligible == true`.

## Step 3 — Emit closing structured output

Emit a single closure structured output with:

- `stepId: "recover"`
- `status`: per the decision table.
- `summary`: one line, e.g.
  - `"stripped 1 orphan label from #{uv-issue}: done"`
  - `"#{uv-issue} skipped: already actionable (kind:impl)"`
  - `"#{uv-issue} skipped: no workflow labels (triager picks up)"`
- `next_action.action: "closing"` (use `"repeat"` only on transient
  Step 1 failure).
- `closure_action: "label-only"` — recovery never closes.
- `issue`:
  - `number`: `{uv-issue}`
  - `labels.add`: `[]` (always empty)
  - `labels.remove`: `orphan_labels` from Step 2 (or `[]` when skipping).

## Do ONLY this

- Do not run `gh issue edit`, `gh issue close`, or `gh issue comment` —
  the boundary hook owns mutations.
- Do not assign `kind:*` or `order:N`. Triager owns that on its next run.
- Do not strip non-workflow labels (`enhancement`, `bug`, etc.).
- Do not iterate over other issues. Scope is `--issue {uv-issue}` only.
- Do not emit intents other than `closing` or `repeat`.
