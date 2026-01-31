# Climpt MCP Server Setup Guide

## Overview

Climpt MCP Server is an MCP (Model Context Protocol) server that enables using `climpt` functionality from Claude Code slash commands.

## Available Commands

### `search`

Pass a brief description of the command you want to execute, and it returns the 3 closest commands based on cosine similarity of the description. You can choose the optimal command from the results.

**Arguments:**

- `query` (required): Brief description of what you want to do (e.g., 'commit changes to git', 'generate API documentation', 'run tests')
- `agent` (optional): Agent name to search (e.g., 'climpt', 'inspector'). Defaults to 'climpt' if omitted

**Behavior:**

- Calculates cosine similarity against `c1 + c2 + c3 + description` strings from the specified agent's registry.json
- Returns the top 3 commands by similarity
- Return value includes `c1`, `c2`, `c3`, `description`, `score` for each command

**Basic usage example:**

```json
{
  "query": "commit changes to git repository"
}
```

**Usage example with agent specification:**

```json
{
  "query": "analyze code quality",
  "agent": "inspector"
}
```

### `describe`

Pass the `c1`, `c2`, `c3` received from search, and it returns all descriptions for matching commands. From this you can learn the optimal usage and option combinations, and choose how to use options.

**Arguments:**

- `c1` (required): Domain identifier from search (e.g., git, spec, test, code, docs, meta)
- `c2` (required): Action identifier from search (e.g., create, analyze, execute, generate)
- `c3` (required): Target identifier from search (e.g., unstaged-changes, quality-metrics, unit-tests)
- `agent` (optional): Agent name to search (e.g., 'climpt', 'inspector'). Defaults to 'climpt' if omitted

**Behavior:**

- Returns all records matching the specified `c1`, `c2`, `c3` from the specified agent's registry.json
- If multiple records with the same c1, c2, c3 but different options exist, all are returned
- Returns complete JSON structure including usage, available options, and file/stdin/output support

**Basic usage example:**

```json
{
  "c1": "git",
  "c2": "group-commit",
  "c3": "unstaged-changes"
}
```

**Usage example with agent specification:**

```json
{
  "c1": "code",
  "c2": "analyze",
  "c3": "complexity",
  "agent": "inspector"
}
```

### `execute`

Based on the detailed information from describe, always pass the 4 values `<agent-name>`, `<c1>`, `<c2>`, `<c3>`, along with option arguments (`-*`/`--*` format) obtained from describe. Create the values to pass to options before passing to execute. The result of execute is an instruction, so proceed according to the obtained instructions.

**Note:**
If STDIN support is needed, execute the climpt command directly from CLI instead of MCP.

**Arguments:**

- `agent` (required): Agent name per C3L specification (e.g., 'climpt', 'inspector', 'auditor'). Corresponds to the agent (autonomous executor) in the Agent-Domain model
- `c1` (required): Domain identifier from describe (e.g., git, spec, test, code, docs, meta)
- `c2` (required): Action identifier from describe (e.g., create, analyze, execute, generate)
- `c3` (required): Target identifier from describe (e.g., unstaged-changes, quality-metrics, unit-tests)
- `options` (optional): Array of command-line options from describe (e.g., `['-f=file.txt']`)

**Behavior:**

- Constructs `--config` parameter per C3L v0.5 specification: `--config=<c1>` if `agent === "climpt"`, otherwise `--config=<agent>-<c1>`
- Executes `deno run jsr:@aidevtool/climpt --config=... <c2> <c3> [options]`
- Returns execution result including stdout, stderr, and exit code
- The execution result contains instructions; proceed with the next task according to those instructions

**Basic usage example:**

```json
{
  "agent": "climpt",
  "c1": "git",
  "c2": "group-commit",
  "c3": "unstaged-changes"
}
```

Executed command:

```bash
deno run --allow-read --allow-write --allow-env --allow-run --allow-net --no-config jsr:@aidevtool/climpt --config=git group-commit unstaged-changes
```

**Usage example with options:**

```json
{
  "agent": "inspector",
  "c1": "code",
  "c2": "analyze",
  "c3": "complexity",
  "options": ["-f=src/main.ts"]
}
```

Executed command:

```bash
deno run --allow-read --allow-write --allow-env --allow-run --allow-net --no-config jsr:@aidevtool/climpt --config=inspector-code analyze complexity -f=src/main.ts
```

### `reload`

