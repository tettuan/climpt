# MCP Integration Specification

This document explains the integration specification between Climpt Agent and
Climpt MCP server.

## Overview

Climpt Agent performs command search, detail retrieval, and execution through
the Climpt MCP server.

## MCP Server Configuration

### .mcp.json

```json
{
  "mcpServers": {
    "climpt": {
      "type": "stdio",
      "command": "deno",
      "args": [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-run",
        "${CLAUDE_PLUGIN_ROOT}/../src/mcp/index.ts"
      ],
      "env": {}
    }
  }
}
```

### Environment Variables

| Variable                | Description                       |
| ----------------------- | --------------------------------- |
| `${CLAUDE_PLUGIN_ROOT}` | Absolute path to plugin directory |

## MCP Tools

### search

Searches for similar commands from natural language query.

**Tool name:** `mcp__climpt__search`

**Parameters:**

| Parameter | Type   | Required | Default    | Description  |
| --------- | ------ | -------- | ---------- | ------------ |
| `query`   | string | Yes      | -          | Search query |
| `agent`   | string | No       | `"climpt"` | Agent name   |

**Response:**

```typescript
interface SearchResult {
  c1: string; // Domain identifier
  c2: string; // Action identifier
  c3: string; // Target identifier
  description: string; // Command description
  score: number; // Similarity score (0-1)
}
```

**Usage example:**

```
mcp__climpt__search({
  "query": "group changes and commit",
  "agent": "climpt"
})
```

**Response example:**

```json
[
  {
    "c1": "git",
    "c2": "group-commit",
    "c3": "unstaged-changes",
    "description": "Group file changes by semantic proximity and execute multiple commits sequentially",
    "score": 0.92
  },
  {
    "c1": "git",
    "c2": "decide-branch",
    "c3": "working-branch",
    "description": "Analyze task content and decide whether to create a new branch",
    "score": 0.45
  }
]
```

### describe

Retrieves detailed command information from C3L identifiers.

**Tool name:** `mcp__climpt__describe`

**Parameters:**

| Parameter | Type   | Required | Default    | Description       |
| --------- | ------ | -------- | ---------- | ----------------- |
| `agent`   | string | No       | `"climpt"` | Agent name        |
| `c1`      | string | Yes      | -          | Domain identifier |
| `c2`      | string | Yes      | -          | Action identifier |
| `c3`      | string | Yes      | -          | Target identifier |

**Response:**

```typescript
interface CommandDescription {
  c1: string;
  c2: string;
  c3: string;
  description: string;
  usage?: string;
  options?: {
    edition?: string[];
    adaptation?: string[];
    file?: boolean;
    stdin?: boolean;
    destination?: boolean;
  };
}
```

**Usage example:**

```
mcp__climpt__describe({
  "agent": "climpt",
  "c1": "git",
  "c2": "group-commit",
  "c3": "unstaged-changes"
})
```

### execute

Executes a command and retrieves the instruction prompt.

**Tool name:** `mcp__climpt__execute`

**Parameters:**

| Parameter | Type   | Required | Default | Description                                 |
| --------- | ------ | -------- | ------- | ------------------------------------------- |
| `agent`   | string | Yes      | -       | Agent name (`"climpt"`)                     |
| `c1`      | string | Yes      | -       | Domain identifier (e.g., `"git"`, `"meta"`) |
| `c2`      | string | Yes      | -       | Action identifier                           |
| `c3`      | string | Yes      | -       | Target identifier                           |
| `options` | object | No       | `{}`    | Command options                             |

**Response:**

Instruction document (prompt) is returned as text.

**Usage example:**

```
mcp__climpt__execute({
  "agent": "climpt",
  "c1": "git",
  "c2": "group-commit",
  "c3": "unstaged-changes",
  "options": {}
})
```

### reload

Reloads the registry cache.

**Tool name:** `mcp__climpt__reload`

**Parameters:**

| Parameter | Type   | Required | Default    | Description |
| --------- | ------ | -------- | ---------- | ----------- |
| `agent`   | string | No       | `"climpt"` | Agent name  |

**Usage example:**

```
mcp__climpt__reload({
  "agent": "climpt"
})
```

## Registry Structure

### File Path

```
.agent/climpt/registry.json
```

### Schema

```typescript
interface Registry {
  version: string;
  description: string;
  tools: {
    availableConfigs?: string[];
    commands: Command[];
  };
}

interface Command {
  c1: string; // Domain identifier
  c2: string; // Action identifier
  c3: string; // Target identifier
  description: string; // Command description
  usage?: string; // Usage
  options?: {
    edition?: string[];
    adaptation?: string[];
    file?: boolean;
    stdin?: boolean;
    destination?: boolean;
  };
}
```

### Current Command List

#### c1: git

| c2              | c3                  | Description                                           |
| --------------- | ------------------- | ----------------------------------------------------- |
| `decide-branch` | `working-branch`    | Decide whether to create branch based on task content |
| `find-oldest`   | `descendant-branch` | Search and merge oldest related branch                |
| `group-commit`  | `unstaged-changes`  | Commit changes in semantic units                      |
| `list-select`   | `pr-branch`         | Select next target from PR-attached branch list       |
| `merge-up`      | `base-branch`       | Merge derived branch to parent branch                 |

#### c1: meta

| c2       | c3            | Description                             |
| -------- | ------------- | --------------------------------------- |
| `build`  | `frontmatter` | Generate C3L v0.5 compliant frontmatter |
| `create` | `instruction` | Create new instruction file             |

## Command Execution Flow

```
┌──────────────────────────────────────────────────────────────┐
│                     Climpt MCP Server                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ execute tool                                            │ │
│  │                                                         │ │
│  │ 1. Receive agent, c1, c2, c3, options                  │ │
│  │ 2. Construct configParam:                              │ │
│  │    - agent === "climpt" → use c1 as is                 │ │
│  │    - otherwise → use `${agent}-${c1}`                  │ │
│  │ 3. Execute Climpt CLI with Deno:                       │ │
│  │    deno run jsr:@aidevtool/climpt                      │ │
│  │      --config=${configParam}                           │ │
│  │      ${c2}                                             │ │
│  │      ${c3}                                             │ │
│  │ 4. Return stdout (instruction prompt)                  │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## Similarity Search Algorithm

### Overview

The `search` tool uses TF-IDF based cosine similarity to search commands.

### Implementation Details

```
1. Tokenize query
2. Tokenize description of each command
3. Calculate TF-IDF vectors
4. Rank by cosine similarity
5. Sort by descending score
```

### Score Interpretation

| Score Range | Interpretation   |
| ----------- | ---------------- |
| 0.8 - 1.0   | Very high match  |
| 0.5 - 0.8   | Moderate match   |
| 0.2 - 0.5   | Low match        |
| 0.0 - 0.2   | Almost unrelated |

## Error Handling

### Command Not Found

```json
{
  "error": "Command not found",
  "c1": "climpt-git",
  "c2": "invalid-command",
  "c3": "target"
}
```

### Registry Load Error

```json
{
  "error": "Failed to load registry",
  "path": ".agent/climpt/registry.json",
  "details": "File not found"
}
```

### Execution Error

```json
{
  "error": "Execution failed",
  "command": "climpt-git group-commit unstaged-changes",
  "stderr": "<error output>"
}
```

## Best Practices

1. Call in order of **search → describe → execute**
2. When there are multiple search results, check `score` and `description` to
   select
3. Execute `reload` after updating registry.json
4. Always use `"climpt"` for the `agent` parameter
