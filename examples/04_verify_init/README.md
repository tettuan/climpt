# 04: Verify Init

**What:** Verifies that `climpt init` created the expected directory structure.
**Why:** Catches init regressions that would break all downstream examples.

## Verifies

- `.agent/climpt/config/` directory exists
- `.agent/climpt/prompts/` directory exists
