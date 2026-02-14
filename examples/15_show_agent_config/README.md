# 15: Show Agent Config

**What:** Displays actual agent directory layout and schema structure
dynamically. **Why:** Catches stale hardcoded documentation that drifts from the
real schema.

## Verifies

- `agents/` directory exists with subdirectories
- `agent.schema.json` required fields can be extracted with jq
- Schema property keys can be listed dynamically
