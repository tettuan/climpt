---
stepId: recover
name: Recover Orphan Workflow-Labeled Issues
description: Single-iteration batch recovery — fetch orphan open issues (triager-skipped ∧ orchestrator-skipped), strip their workflow labels.
uvVariables:
  - limit
  - workflow
---

# Task: Strip orphan workflow labels from OPEN issues

The recovery target is **any OPEN issue that both pipelines skip**:

1. **Triager would skip** it — it carries at least one workflow label
   (any label in `labelMapping` keys ∪ `prioritizer.labels`).
2. **Orchestrator would skip** it — none of its labels is mapped to an
   actionable phase (any label whose `labelMapping[label]` phase has
   `phases.<phase>.type == "actionable"`).

Both predicates are derived **dynamically** from the workflow JSON
(`--workflow` → `{uv-workflow}`). Do not hardcode label names. If the
workflow JSON adds or removes a phase, this prompt adapts automatically.

After stripping every workflow label from such an issue, it drops to
the "no workflow labels" state and triager will pick it up on its next
run.

The CLI passes `{uv-limit}` as the maximum number of issues to recover
in this run. Respect it in Step 2.

Execute every bash block via `bash -c '...'`. zsh (the login shell on
macOS) has divergent semantics for `!` negation and here-strings that
cause silent failures. Use `set -euo pipefail` at the top of each block.

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

If `ACTIONABLE_LABELS` is empty, report "workflow JSON has no
actionable phase — nothing to recover against" and stop. If
`WORKFLOW_LABELS \ ACTIONABLE_LABELS` is empty (every workflow label is
actionable), no issue can be orphaned in the defined sense; also report
and stop.

## Step 1 — List orphan open issues

An issue is **recovery-eligible** iff its label set `L` satisfies:

- `L ∩ WORKFLOW_LABELS ≠ ∅`  (triager would skip)
- `L ∩ ACTIONABLE_LABELS = ∅` (orchestrator would skip)

```bash
bash -c '
set -euo pipefail
WORKFLOW="{uv-workflow}"
LIMIT={uv-limit}

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

gh issue list --state open --limit 200 \
    --json number,title,labels \
  | jq --argjson wl "$WORKFLOW_LABELS_JSON" \
       --argjson al "$ACTIONABLE_LABELS_JSON" \
       --argjson lim "$LIMIT" "
      [ .[]
        | . as \$iss
        | (\$iss.labels | map(.name)) as \$names
        | (\$names | map(select(. as \$n | \$wl | index(\$n)))) as \$wfLabels
        | (\$names | map(select(. as \$n | \$al | index(\$n)))) as \$acLabels
        | select(
            (\$wfLabels | length) > 0
            and (\$acLabels | length) == 0
          )
        | { number,
            title,
            labels: \$names,
            orphan_labels: \$wfLabels } ]
      | .[:\$lim]
    "
'
```

Each result entry's `orphan_labels` is exactly the set of labels you
must strip from that issue — the issue's workflow-labels intersection,
which by the predicate contains zero actionable labels.

If the result is an empty array, emit `closing` with `removed: []`,
`skipped: []` and a summary saying no orphans found.

## Step 2 — For each eligible issue, strip its orphan workflow labels

Iterate the array from Step 1. For each issue `#N` with
`orphan_labels: [L1, L2, ...]`, run once per label:

```bash
bash -c '
set -euo pipefail
N=<issue>
L=<orphan-label>
gh issue edit "$N" --remove-label "$L"
'
```

- On success, append `{ issue_number: N, removed_label: L }` to
  `removed[]`.
- On failure (permission denied, label already absent on refetch,
  network error), append `{ issue_number: N, reason: "<msg>" }` to
  `skipped[]` and continue to the next label/issue.

Do NOT retry beyond what gh's own retry handles.

## Step 3 — Final summary

Output a markdown table of the actions:

| Issue | Removed label | Status  |
|-------|---------------|---------|
| #488  | done          | removed |
| #499  | order:4       | removed |
| ...   | ...           | ...     |

Include a trailing line:
`Recovered: M / Skipped: K / Limit: {uv-limit}` where M = len(removed),
K = len(skipped).

Emit `next_action.action = "closing"` if Step 1 and Step 2 completed
normally (empty `removed[]` is still `closing`). Emit `repeat` only if a
transient error prevented Step 1's fetch from completing.

## Do ONLY this

- Do not add any labels. Do not assign `kind:*` or `order:N`. Triager
  owns that on its next run.
- Do not close issues. Do not post comments. Do not reopen issues.
- Do not remove non-workflow labels (`enhancement`, `bug`, etc.).
  `orphan_labels` is already narrowed to workflow labels.
- Do not touch issues where any label is in `ACTIONABLE_LABELS` —
  orchestrator handles those.
- Do not emit intents other than `closing` or `repeat`.
