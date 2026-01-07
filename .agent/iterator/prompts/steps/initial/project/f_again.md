---
stepId: initial.project.again
name: Project Again Prompt
description: Re-execution phase prompt after failed review
uvVariables:
  - project_number
  - project_title
  - label_info
customVariables:
  - review_summary
  - review_findings
---

## Re-execution Required

**Project #{uv-project_number}**: {uv-project_title}{uv-label_info}

## Review Findings

The previous review found these issues:
{review_summary}

Issues needing attention:
{review_findings}

## Your Task

Address the review findings:
1. Analyze each issue that needs attention
2. Complete any remaining work
3. Fix any problems identified
4. Report completion when done

After addressing all findings, the system will run another review.
