---
stepId: validate
name: Validation Step
description: Validation step before completion - checks git status and uncommitted changes
uvVariables: []
---

# Validation Step

Before completing the task, please verify the following:

## Git Status Check

1. **Run `git status`** to check for uncommitted changes
2. If there are uncommitted changes:
   - Stage them: `git add .`
   - Commit with a descriptive message: `git commit -m "Your message"`
3. Run `git status` again to confirm "nothing to commit, working tree clean"

## Validation Checklist

- [ ] All code changes are committed
- [ ] No untracked files that should be committed
- [ ] Working tree is clean

## Proceed

Once all validations pass, proceed to the completion step.

**If validation fails**: Fix the issues before completing the task. Do not skip this step.
