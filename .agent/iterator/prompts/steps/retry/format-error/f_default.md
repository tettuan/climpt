---
stepId: retry.format-error
name: Format Error Retry
description: Re-request prompt when output format is incorrect
uvVariables:
  - expected_format
  - error_message
  - issue
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
  "issue": {uv-issue},
  "body": "## Resolution\n\n- Summary of changes\n- Verification method\n- Git status: clean"
}
```

## Requirements

1. Use the `issue-action` code block format (triple backticks with
   `issue-action` language identifier)
2. Include all required fields:
   - `action`: must be "close"
   - `issue`: must be the issue number ({uv-issue})
   - `body`: resolution summary

**Important**: Output ONLY the structured signal above. No additional
explanation needed.

## Allowed `next_action.action` values

The `issue-action` block above is the **side-channel signal** for the boundary
hook (its `"action": "close"` field is unrelated to `next_action.action`). Your
structured JSON response is also fed back into the failing step, so
`next_action.action` MUST satisfy that step's enum:

- `closure.issue` → `["closing","repeat"]`. Emit `closing` to advance to
  terminal closure once formatting is correct, or `repeat` to re-emit the
  closure response.
- `closure.issue.precheck-*` → `["next","repeat"]`. Emit `repeat` to re-emit the
  precheck response in the correct format.
- `initial.issue` → `["next","repeat"]`. Emit `repeat` to re-emit the initial
  response in the correct format.
- `continuation.issue` → `["next","repeat","handoff"]`. Emit the value matching
  the original step's intent in the correct format.

Do NOT mix the `issue-action` enum (`close`, `progress`, `question`, `blocked`)
with the schema-level `next_action.action` enum. Any `next_action.action` value
outside the allowed enum for the failing step triggers
`GATE_INTERPRETATION_ERROR` (failFast) and aborts the run. Canonical schema:
`.agent/iterator/schemas/issue.schema.json`.
