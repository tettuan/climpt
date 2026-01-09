---
stepId: continuation.default
name: Continuation Review Prompt
description: Continuation prompt for subsequent review iterations
uvVariables:
  - iteration
---

# Continue Review - Iteration {uv-iteration}

Continue the review process. If you have completed all verification tasks,
output the completion action.

## Remaining Tasks

Review any remaining traceability IDs that have not been verified.

## When Complete

When all requirements have been verified:

```review-action
{"action":"complete","summary":"Review completed. Summary of findings..."}
```
