---
stepId: initial.issue
name: Issue Review Prompt
description: Initial prompt for reviewing a specific GitHub Issue
uvVariables:
  - issue
customVariables:
  - issue_content
---

# Review Task: Issue #{uv-issue}

{issue_content}

## Instructions

1. Read and understand the issue requirements
2. Analyze the codebase for relevant implementations
3. Verify that all requirements are met
4. Report findings using review-action blocks

## Review Actions

### Report Findings

When you find implementation issues or gaps, report them:

```review-action
{"action":"findings","issue":{uv-issue},"verdict":"REQUEST_CHANGES","body":"Description of the issue found"}
```

### Complete Review

When all requirements are verified, complete the review:

```review-action
{"action":"complete","issue":{uv-issue},"verdict":"APPROVE","summary":"Summary of the review"}
```

## Completion

After completing the review:
1. Output a final review-action with verdict
2. Close the issue with `gh issue close {uv-issue}` if approved

Start by analyzing the issue requirements and searching the codebase for relevant implementations.
