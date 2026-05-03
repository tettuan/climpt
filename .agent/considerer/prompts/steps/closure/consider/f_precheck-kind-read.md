---
stepId: closure.consider.precheck-kind-read
name: Precheck - Read Kind-At-Triage Artifact (audit-only)
description: Best-effort read of the audit-only kind_at_triage artifact; missing/invalid → null without retry.
uvVariables:
  - issue
---

# Goal: Best-effort read `.agent/climpt/out/kind_at_triage/{uv-issue}.txt` and emit `kind_at_triage`

`kind_at_triage` is **audit information only**. The orchestrator's current
`kind:*` label is the authoritative ground truth for routing; this artifact
is a passive record from triage time used only for drift inspection. No
writer is guaranteed to have produced it, so this step never hangs on its
absence.

## Inputs (handoff)
- `{uv-issue}` — GitHub issue number.
- `doc_paths_required`, `doc_diff_results`, `doc_evidence` — passed through
  the handoff chain (not consumed here; preserved for downstream).

## Outputs
- `kind_at_triage: string | null` — one of `kind:impl | kind:consider | kind:design`
  when the file exists with valid content; otherwise `null`. Schema:
  `closure.consider.precheck-kind-read` in `schemas/considerer.schema.json`.

## Action

```bash
bash -c '
set -euo pipefail
N={uv-issue}
FILE=".agent/climpt/out/kind_at_triage/${N}.txt"

if [ ! -e "$FILE" ]; then
  printf ""
  exit 0
fi

VALUE=$(cat "$FILE")
case "$VALUE" in
  kind:impl|kind:consider|kind:design)
    printf "%s" "$VALUE"
    ;;
  *)
    printf ""
    ;;
esac
'
```

Map the bash output to `kind_at_triage`:
- Empty stdout → `kind_at_triage: null`.
- Non-empty stdout (valid kind label) → `kind_at_triage` set to that value.

## Verdict
- `next` — always emitted (success or absent file). Transitions to
  `closure.consider.precheck-kind-scope`. There is no upstream writer to
  wait for and the live label is already authoritative, so `repeat` is not
  permitted.

## Do ONLY this

- Do not write to `.agent/climpt/out/kind_at_triage/<N>.txt`.
- Do not rename, delete, or normalize the file.
- Do not read any other file.
