# Agent Discovery

Discover available agents in the project.

## Purpose

Identify all agents that can be recommended for subsequent work.

## Tasks

1. **Scan Agent Directory**
   - Search `.agent/*/agent.json` files
   - Exclude `facilitator` from recommendations

2. **Extract Agent Information**
   For each discovered agent, extract:
   - `name`: Agent identifier
   - `displayName`: Human-readable name
   - `description`: What the agent does
   - `capabilities`: From `actions.types` array
   - `parameters`: Available CLI options

3. **Build Agent Registry**
   Create a registry of available agents with their capabilities.

## Output

Output the discovered agents using:

```agent-registry
{
  "agents": [
    {
      "name": "agent-name",
      "displayName": "Agent Display Name",
      "description": "What this agent does",
      "capabilities": ["capability-1", "capability-2"],
      "parameters": {"key": "value"}
    }
  ],
  "discoveredAt": "ISO-8601-timestamp"
}
```

## Example Discovery

For an agent with the following `agent.json`:

```json
{
  "name": "iterator",
  "displayName": "Iterator Agent",
  "description": "Autonomous development agent",
  "actions": {
    "types": ["issue-action", "project-plan"]
  }
}
```

The output would include:

```json
{
  "name": "iterator",
  "displayName": "Iterator Agent",
  "description": "Autonomous development agent",
  "capabilities": ["issue-action", "project-plan"]
}
```
