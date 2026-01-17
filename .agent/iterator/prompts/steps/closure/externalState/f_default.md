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

Verify the following before finalizing:

1. **GitHub Issue State**: Issue #{uv-issue_number} should be CLOSED
2. **Git Status**: Working directory should be clean (no uncommitted changes)
3. **Implementation**: All required changes should be committed

### If Not Ready

If any of the above are not satisfied:
- Fix the issue
- Report `next_action.action = "closing"` to retry

### Closure Report

Report final status in your structured output:
- `status`: "completed"
- `next_action.action`: "closing"
- `summary`: Brief closure summary

---

**This is a terminal step.** The agent will close after this iteration.
