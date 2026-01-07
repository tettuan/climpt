---
stepId: initial.project.complete
name: Project Complete Message
description: Completion message for project mode
uvVariables:
  - project_number
  - label_info
  - issues_completed
---

Project #{uv-project_number}{uv-label_info} is complete!
{uv-issues_completed} issue(s) have been closed.
