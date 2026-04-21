---
stepId: closure.triage.record-kind
name: Record Kind At Triage
description: Persist the classified kind into a durable per-issue artifact; refuse to overwrite.
uvVariables:
  - limit
  - workflow
---

# Goal: Record `kind:<K>` assignments from this triage run into durable per-issue files

Once triage labels an issue, the `kind` decision must be **frozen** so downstream
agents (iterator / considerer) can consult a single source of truth and refuse
to cross the scope boundary. The artifact is a plain text file per issue:

```
.agent/out/kind_at_triage/<issueNumber>.txt
```

Contents: exactly one line, one of `kind:impl`, `kind:consider`, `kind:design`
(no trailing newline required).

This artifact lives **outside git tracking** (`.agent/out/` is a runtime
directory). It is created on demand — do not add it to git, do not remove it.

## Inputs

- The list of `{issue_number, kind}` pairs assigned in the prior `triage` step
  (Step 4 of the triage default prompt).

## Outputs

- One file per newly triaged issue: `.agent/out/kind_at_triage/<N>.txt`
  containing the kind label literal.
- `kind_conflicts: [{issue: number, recorded: string, classified: string}]`
  — non-empty only when an existing file disagrees with this run's
  classification.

## Action

Execute every bash block via `bash -c '...'` (same zsh-avoidance rule as the
default triage prompt). Use `set -euo pipefail`.

1. Ensure the output directory exists:

   ```bash
   bash -c '
   set -euo pipefail
   mkdir -p .agent/out/kind_at_triage
   '
   ```

2. For each `(N, K)` pair from the prior triage step, where `K` is one of
   `kind:impl | kind:consider | kind:design`:

   ```bash
   bash -c '
   set -euo pipefail
   N=<issue>
   K=<kind-label>
   FILE=".agent/out/kind_at_triage/${N}.txt"

   if [ ! -e "$FILE" ]; then
     printf "%s" "$K" > "$FILE"
     echo "recorded: #$N -> $K"
   else
     EXISTING=$(cat "$FILE")
     if [ "$EXISTING" = "$K" ]; then
       echo "match: #$N -> $K"
     else
       echo "CONFLICT: #$N recorded=$EXISTING classified=$K" >&2
       # Do NOT overwrite. Do NOT delete. Capture into kind_conflicts.
     fi
   fi
   '
   ```

3. Collect every `CONFLICT:` line into `kind_conflicts[]`. If `kind_conflicts`
   is non-empty, emit `repeat` with a reason naming the conflicting issue
   numbers — a mismatch between a prior triage decision and this run requires
   human resolution (delete the file manually or re-label the issue).

4. If `kind_conflicts` is empty, emit `next` (or simply complete the step).

## Do ONLY this

- Do not overwrite an existing `.agent/out/kind_at_triage/<N>.txt`.
- Do not delete any file under `.agent/out/kind_at_triage/`.
- Do not add the file to git (no `git add`).
- Do not change any GitHub labels here — label application happened in the
  prior `triage` step.
- Do not emit intents other than `next` (all recorded or matched) or `repeat`
  (conflict detected, needs human).
