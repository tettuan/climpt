---
stepId: closure.consider.precheck-kind-read
name: Precheck - Read Kind-At-Triage Artifact
description: Read the frozen kind label captured at triage; do not modify.
uvVariables:
  - issue
---

# Goal: Read `.agent/climpt/out/kind_at_triage/{uv-issue}.txt` and output `kind_at_triage`

## Inputs

- `{uv-issue}` — GitHub issue number

## Outputs

- `kind_at_triage: string` — one of `kind:impl | kind:consider | kind:design`,
  verbatim from the file content.

## Action

```bash
bash -c '
set -euo pipefail
N={uv-issue}
FILE=".agent/climpt/out/kind_at_triage/${N}.txt"

if [ ! -e "$FILE" ]; then
  echo "missing: $FILE" >&2
  exit 1
fi

VALUE=$(cat "$FILE")
case "$VALUE" in
  kind:impl|kind:consider|kind:design)
    printf "%s" "$VALUE"
    ;;
  *)
    echo "invalid content in $FILE: $VALUE" >&2
    exit 2
    ;;
esac
'
```

- On exit 0, set `kind_at_triage` to stdout and emit `next`.
- On missing file (exit 1) or invalid content (exit 2), emit `repeat` with a
  reason naming the file path. The triager must record the artifact first;
  this step will not fabricate one.

## Do ONLY this

- Do not write to `.agent/climpt/out/kind_at_triage/<N>.txt`.
- Do not rename, delete, or normalize the file.
- Do not read any other file.
- Do not emit intents other than `next` (success) or `repeat` (missing /
  invalid artifact).
