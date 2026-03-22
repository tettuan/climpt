# 36: Run Reviewer Agent

**What:** Runs the reviewer agent built in steps 33-35 (LLM required). **Why:**
Verifies the init → configure → run pipeline produces a working agent.

## Verifies

- `.agent/reviewer/agent.json` exists (built by prior steps)
- Agent starts and completes successfully
- Output contains "Agent completed: SUCCESS"