After updating registry.json, clears the cache and reloads without restarting the MCP server. You can choose to clear the cache for all agents or only a specific agent.

**Arguments:**

- `agent` (optional): Agent name to reload (e.g., 'climpt', 'inspector'). If omitted, clears cache for all agents and reloads all agents defined in the MCP configuration file

**Behavior:**

- With agent specified: Clears cache for the specified agent and reloads from registry.json
- Without agent specified: Clears cache for all agents and reloads registry.json for all agents defined in the registry configuration file (`.agent/climpt/config/registry_config.json`)
- Correctly updates based on the configuration file even when agents are deprecated or newly added
- Returns command count and success message after reload

**Usage example (specific agent):**

```json
{
  "agent": "climpt"
}
```

**Return example (specific agent):**

```json
{
  "success": true,
  "agent": "climpt",
  "commandCount": 42,
  "message": "Successfully reloaded 42 commands for agent 'climpt'"
}
```

**Usage example (all agents):**

```json
{}
```

**Return example (all agents):**

```json
{
  "success": true,
  "clearedAgents": 2,
  "reloadedAgents": [
    {
      "agent": "climpt",
      "commandCount": 42,
      "success": true
    },
    {
      "agent": "inspector",
      "commandCount": 15,
      "success": true
    }
  ],
  "totalCommands": 57,
  "message": "Cleared cache for all agents and reloaded 2 agents with 57 total commands"
}
```

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/tettuan/climpt.git
cd climpt
```

### 2. Multiple Registry Configuration (v1.6.1+)

To use registries from multiple agents, create `.agent/climpt/config/registry_config.json`.

**Default configuration:** Automatically created when MCP server starts:

```json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json"
  }
}
```

**Multiple agent configuration example:**

```json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json",
    "inspector": ".agent/inspector/registry.json",
    "auditor": ".agent/auditor/registry.json"
  }
}
```

**Configuration location priority:**

1. Current directory: `.agent/climpt/config/registry_config.json`
2. Home directory: `~/.agent/climpt/config/registry_config.json`
3. Default configuration (auto-created)

### 3. Claude Code Configuration

Add the following to Claude Code's settings file (`~/.claude/claude_settings.json`):

```json
{
  "mcpServers": {
    "climpt": {
      "command": "deno",
      "args": [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "/path/to/climpt/src/mcp/index.ts"
      ]
    }
  }
}
```

**Note:** Replace `/path/to/climpt` with the actual path to your climpt repository.

### 4. Verify Operation

1. Restart Claude Code
2. Try the following tools:
   - `search` - Command search (similarity-based)
   - `describe` - Get command details
   - `execute` - Execute commands

## Tool Functions

The MCP server provides the following tools:

### `search` Tool

```javascript
// Usage example: Command search
{
  "tool": "search",
  "arguments": {
    "query": "commit changes to git repository"
  }
}

// Return example
{
  "results": [
    {
      "c1": "git",
      "c2": "group-commit",
      "c3": "unstaged-changes",
      "description": "Create a group commit for unstaged changes",
      "score": 0.338
    }
  ]
}
```

### `describe` Tool

```javascript
// Usage example: Get command details
{
  "tool": "describe",
  "arguments": {
    "c1": "git",
    "c2": "group-commit",
    "c3": "unstaged-changes"
  }
}

// Return example: Entire matching record from registry.json
{
  "commands": [
    {
      "c1": "git",
      "c2": "group-commit",
      "c3": "unstaged-changes",
      "description": "Create a group commit for unstaged changes",
      "usage": "...",
      "options": { ... }
    }
  ]
}
```

## Troubleshooting

### Server Won't Start

- Verify Deno is installed: `deno --version`
- Verify the path is correct
- Verify permission flags are appropriate

### Commands Not Recognized

- Restart Claude Code
- Verify JSON syntax in configuration file
- Verify MCP server name is `climpt`

## Developer Information

### Local Testing

```bash
# Start MCP server directly for testing
deno run --allow-read --allow-write --allow-net --allow-env src/mcp/index.ts
```

### Debugging

Set environment variable `DEBUG=mcp*` to see detailed logs.

## Reference Links

- [MCP SDK for TypeScript](https://jsr.io/@modelcontextprotocol/sdk)
- [Climpt Repository](https://github.com/tettuan/climpt)
- [Breakdown Package](https://jsr.io/@tettuan/breakdown)
