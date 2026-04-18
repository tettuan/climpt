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
workflow JSON passed via `--workflow` ({uv-workflow}) — specifically the union
of `labelMapping` keys and `prioritizer.labels`. Issues carrying unrelated
labels such as `enhancement`, `bug`, `documentation` are still eligible for
triage; only issues already tagged with a workflow label are skipped.

The CLI passes `{uv-limit}` as the maximum number of issues to triage in this
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
WORKFLOW="{uv-workflow}"

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

## Step 1 — Reconcile workflow labels with the repository (idempotent)

Label specs (name + color + description) are declared in the workflow
JSON under the `labels` section — a single source of truth shared by the
orchestrator and this agent. Invoke the TypeScript syncer to create
missing labels and update any whose color/description drifted:

```bash
bash -c '
set -euo pipefail
deno task labels:sync --workflow "{uv-workflow}"
'
```

The syncer is per-label try/catch: one label failing (e.g. the GitHub
token lacks `repo` scope for that specific label) does not abort the
rest of the run. It prints a summary of `created / updated / nochange /
failed` counts and exits `1` if any label failed. If the exit code is
`1`, inspect which label failed from the syncer's output and report it
alongside the triage summary — do not attempt to mutate the repository
via ad-hoc `gh label` commands from this prompt.

Do NOT open a bash block that calls `gh label create` / `gh label edit`
directly — the syncer is the only way labels should be touched.

## Step 2 — List open issues missing all workflow labels

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
