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

Verify the following before finalizing:

1. **Git Status**: Working directory should be clean (no uncommitted changes)
2. **Implementation**: All changes should be committed
3. **Progress**: Review what was accomplished across all iterations

### If Not Ready

If any of the above are not satisfied:
- Fix the issue
- Report `next_action.action = "repeat"` to retry closure validation

### Closure Report

Report final status in your structured output:
- `status`: "completed"
- `next_action.action`: "closing" (signals workflow completion)
- `summary`: Brief summary of all work done

**NOTE**: This is a closure step. Use `"closing"` to complete, or `"repeat"` to retry.

---

**This is a terminal step.** The agent will close after this iteration.
