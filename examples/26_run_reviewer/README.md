# 26: Run Reviewer Agent

**What:** Runs the reviewer agent with a synthetic project (no API key needed).
**Why:** Catches import errors, missing modules, and startup crashes in the
agent pipeline.

## Verifies

- `review-agent` task exists in deno.json
- Agent starts without import/startup crash
- Output contains agent-related content
