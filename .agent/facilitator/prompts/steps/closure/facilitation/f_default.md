---
stepId: closure.facilitation
name: Facilitation Closure
uvVariables: []
---

# Facilitation Closure

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

## Your Role: Finalize Facilitation Cycle

Summarize the facilitation actions taken and confirm all status checks and
maintenance actions are complete.

### Final Checklist

Verify the following before returning `closing` intent:

1. **Status Checks Complete**: All project issues have been reviewed
2. **Blockers Addressed**: Identified blockers have resolution paths documented
3. **Labels Updated**: Issue labels reflect current state
4. **Stale Items Flagged**: Inactive issues have been flagged appropriately
5. **Summary Prepared**: Facilitation cycle results are summarized

### If Not Ready

If any of the above are not satisfied:

- Complete remaining facilitation tasks
- Report `next_action.action = "repeat"` to retry closure validation

### Closure Report

When all conditions are met, provide a summary of:

- Total issues reviewed
- Facilitation actions taken (status updates, blocker resolution, attention flags)
- Outstanding concerns for the next cycle
- Recommended focus areas

## Structured Output

You MUST respond with a JSON object matching the following schema as your final
message.

```json
{
  "stepId": "closure.facilitation",
  "status": "completed",
  "summary": "Brief closure summary describing facilitation outcome",
  "next_action": {
    "action": "closing",
    "reason": "All facilitation tasks complete, cycle finished",
    "details": {}
  }
}
```

Your FINAL message in the conversation MUST be this JSON object. Do not wrap it
in markdown code blocks.

**IMPORTANT**: Use exact intent values:

- `"closing"` - signals workflow completion
- `"repeat"` - retry closure validation
