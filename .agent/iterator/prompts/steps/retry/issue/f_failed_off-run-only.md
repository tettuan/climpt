## Off-run commits only

All commits referencing `(#{uv-issue})` predate the current run (older than
`run_started_sha`). The validator `commit-in-run` failed.

### Choose exactly one

1. **Nothing attributable**: this run did no new work for the issue. Emit
   `repeat` with a reason noting no changes were authored this run.
2. **Record this run's work**: create a NEW commit in this run that evidences
   the work just performed:
   ```
   git add -A
   git commit -m "<subject describing this run's work> (#{uv-issue})"
   ```
   Then emit `repeat` to loop back into the precheck chain.

### Do ONLY this

- Do not amend pre-run commits
- Do not push
- Do not close the issue
- Do not emit `next` until an in-run commit exists

## Allowed `next_action.action` values

This retry prompt is fed back into `closure.issue.precheck-commit-verify` (the
validator `commit-in-run` runs there). Your structured JSON response MUST
satisfy that step's `next_action.action` enum:

- Allowed values: `["next","repeat"]`
- Emit `repeat` until at least one in-run commit references `(#{uv-issue})`.
  Once a fresh in-run commit exists, the next validator pass will allow the
  chain to advance via `next` automatically — do NOT emit `next` from this
  retry.

Do NOT emit `closing`, `handoff`, `close`, `done`, or any other value. Any value
outside `["next","repeat"]` triggers `GATE_INTERPRETATION_ERROR` (failFast) and
aborts the run. Canonical schema: `.agent/iterator/schemas/issue.schema.json` →
`closure.issue.precheck.properties.next_action.properties.action.enum`.
