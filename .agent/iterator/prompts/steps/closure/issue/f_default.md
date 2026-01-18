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

Verify the following before returning `closing` intent:

1. **Git Status**: Run `git status --porcelain` - must be empty (no uncommitted changes)
2. **Implementation**: All required changes should be committed
3. **Type Check**: Run `deno check` or equivalent to ensure no type errors
4. **Tests**: All tests should pass

### If Not Ready

If any of the above are not satisfied:
- Fix the issue (commit changes, fix type errors, etc.)
- Report `next_action.action = "repeat"` to retry closure validation

### Closure Report

When all conditions are met, report in structured output:
- `status`: "completed"
- `next_action.action`: "closing" (signals workflow completion)
- `summary`: Brief closure summary describing what was accomplished
- `validation`: { git_clean, type_check_passed, tests_passed, ... }
- `evidence`: { git_status_output, type_check_output, ... }

## Boundary Hook

**IMPORTANT**: Do NOT execute `gh issue close` directly.

When you return `closing` intent, the **Boundary Hook** will automatically:
- Close Issue #{uv-issue_number} with your summary as the closing comment

Your role is to verify conditions and return the structured output only.

---

**This is a closure step.** Return `"closing"` to complete, or `"repeat"` to retry.
