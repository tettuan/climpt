---
stepId: closure.issue
name: Issue Closure Prompt
description: Terminal step for issue completion
uvVariables:
  - issue_number
customVariables:
  - summary_section
---

# Issue Closure: Issue #{uv-issue_number}

{summary_section}

## Closure Verification

The issue work has been handed off for closure verification.

### Final Checklist

Verify the following before finalizing:

1. **GitHub Issue State**: Issue #{uv-issue_number} should be CLOSED
2. **Git Status**: Working directory should be clean (no uncommitted changes)
3. **Implementation**: All required changes should be committed
4. **Type Check**: Run `deno check` or equivalent to ensure no type errors
5. **Tests**: All tests should pass

### If Not Ready

If any of the above are not satisfied:
- Fix the issue
- Report `next_action.action = "repeat"` to retry closure validation

### Closure Report

Report final status in your structured output:
- `status`: "completed"
- `next_action.action`: "closing" (signals workflow completion)
- `summary`: Brief closure summary
- `validation`: { git_clean, type_check_passed, tests_passed, ... }
- `evidence`: { git_status_output, type_check_output, ... }

**NOTE**: This is a closure step. Use `"closing"` to complete, or `"repeat"` to retry.

---

**This is a terminal step.** The agent will close after this iteration.
