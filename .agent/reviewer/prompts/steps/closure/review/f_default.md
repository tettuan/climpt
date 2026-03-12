---
stepId: closure.review
name: Review Closure
uvVariables: []
---

# Review Closure

> **CRITICAL: DO NOT RUN `gh` COMMANDS**
>
> You MUST NOT execute these commands directly:
>
> - `gh issue close` - BLOCKED
> - `gh issue edit` - BLOCKED
> - `gh api` - BLOCKED
>
> The **Boundary Hook** will handle all GitHub operations when you return
> `closing` intent. Running gh commands will be blocked by ToolPolicy.

## Your Role: Final Review Validation

Perform final validation before closing the review cycle.

### Final Checklist

Verify the following before returning `closing` intent:

1. **Git Status**: Run `git status --porcelain` - must be empty (no uncommitted
   changes)
2. **Branch Pushed**: Verify current branch is pushed to remote
3. **Review Complete**: All review findings have been reported
4. **Verdicts Issued**: All required review-action blocks have been output

### If Not Ready

If any of the above are not satisfied:

- Fix the issue (commit remaining changes, push branch, etc.)
- Report `next_action.action = "repeat"` to retry closure validation

## Structured Output

You MUST respond with a JSON object matching the following schema as your final
message.

```json
{
  "stepId": "closure.review",
  "status": "completed",
  "summary": "Brief closure summary describing review outcome",
  "next_action": {
    "action": "closing",
    "reason": "All review tasks complete, ready to close",
    "details": {}
  }
}
```

Your FINAL message in the conversation MUST be this JSON object. Do not wrap it
in markdown code blocks.

**IMPORTANT**: Use exact intent values:

- `"closing"` - signals workflow completion
- `"repeat"` - retry closure validation
