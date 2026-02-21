# 14: Show Agent Schema

**What:** Validates the agent JSON schema file is present and well-formed.
**Why:** A broken schema prevents agent initialization and validation.

## Verifies

- `agents/schemas/agent.schema.json` exists
- Schema is valid JSON (`jq empty` passes)
- Schema contains `"runner"` property definition
