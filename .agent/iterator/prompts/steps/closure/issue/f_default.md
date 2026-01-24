---
stepId: closure.issue
name: Issue Closure Prompt
description: Terminal step for issue completion (hands off to reviewer)
uvVariables:
  - issue_number
customVariables:
  - summary_section
---

# Issue Closure: Issue #{uv-issue_number}

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

{summary_section}

## Your Role: Implementation Complete, Hand Off to Reviewer

You are an **implementation agent**. Your work is done when:

1. All code changes are committed
2. Tests pass
3. You add the `done` label to signal completion

**The Reviewer Agent will:**

- Verify your implementation
- Close the issue when approved

## Closure Verification

The issue work has been handed off for closure verification.

### Final Checklist

Verify the following before returning `closing` intent:

1. **Git Status**: Run `git status --porcelain` - must be empty (no uncommitted
   changes)
2. **Implementation**: All required changes should be committed
3. **Type Check**: Run `deno check` or equivalent to ensure no type errors
4. **Tests**: All tests should pass

### If Not Ready

If any of the above are not satisfied:

- Fix the issue (commit changes, fix type errors, etc.)
- Report `next_action.action = "repeat"` to retry closure validation

### Closure Options

Choose the appropriate closure action:

- `action`: Complete action type
  - `"close"`: Close the Issue (default)
  - `"label-only"`: Change labels only, keep Issue OPEN
  - `"label-and-close"`: Change labels then close

- `issue.labels`: Label changes (optional, overrides config defaults)
  - `add`: ["done"] - Labels to add
  - `remove`: ["in-progress"] - Labels to remove

If default labels are configured in agent.json, you don't need to specify them.

### Closure Report

When all conditions are met, report in structured output:

- `status`: "completed"
- `next_action.action`: "closing" (signals workflow completion)
- `action`: "close" | "label-only" | "label-and-close"
- `summary`: Brief closure summary describing what was accomplished
- `issue.labels`: { add: [...], remove: [...] } (optional, to override defaults)
- `validation`: { git_clean, type_check_passed, tests_passed, ... }
- `evidence`: { git_status_output, type_check_output, ... }

## Boundary Hook

**IMPORTANT**: Do NOT execute any of these commands directly:

- `gh issue close` - Issue closing
- `gh issue edit --add-label` / `--remove-label` - Label changes

When you return `closing` intent, the **Boundary Hook** will automatically:

- Apply label changes based on `action` field and config
  (`github.labels.completion`)
- Close or keep open Issue #{uv-issue_number} based on `action` field

The `action` field in your structured output controls the behavior:

- `"close"`: Close the issue (default)
- `"label-only"`: Add/remove labels only, keep issue **OPEN**
- `"label-and-close"`: Add/remove labels, then close

Your role is to **verify conditions and return the structured output only**. Do
not perform GitHub operations yourself.

---

**This is a closure step.** Return `"closing"` to complete, or `"repeat"` to
retry.
