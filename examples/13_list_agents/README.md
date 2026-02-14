# 13: List Agents

**What:** Verifies that agent infrastructure (tasks, configs, runner) is in
place. **Why:** Agent listing must reflect actual agent definitions, not
internal modules.

## Verifies

- `iterate-agent` and `review-agent` tasks exist in deno.json
- At least one `.agent/*/agent.json` config exists (excluding climpt/)
- `agents/scripts/run-agent.ts` runner script exists
