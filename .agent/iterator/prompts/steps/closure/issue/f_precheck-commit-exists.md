---
stepId: closure.issue.precheck-commit-exists
name: Precheck - Verify Commit SHAs Exist
description: For each commit_list SHA, verify existence and capture changed_paths
uvVariables:
  - issue
---

# Goal: Verify each SHA in `commit_list` exists in the local repo and capture its `changed_paths`

This step has a single axis: **per-SHA existence**. The accompanying validator
`commit-binding-nonempty` (postllm) re-checks that at least one in-run commit
references `(#{uv-issue})`. Off-run / ancestry detection is the job of the
NEXT step (`closure.issue.precheck-commit-in-run`); do not flag off-run here.

## Inputs (handoff)

Received from `closure.issue.precheck-commit-list.structuredGate.handoffFields`:

- `run_started_sha` (carry-through from `initial.polling`) — HEAD recorded at run start
- `commit_list: [{sha, subject}]` — produced by `closure.issue.precheck-commit-list`
- `{uv-issue}` — GitHub issue number (uvVariable)

## Outputs (intermediate artifacts)

This step contributes to `commit_verification[]` by emitting **only the existence
+ changed_paths half** of each entry:

- `commit_verification: [{sha: string, exists: boolean, off_run: false, changed_paths: [string]}]`
  - `exists` = true iff `git cat-file -e <sha>` returns 0
  - `changed_paths` = output of `git show --name-only --format= <sha>`, one path per line
  - `off_run` = `false` always (the next step decides off-run)

Carry-through (passed unchanged into handoff): `run_started_sha`, `commit_list`.

## Action

1. For each entry in `commit_list`:
   - Run `git cat-file -e <sha>; echo $?`. Set `exists` = (exit code 0).
   - Run `git show --name-only --format= <sha>` and split on newline (drop empty trailing line). Set `changed_paths` = that array.
   - Set `off_run` = `false`. (Ancestry is checked in `precheck-commit-in-run`.)
2. Emit `commit_verification[]` preserving `commit_list` order.
3. Verdict:
   - `next` if every entry has `exists=true`.
   - `repeat` if any `exists=false` (the validator `commit-binding-nonempty` will fail and the retry adaptation `f_failed_commit-binding-missing.md` runs).

## Verdict

- `next` — all SHAs exist. Advance to `closure.issue.precheck-commit-in-run`.
- `repeat` — at least one SHA missing OR no in-run commit reference exists. Validator `commit-binding-nonempty` detects the latter; retry feeds in `f_failed_commit-binding-missing.md`.

## Do ONLY this

- Do not run `git merge-base` or any ancestry / off-run check (next step's job)
- Do not edit files
- Do not stage or create commits
- Do not run git commands other than `git cat-file -e` and `git show --name-only --format=`
- Do not emit intents other than `next` or `repeat`
