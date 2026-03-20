# 25: Run Iterator Agent

**What:** Runs the iterator agent with a synthetic issue (no API key needed).
**Why:** Catches import errors, missing modules, and startup crashes in the
agent pipeline.

## Verifies

- `iterate-agent` task exists in deno.json
- Agent starts without import/startup crash
- Output contains agent-related content
