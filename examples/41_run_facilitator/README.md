# 41: Run Facilitator Agent

**What:** Runs the facilitator agent built in steps 38-40 with `--project 1`
(LLM required). **Why:** Verifies the init → configure → run pipeline produces a
working agent.

## Verifies

- `.agent/facilitator/agent.json` exists (built by prior steps)
- Agent starts and completes successfully
- Output contains "Agent completed: SUCCESS"
