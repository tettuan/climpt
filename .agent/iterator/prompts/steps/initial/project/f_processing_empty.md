---
stepId: initial.project.processingempty
name: Project Processing (No Current Issue)
description: Processing phase prompt when no current issue
c2: initial
c3: project
edition: processing
adaptation: empty
uvVariables:
  - project_number
  - label_info
  - project_title
  - label_filter
customVariables:
  - desc_section
  - readme_section
---

You are working on GitHub Project #{uv-project_number}{uv-label_info}.

## Project Overview
**{uv-project_title}**{desc_section}{readme_section}

## Status
All{uv-label_filter} issues in this project are already complete! No work needed.
