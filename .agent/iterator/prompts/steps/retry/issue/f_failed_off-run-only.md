## Off-run commits only

All commits referencing `(#{uv-issue})` predate the current run (older than `run_started_sha`). The validator `commit-in-run` failed.

### Choose exactly one

1. **Nothing attributable**: this run did no new work for the issue. Emit `repeat` with a reason noting no changes were authored this run.
2. **Record this run's work**: create a NEW commit in this run that evidences the work just performed:
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
