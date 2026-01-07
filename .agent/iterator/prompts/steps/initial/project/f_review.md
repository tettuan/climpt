---
stepId: initial.project.review
name: Project Review Prompt
description: Review phase prompt for project mode
uvVariables:
  - project_number
  - project_title
  - label_info
  - issues_completed
  - label_filter
customVariables:
  - completed_list
---

## Project Review

**Project #{uv-project_number}**: {uv-project_title}{uv-label_info}

## Work Completed

{uv-issues_completed} issue(s) closed:
{completed_list}

## Your Task

Review the project completion status:
1. Verify all issues with "{uv-label_filter}" label are properly closed
2. Check each issue's resolution quality
3. Identify any remaining work needed

Output your review in the specified review-result format.
