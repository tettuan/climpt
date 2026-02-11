---
stepId: closure.externalState
name: External State Closure Prompt (Label and Close)
description: Terminal step for external state closure - labels then closes
uvVariables:
  - issue_number
customVariables:
  - summary_section
adaptation: label-and-close
---

# External State Closure: Issue #{uv-issue_number} (Label and Close)

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

## Your Role: Implementation Complete, Label and Close Issue

You are an **implementation agent**. Your work is done when:

1. All code changes are committed
2. Labels are updated and the issue is closed

## Closure Verification

### Final Checklist

Verify the following before returning `closing` intent:

1. **Git Status**: Run `git status --porcelain` - must be empty (no uncommitted
   changes)
2. **Implementation**: All required changes should be committed

### If Not Ready

If any of the above are not satisfied:

- Fix the issue (commit remaining changes, etc.)
- Report `next_action.action = "repeat"` to retry closure validation

### Closure Action

This step will **change labels and then close** Issue #{uv-issue_number}.

### Closure Report

When all conditions are met, report in structured output:

- `status`: "completed"
- `next_action.action`: "closing" (signals workflow completion)
- `action`: "label-and-close"
- `summary`: Brief closure summary describing what was accomplished
- `issue.labels`: { add: [...], remove: [...] } (optional, to override defaults)

## Boundary Hook

**IMPORTANT**: Do NOT execute any of these commands directly:

- `gh issue close` - Issue closing
- `gh issue edit --add-label` / `--remove-label` - Label changes

When you return `closing` intent, the **Boundary Hook** will automatically:

- Apply label changes based on config (`github.labels.completion`)
- Close Issue #{uv-issue_number}

Your role is to **verify conditions and return the structured output only**. Do
not perform GitHub operations yourself.

---

**This is a closure step.** Return `"closing"` to complete, or `"repeat"` to
retry.
