---
stepId: closure.issue.precheck-commit-list
name: Precheck - Enumerate In-Run Commits
description: Enumerate commits in this run that reference the issue
uvVariables:
  - issue
---

# Goal: Enumerate commits in this run that reference the issue

## Inputs

- `{uv-issue}` - GitHub issue number
- `run_started_sha` (from initial.polling handoff)

## Outputs

- `commit_list: [{sha: string, subject: string}]`

## Action

1. Run `git log --pretty=format:'%H|%s' ${run_started_sha}..HEAD --grep='(#{uv-issue})'`
2. For each line, split on `|`; first field is `sha`, remainder is `subject`
3. Emit `commit_list[]` with those entries (empty array if no matches)

## Do ONLY this

- Do not read other files
- Do not run git commands other than `git log`
- Do not edit, stage, or create commits
- Do not emit intents other than `next` (on success) or `repeat` (on parse error)

## Structured Output

Return a JSON object with:
- `stepId`: "closure.issue.precheck-commit-list"
- `status`: "completed"
- `summary`: Brief description
- `issue`: { "issue_number": {uv-issue} }
- `commit_list`: array of `{sha, subject}`
- `next_action.action`: "next" or "repeat"
