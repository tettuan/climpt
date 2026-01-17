---
stepId: complete.externalState
name: External State Complete Prompt
description: Terminal step for external state completion
uvVariables:
  - issue_number
customVariables:
  - summary_section
---

# External State Completion: Issue #{uv-issue_number}

{summary_section}

## Completion Verification

The external state indicates this issue is complete.

### Final Checklist

Verify the following before finalizing:

1. **GitHub Issue State**: Issue #{uv-issue_number} should be CLOSED
2. **Git Status**: Working directory should be clean (no uncommitted changes)
3. **Implementation**: All required changes should be committed

### If Not Complete

If any of the above are not satisfied:
- Fix the issue
- Report `next_action.action = "complete"` to retry

### Completion Report

Report final status in your structured output:
- `status`: "completed"
- `next_action.action`: "complete"
- `summary`: Brief completion summary

---

**This is a terminal step.** The agent will complete after this iteration.
