## Commit binding missing

No commit in this run references `(#{uv-issue})`. The validator
`commit-binding-nonempty` failed.

Closure cannot proceed without at least one in-run commit bound to this issue.

### Required remediation

1. If HEAD commit carries the work for this issue, amend its subject to append
   `(#{uv-issue})`:
   ```
   git commit --amend -m "<existing subject> (#{uv-issue})"
   ```
2. Otherwise create a new commit whose subject ends with `(#{uv-issue})`:
   ```
   git add -A
   git commit -m "chore: record work for (#{uv-issue})"
   ```

### Do ONLY this

- Do not push
- Do not close the issue
- Do not modify commits that predate the current run (`run_started_sha`)

Emit `repeat` to loop back into the precheck chain once remediation is applied.

## Allowed `next_action.action` values

This retry prompt is fed back into `closure.issue.precheck-commit-exists` (the
validator `commit-binding-nonempty` runs there). Your structured JSON response
MUST satisfy that step's `next_action.action` enum:

- Allowed values: `["next","repeat"]`
- Emit `repeat` after binding a commit subject to `(#{uv-issue})`. The validator
  will re-check `commit-binding-nonempty` and the chain advances on success.

Do NOT emit `closing`, `handoff`, `close`, `done`, or any other value. Any value
outside `["next","repeat"]` triggers `GATE_INTERPRETATION_ERROR` (failFast) and
aborts the run. Canonical schema: `.agent/iterator/schemas/issue.schema.json` →
`closure.issue.precheck.properties.next_action.properties.action.enum`.
