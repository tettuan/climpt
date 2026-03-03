---
c1: git
c2: decide-branch
c3: working-branch
title: Decide Working Branch Name
description: Decide whether to create a new branch or continue on the current branch based on task content
usage: climpt-git decide-branch working-branch
c3l_version: "0.5"
options:
  edition: ["default"]
  adaptation: ["default"]
  file: false
  stdin: true
  destination: false
input_text: Task description for branch decision
---

# Decide Working Branch

Determine the appropriate Git branch name based on the task description.

## Branch Naming Convention

- `feature/<description>` for new features
- `fix/<description>` for bug fixes
- `refactor/<description>` for refactoring

## Task Description

{input_text}

## Output

Return the recommended branch name.
