---
stepId: retry.format-error
name: Format Error Retry
description: Re-request prompt when output format is incorrect
uvVariables:
  - error_message
  - issue_number
---

# Format Error - Please Retry

Your previous response did not match the expected format.

## Error

{uv-error_message}

## Expected Format

Please output in the following format:

```issue-action
{
  "action": "close",
  "issue": {uv-issue_number},
  "body": "## Resolution\n\n- Summary of changes\n- Verification method\n- Git status: clean"
}
```

## Requirements

1. Use the `issue-action` code block format above
2. Include all required fields:
   - `action`: must be "close"
   - `issue`: must be the issue number ({uv-issue_number})
   - `body`: resolution summary

**Important**: Output ONLY the structured signal above. No additional explanation needed.
