---
stepId: closure.issue.precheck-commit-in-run
name: Precheck - Verify Commits Are In-Run
description: For each verified commit, set off_run via git merge-base --is-ancestor against run_started_sha
uvVariables:
  - issue
---

# Goal: For each entry in `commit_verification`, decide `off_run` against `run_started_sha`

This step has a single axis: **off-run flag** per SHA. Existence has already
been verified by the prior step (`closure.issue.precheck-commit-exists`); do
not re-run `git cat-file` here. The accompanying validator `commit-in-run`
(postllm) re-checks that at least one commit referencing `(#{uv-issue})` is
in-run.

## Inputs (handoff)

Received from `closure.issue.precheck-commit-exists.structuredGate.handoffFields`:

- `run_started_sha` — HEAD SHA recorded at run start
- `commit_list: [{sha, subject}]` — carried through unchanged
- `commit_verification: [{sha, exists: true, off_run: false (placeholder), changed_paths}]` — produced by `closure.issue.precheck-commit-exists`
- `{uv-issue}` — GitHub issue number (uvVariable)

## Outputs (intermediate artifacts)

This step finalizes `commit_verification[]` by setting the real `off_run`:

- `commit_verification: [{sha, exists, off_run: boolean, changed_paths}]`
  - `off_run` = true iff `git merge-base --is-ancestor <sha> ${run_started_sha}` returns 0 (the SHA predates / equals `run_started_sha`)

Carry-through (unchanged): `run_started_sha`, `commit_list`.

## Action

1. For each entry `e` in `commit_verification`:
   - If `e.exists === false`, skip ancestry (leave `off_run=false`); the prior step's validator already failed.
   - Otherwise run `git merge-base --is-ancestor <e.sha> ${run_started_sha}; echo $?`. Set `e.off_run = (exit code === 0)`.
2. Re-emit the updated `commit_verification[]`.
3. Verdict:
   - `next` if at least one entry has `off_run=false` (= at least one in-run commit).
   - `repeat` if every entry has `off_run=true` (the validator `commit-in-run` fails and the retry adaptation `f_failed_off-run-only.md` runs).

## Verdict

- `next` — at least one in-run commit. Advance to `closure.issue.precheck-kind-read`.
- `repeat` — only off-run commits referenced this issue. Validator `commit-in-run` detects this; retry feeds in `f_failed_off-run-only.md`.

## Do ONLY this

- Do not re-verify SHA existence (prior step's responsibility)
- Do not edit files
- Do not stage or create commits
- Do not run git commands other than `git merge-base --is-ancestor`
- Do not emit intents other than `next` or `repeat`
