---
stepId: continuation.issue
name: Issue Review Continuation
uvVariables:
  - issue
---

# Continue Review: Issue #{uv-issue}

## Instructions

You are continuing the review of Issue #{uv-issue} from a previous iteration.

1. Check what review work was completed in prior iterations
2. Continue analyzing the codebase for any remaining requirements
3. Verify implementations that have not yet been checked
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

## Structured Output

You MUST respond with a JSON object matching the following schema as your final
message.

```json
{
  "stepId": "continuation.issue",
  "status": "in_progress",
  "summary": "Brief description of review progress",
  "next_action": {
    "action": "next",
    "reason": "Reason for chosen action",
    "details": {}
  }
}
```

Your FINAL message in the conversation MUST be this JSON object. Do not wrap it
in markdown code blocks.

**IMPORTANT**: Use exact intent values:

- `"next"` - continue reviewing (more items to verify)
- `"repeat"` - retry current step
- `"handoff"` - hand off to closure step (review is complete)
