---
stepId: closure.externalState
name: External State Closure Prompt
description: Terminal step for external state closure
uvVariables:
  - issue_number
customVariables:
  - summary_section
---

# External State Closure: Issue #{uv-issue_number}

{summary_section}

## Closure Verification

The external state indicates this issue is ready for closure.

### Final Checklist

Verify the following before returning `closing` intent:

1. **Git Status**: Run `git status --porcelain` - must be empty (no uncommitted changes)
2. **Implementation**: All required changes should be committed

### If Not Ready

If any of the above are not satisfied:
- Fix the issue (commit remaining changes, etc.)
- Report `next_action.action = "repeat"` to retry closure validation

### Closure Report

When all conditions are met, report in structured output:
- `status`: "completed"
- `next_action.action`: "closing" (signals workflow completion)
- `summary`: Brief closure summary describing what was accomplished

## Boundary Hook

**IMPORTANT**: Do NOT execute `gh issue close` directly.

When you return `closing` intent, the **Boundary Hook** will automatically:
- Close Issue #{uv-issue_number} with your summary as the closing comment

Your role is to verify conditions and return the structured output only.

---

**This is a closure step.** Return `"closing"` to complete, or `"repeat"` to retry.
