---
stepId: closure.issue.precheck-commit-verify
name: Precheck - Verify Commit SHAs and In-Run Ancestry
description: Verify each commit exists, capture changed_paths, detect off-run commits
uvVariables:
  - issue
---

# Goal: Verify each commit in commit_list exists, capture changed_paths, and flag off-run commits

## Inputs

- `commit_list` (from closure.issue.precheck-commit-list)
- `run_started_sha` (from initial.polling)
- `{uv-issue}` - GitHub issue number

## Outputs

- `commit_verification: [{sha, exists, off_run, changed_paths}]`

## Action

1. For each `sha` in `commit_list`, run `git cat-file -e <sha>` (exists=true on exit 0) and `git show --name-only --format= <sha>` (one path per line) to collect `changed_paths`.
2. For each `sha`, run `git merge-base --is-ancestor <sha> ${run_started_sha}; echo $?`. Exit code `0` means the commit predates the run; set `off_run=true`. Otherwise `off_run=false`.
3. Emit `commit_verification[]` preserving `commit_list` order.

## Do ONLY this

- Do not edit files
- Do not stage or create commits
- Do not run git commands other than `git cat-file`, `git show`, `git merge-base`
- Do not emit intents other than `next` (all commits exist and at least one is in-run) or `repeat` (remediation required)
