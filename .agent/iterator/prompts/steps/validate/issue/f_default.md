---
stepId: validate
name: Pre-Close Validation Step
description: MANDATORY validation step before issue close - ensures all changes are committed
uvVariables: []
---

# Pre-Close Validation Step (MANDATORY)

**CRITICAL**: This step MUST be completed before closing the issue. Do NOT skip
this step.

## Git Status Check (Required)

Execute the following commands in order:

1. **Run `git status`** to check for uncommitted changes
2. **If there are ANY uncommitted changes**:
   - Stage all changes: `git add .`
   - Create a commit with a descriptive message summarizing the work done
   - Example: `git commit -m "feat: implement feature X for issue #Y"`
3. **Run `git status` again** to confirm the working tree is clean

## Validation Requirements

The following conditions MUST all be true before proceeding:

1. `git status` shows "nothing to commit, working tree clean"
2. All implementation changes have been committed
3. No untracked files that should be part of the implementation

## Commit Message Guidelines

When creating commits:

- Use conventional commit format: `type: description`
- Types: feat, fix, docs, refactor, test, chore
- Reference the issue number when relevant
- Be descriptive about what was changed

## Failure Handling

**If validation fails**:

- DO NOT proceed to close the issue
- Fix the issues (create commits for uncommitted changes)
- Re-run `git status` to verify
- Only proceed when working tree is clean

**IMPORTANT**: Issues MUST NOT be closed with uncommitted changes. This
validation ensures code integrity.
