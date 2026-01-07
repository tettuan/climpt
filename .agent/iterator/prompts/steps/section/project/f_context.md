---
stepId: section.projectcontext
name: Project Context Section
description: Project context section inserted into issue prompts when part of a project
c2: section
c3: project
edition: context
uvVariables:
  - project_number
  - project_title
  - label_info
  - current_index
  - total_issues
customVariables:
  - desc_section
  - readme_section
  - remaining_list
  - more_text
---

## Project Overview

**Project #{uv-project_number}**: {uv-project_title}{uv-label_info}
{desc_section}{readme_section}
**Progress**: Issue {uv-current_index} of {uv-total_issues}

### Remaining Issues (for context only)
{remaining_list}{more_text}

---
