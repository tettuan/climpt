# 31: Run Iterator Agent

**What:** Runs the iterator agent built in steps 28-30 (LLM required). **Why:**
Verifies the init → configure → run pipeline produces a working agent.

## Verifies

- `.agent/iterator/agent.json` exists (built by prior steps)
- Agent starts and completes successfully
- Output contains "Agent completed: SUCCESS"
