---
stepId: initial.project.closure
name: Project Closure Message
description: Closure message for project mode
uvVariables:
  - project_number
  - label_info
  - issues_completed
---

Project #{uv-project_number}{uv-label_info} is closed!
{uv-issues_completed} issue(s) have been closed.
