---
version: "1.0"
stepId: continuation.default
description: Continuation prompt for subsequent review iterations
uvVariables:
  - iteration
customVariables:
  - created_issues
  - errors
---

# Iteration {uv-iteration}

{created_issues}

{errors}

Continue the review. When all requirements are verified, output a complete action.
