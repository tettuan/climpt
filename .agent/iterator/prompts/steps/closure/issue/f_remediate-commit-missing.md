---
stepId: closure.issue.remediate-commit-missing
name: Remediate - Bind Commit to Issue
description: Amend or create a commit with (#<issue>) trailer
uvVariables:
  - issue
---

# Goal: Bind at least one in-run commit to issue #{uv-issue} via `(#{uv-issue})` in the subject

## Inputs

- `{uv-issue}` - GitHub issue number
- `commit_list` (from precheck-commit-list, may be empty)

## Outputs

- Updated `commit_list` after remediation (next run of precheck-commit-list will re-enumerate)

## Action

1. If HEAD commit authored the current run's work, run `git commit --amend -m "<existing subject> (#{uv-issue})"` to append the trailer.
2. Else create a new commit: stage pending work with `git add -A` and run `git commit -m "chore: bind work to issue (#{uv-issue})"`.
3. Emit `next` so the chain loops back to `closure.issue.precheck-commit-list` for re-verification.

## Do ONLY this

- Do not close the issue
- Do not push to remote
- Do not rewrite commits older than HEAD
- Do not emit intents other than `next` (remediation applied) or `repeat` (remediation blocked; needs human)
