---
stepId: closure.iterate
name: Iterate Closure Prompt
description: Terminal step for iteration-based completion
uvVariables:
  - completed_iterations
customVariables:
  - summary_section
---

# Iteration Closure: {uv-completed_iterations} Iterations Completed

{summary_section}

## Closure Verification

The iteration budget has been exhausted or work is complete.

### Final Checklist

Verify the following before returning `closing` intent:

1. **Git Status**: Run `git status --porcelain` - must be empty (no uncommitted changes)
2. **Implementation**: All changes should be committed
3. **Progress**: Review what was accomplished across all iterations

### If Not Ready

If any of the above are not satisfied:
- Fix the issue (commit changes, etc.)
- Report `next_action.action = "repeat"` to retry closure validation

### Closure Report

When all conditions are met, report in structured output:
- `status`: "completed"
- `next_action.action`: "closing" (signals workflow completion)
- `summary`: Brief summary of all work done

## Boundary Hook

When you return `closing` intent, the **Boundary Hook** will handle any final actions.

Your role is to verify conditions and return the structured output only.

---

**This is a closure step.** Return `"closing"` to complete, or `"repeat"` to retry.
