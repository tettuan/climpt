---
stepId: continuation.project.processingdone
name: Project Processing Done
description: Message when all issues are processed
c2: continuation
c3: project
edition: processing
adaptation: done
uvVariables:
  - project_number
  - completed_iterations
  - issues_completed
---

All issues in Project #{uv-project_number} have been processed!
Iterations: {uv-completed_iterations}, Issues closed: {uv-issues_completed}

Moving to review phase.
