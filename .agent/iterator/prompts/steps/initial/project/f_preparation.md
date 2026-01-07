---
stepId: initial.project.preparation
name: Project Preparation Prompt
description: Preparation phase prompt for project mode
uvVariables:
  - project_number
  - project_title
  - label_info
  - total_issues
customVariables:
  - desc_section
  - readme_section
  - issue_list
---

## Project Overview

**Project #{uv-project_number}**: {uv-project_title}{uv-label_info}{desc_section}{readme_section}

## Issues to Process ({uv-total_issues} total)

{issue_list}

## Your Task

Analyze this project and prepare for execution:
1. Review all issues and understand the overall requirements
2. Identify which skills and sub-agents are needed
3. Note any dependencies between issues
4. Create an execution plan

Output your plan in the specified project-plan format.
