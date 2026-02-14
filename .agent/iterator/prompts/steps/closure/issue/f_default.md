---
stepId: closure.issue
name: Issue Closure Prompt (Close)
description: Terminal step for issue completion - closes the issue
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

## Your Role: Implementation Complete, Close Issue

You are an **implementation agent**. Your work is done when:

1. All code changes are committed
2. Tests pass
3. The issue is closed

## Closure Verification

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

### Closure Action

This step will **close** Issue #{uv-issue_number}.

### Closure Report

When all conditions are met, report in structured output:

- `status`: "completed"
- `next_action.action`: "closing" (signals workflow completion)
- `action`: "close"
- `summary`: Brief closure summary describing what was accomplished
- `issue.labels`: { add: [...], remove: [...] } (optional, to override defaults)
- `validation`: { git_clean, type_check_passed, tests_passed, ... }
- `evidence`: { git_status_output, type_check_output, ... }

## Boundary Hook

**IMPORTANT**: Do NOT execute any of these commands directly:

- `gh issue close` - Issue closing
- `gh issue edit --add-label` / `--remove-label` - Label changes

When you return `closing` intent, the **Boundary Hook** will automatically:

- Apply label changes based on config (`github.labels.completion`)
- Close Issue #{uv-issue_number}

Your role is to **verify conditions and return the structured output only**. Do
not perform GitHub operations yourself.

## CRITICAL: Return Structured JSON

Your response MUST be valid JSON matching the closure step's schema. DO NOT return natural language text or summaries. Return the structured JSON with `status`, `next_action`, `summary`, `validation`, and `evidence` fields.

---

**This is a closure step.** Return `"closing"` to complete, or `"repeat"` to
retry.
