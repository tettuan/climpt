## Commit binding missing

No commit in this run references `(#{uv-issue})`. The validator `commit-binding-nonempty` failed.

Closure cannot proceed without at least one in-run commit bound to this issue.

### Required remediation

1. If HEAD commit carries the work for this issue, amend its subject to append ` (#{uv-issue})`:
   ```
   git commit --amend -m "<existing subject> (#{uv-issue})"
   ```
2. Otherwise create a new commit whose subject ends with ` (#{uv-issue})`:
   ```
   git add -A
   git commit -m "chore: record work for (#{uv-issue})"
   ```

### Do ONLY this

- Do not push
- Do not close the issue
- Do not modify commits that predate the current run (`run_started_sha`)

Emit `repeat` to loop back into the precheck chain once remediation is applied.
