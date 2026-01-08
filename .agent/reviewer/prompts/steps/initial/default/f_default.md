---
stepId: initial.default
name: Initial Review Prompt
description: Initial prompt for review task with project context
uvVariables:
  - project
  - requirements_label
  - review_label
customVariables:
  - requirements_issues
  - review_targets
  - traceability_ids
---

# Review Task

Review implementation for GitHub Project #{uv-project}

## Label System

- Requirements/Specs: Issues with '{uv-requirements_label}' label
- Review Targets: Issues with '{uv-review_label}' label

## Requirements Issues ({uv-requirements_label} label)

{requirements_issues}

## Review Target Issues ({uv-review_label} label)

{review_targets}

## All Traceability IDs to Verify

{traceability_ids}

## Instructions

1. For each traceability ID from requirements ({uv-requirements_label}), search
   the codebase
2. Verify the implementation meets the requirements
3. For any gaps found, output a review-action block to create an issue
4. When complete, output a review-action block with action="complete"

Start by analyzing the codebase for implementations related to the requirements.
