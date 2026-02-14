# 09: Git Commands

**What:** Tests the git domain `decide-branch` command. **Why:** Branch naming
is used by agent automation; wrong output breaks the CI pipeline.

## Verifies

- `decide-branch` output contains branch-related content (branch, fix/,
  feature/, etc.)
