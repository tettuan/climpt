---
stepId: triage
name: Triage Untagged Issues
description: Single-iteration batch triage — fetch, classify, label.
uvVariables:
  - limit
  - workflow
---

# Task: Triage open issues that have no workflow labels yet

The triage target is **any open issue that does not yet carry a workflow
label**. "Workflow labels" are derived dynamically from the downstream
workflow JSON passed via `--workflow` ({workflow}) — specifically the union
of `labelMapping` keys and `prioritizer.labels`. Issues carrying unrelated
labels such as `enhancement`, `bug`, `documentation` are still eligible for
triage; only issues already tagged with a workflow label are skipped.

The CLI passes `{limit}` as the maximum number of issues to triage in this
run. Respect it in Step 1.

Execute every bash block via `bash -c '...'`. zsh (the login shell on
macOS) has divergent semantics for `!` negation and here-strings that cause
silent failures. `set -euo pipefail` at the top of each block.

## Step 0 — Derive label taxonomy from workflow JSON

Read the workflow JSON and compute `WORKFLOW_LABELS` — the set of labels
the downstream workflow cares about.

```bash
bash -c '
set -euo pipefail
WORKFLOW="{workflow}"

if [ ! -f "$WORKFLOW" ]; then
  echo "workflow JSON not found: $WORKFLOW" >&2
  exit 1
fi

# Union: labelMapping keys + prioritizer.labels (deduped)
jq -r "
  [ (.labelMapping // {} | keys[]),
    (.prioritizer.labels // [])[] ]
  | unique[]
" "$WORKFLOW"
'
```

Save the output as `WORKFLOW_LABELS` (one per line) for reuse in Steps 1
and 2.

## Step 1 — Ensure every workflow label exists in the repo (idempotent)

Each workflow label needs to exist before any agent applies it. Create
missing ones from a known color/description table. Labels not in the table
get a neutral default.

```bash
bash -c '
set -euo pipefail
WORKFLOW="{workflow}"

WORKFLOW_LABELS=$(jq -r "
  [ (.labelMapping // {} | keys[]),
    (.prioritizer.labels // [])[] ]
  | unique[]
" "$WORKFLOW")

EXISTING=$(gh label list --limit 200 --json name --jq ".[].name")

# Color/description table for known labels (name|color|description)
declare -A COLOR DESC
lookup() {
  case "$1" in
    kind:impl)       echo "a2eeef|Implementation work (iterator)" ;;
    kind:consider)   echo "bfd4f2|Consideration/response (considerer)" ;;
    order:1)         echo "c2e0c6|Work order seq 1 (higher = sooner)" ;;
    order:[2-9])     echo "c2e0c6|Work order seq ${1#order:}" ;;
    done)            echo "0e8a16|Work completed (awaiting orchestrator close)" ;;
    "need clearance") echo "d93f0b|Blocked — requires human clearance" ;;
    *)               echo "cccccc|Workflow label" ;;
  esac
}

while IFS= read -r name; do
  [ -z "$name" ] && continue
  if ! printf "%s\n" "$EXISTING" | grep -Fxq "$name"; then
    spec=$(lookup "$name")
    color="${spec%%|*}"
    desc="${spec#*|}"
    gh label create "$name" --color "$color" --description "$desc"
  fi
done <<< "$WORKFLOW_LABELS"
'
```

Do NOT recreate labels that already exist. Do NOT change colors or
descriptions of existing labels. On failure, stop and report; do not
proceed.

## Step 2 — List open issues missing all workflow labels

```bash
bash -c '
set -euo pipefail
WORKFLOW="{workflow}"
LIMIT={limit}

WORKFLOW_LABELS_JSON=$(jq "
  [ (.labelMapping // {} | keys[]),
    (.prioritizer.labels // [])[] ]
  | unique
" "$WORKFLOW")

gh issue list --state open --limit 200 \
    --json number,title,body,labels \
  | jq --argjson wl "$WORKFLOW_LABELS_JSON" --argjson lim "$LIMIT" "
      [ .[] | select(
          ([.labels[].name] | any(. as \$n | \$wl | index(\$n))) | not
        ) ]
      | .[:\$lim]
    "
'
```

An issue is **triage-eligible** if it shares zero labels with
`WORKFLOW_LABELS`. Issues carrying unrelated tags such as `enhancement` or
`bug` remain eligible — only presence of a workflow label disqualifies.

If the result is an empty array, report "no issues to triage" and stop.

## Step 3 — List order labels already in use

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
iterated in ascending numeric order.

The `-label:done` filter is a safety net: with `closeOnComplete` in the
execute workflow, done issues are closed and excluded by `--state open`
already, but the explicit filter guards against the rare case where a
done-labeled issue remains open due to close failure.

## Step 4 — For each eligible issue

Iterate the array returned in Step 2. For each issue `#N`:

1. Decide `kind` by applying the classification heuristics in the system
   prompt to the issue title + body. Ignore pre-existing unrelated labels
   (`enhancement`, `bug`, etc.) — they carry no workflow meaning here.
2. Pick the smallest unused `order:N` from the available set and remove it
   from the set.
3. Apply both labels:

   ```bash
   gh issue edit <N> --add-label "kind:<impl|consider>,order:<seq>"
   ```

4. If no `order:N` slots remain, stop and report in the final summary.

## Step 5 — Final summary

Output a markdown table of the assignments:

| Issue | Kind | Order |
|-------|------|-------|
| #471  | kind:consider | order:1 |
| ...   | ...           | ...     |

Include a trailing line: `Remaining order:N capacity: K` where K is the
number of unused order seqs.

Do not write any files. Do not post issue comments. Do not close issues.
