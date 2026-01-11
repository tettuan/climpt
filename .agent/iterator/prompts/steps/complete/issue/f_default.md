---
stepId: complete
name: Completion Step
description: Completion step - instructs structured signal format for closing
uvVariables:
  - issue_number
---

# Completion Step

Task is complete. Report completion using the structured signal format below.

## Completion Report

Use the following format to report task completion:

```issue-action
{
  "action": "close",
  "issue": {uv-issue_number},
  "body": "## Resolution\n\n- Summary of what was implemented\n- How it was verified\n- Git status: clean (all changes committed)"
}
```

## Requirements

1. **Structured Signal**: Use the `issue-action` code block format above
2. **Action**: Set to `"close"` to close the issue
3. **Issue Number**: Use the current issue number ({uv-issue_number})
4. **Body**: Include a resolution summary with:
   - What was implemented
   - How it was verified
   - Confirmation that git status is clean

## After Reporting

After outputting the structured signal:
- The issue will be closed automatically
- No further action is required

**Important**: Do not run `gh issue close` directly. Use the structured signal format above.
