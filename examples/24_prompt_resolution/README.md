# 24: Prompt Resolution

**What:** Demonstrates how prompt file presence affects agent behavior via
PromptResolverAdapter. **Why:** Validates the two-tier resolution strategy (user
file -> fallback) that agents rely on.

## Verifies

- Scenario 1: system.md with {uv-*} variables resolves from file
- Scenario 2: missing system.md falls back to embedded template
- Scenario 3: step prompt file resolves via PromptResolverAdapter
- Scenario 4: missing step prompt falls back to embedded template
