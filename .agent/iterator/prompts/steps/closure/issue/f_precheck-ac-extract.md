---
stepId: closure.issue.precheck-ac-extract
name: Precheck - Extract Acceptance Criteria
description: Parse AC bullets from issue body
uvVariables:
  - issue
---

# Goal: Extract Acceptance Criteria bullets from issue #{uv-issue} body

## Inputs

- `{uv-issue}` - GitHub issue number

## Outputs

- `ac_list: [{ac_id: string, text: string}]`

## Action

1. Fetch issue body: `gh issue view {uv-issue} --json body --jq .body`
2. Locate the heading `### Acceptance Criteria` or `## Acceptance Criteria`. Extract every bullet line (leading `- ` or `* `) until the next heading.
3. Emit `ac_list[]` where `ac_id` is `AC-<N>` (N = 1-based source order) and `text` is the bullet text as-is.

## Do ONLY this

- Do not edit files
- Do not run shell commands other than `gh issue view`
- Do not interpret or rephrase AC text
- Do not emit intents other than `next` (ACs extracted) or `repeat` (parse error / no AC section)
