# Agent Script Specification (climpt-agent.ts)

This document explains the technical specification of `climpt-agent.ts`.

## Overview

`climpt-agent.ts` is a script that dynamically generates and executes Sub-agents using the Claude Agent SDK.

## File Information

- **Path**: `climpt-plugins/skills/delegate-climpt-agent/scripts/climpt-agent.ts`
- **Runtime**: Deno 2.x
- **Dependencies**: `npm:@anthropic-ai/claude-agent-sdk`

## Command Line Interface

### Usage

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  climpt-agent.ts \
  --agent=<name> \
  --c1=<c1> \
  --c2=<c2> \
  --c3=<c3> \
  [--options=<opt1,opt2,...>]
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--agent` | Yes | MCP server identifier (e.g., `"climpt"`, `"inspector"`) |
| `--c1` | Yes | Domain identifier (e.g., `git`, `meta`) |
| `--c2` | Yes | Action identifier (e.g., `group-commit`) |
| `--c3` | Yes | Target identifier (e.g., `unstaged-changes`) |
| `--options` | No | Comma-separated options |

### Execution Example

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  climpt-agent.ts \
  --agent=climpt \
  --c1=git \
  --c2=group-commit \
  --c3=unstaged-changes
```

## Internal Architecture

### Processing Flow

```
1. Parse command line arguments
   ↓
2. Validate parameters
   ↓
3. Generate Sub-agent name (C3L naming convention)
   ↓
4. Execute Climpt CLI → Get prompt
   ↓
5. Execute Sub-agent with Claude Agent SDK
   ↓
6. Process message stream
   ↓
7. Complete or report error
```

### Key Functions

#### generateSubAgentName

```typescript
function generateSubAgentName(cmd: ClimptCommand): string
```

Generates Sub-agent name based on C3L naming convention. Format: `<agent>-<c1>-<c2>-<c3>`

**Input:**

```typescript
{
  agent: "climpt",
  c1: "git",
  c2: "group-commit",
  c3: "unstaged-changes"
}
```

**Output:**

```
"climpt-git-group-commit-unstaged-changes"
```

#### getClimptPrompt

```typescript
async function getClimptPrompt(cmd: ClimptCommand): Promise<string>
```

Executes Climpt CLI to retrieve instruction prompt.

**config parameter construction:**

Constructs config parameter based on C3L v0.5 specification:
- If `agent` is `"climpt"`: `configParam = c1` (e.g., `"git"`)
- Otherwise: `configParam = ${agent}-${c1}` (e.g., `"inspector-git"`)

**Executed command:**

```bash
deno run --allow-read --allow-write --allow-env --allow-run --allow-net --no-config \
  jsr:@aidevtool/climpt \
  --config=<configParam>
  <c2> \
  <c3>
```

**Example:**
- agent=`climpt`, c1=`git`, c2=`group-commit`, c3=`unstaged-changes`
- → `--config=git group-commit unstaged-changes`

#### runSubAgent

```typescript
async function runSubAgent(agentName: string, prompt: string, cwd: string): Promise<void>
```

Executes Sub-agent using Claude Agent SDK.

## Claude Agent SDK Configuration

### Options Configuration

```typescript
const options: Options = {
  cwd: string,                    // Working directory
  settingSources: ["project"],    // Load project settings
  allowedTools: [                 // Allowed tools
    "Skill",
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Glob",
    "Grep",
    "Task",
  ],
  systemPrompt: {
    type: "preset",
    preset: "claude_code",        // Claude Code system prompt
  },
};
```

### Allowed Tools List

| Tool | Description |
|------|-------------|
| `Skill` | Call other Skills |
| `Read` | File reading |
| `Write` | File writing |
| `Edit` | File editing |
| `Bash` | Shell command execution |
| `Glob` | File pattern matching |
| `Grep` | Text search |
| `Task` | Sub-agent invocation |

### SDKMessage Processing

```typescript
function handleMessage(message: SDKMessage): void
```

**Message Types:**

| Type | Subtype | Description |
|------|---------|-------------|
| `assistant` | - | Assistant response text |
| `result` | `success` | Normal completion, includes cost info |
| `result` | `error` | Error occurred, includes error details |
| `system` | `init` | Session initialization, session_id, model info |

## Error Handling

### Climpt Execution Error

```typescript
if (code !== 0) {
  const errorText = new TextDecoder().decode(stderr);
  throw new Error(`Climpt execution failed: ${errorText}`);
}
```

### Parameter Validation Error

```typescript
if (!cmd.agent || !cmd.c1 || !cmd.c2 || !cmd.c3) {
  console.error("Usage: climpt-agent.ts --agent=<name> ...");
  Deno.exit(1);
}
```

### SDK Error

```typescript
case "result":
  if (message.subtype !== "success") {
    console.error(`Error: ${message.subtype}`);
    if ("errors" in message) {
      console.error(message.errors.join("\n"));
    }
  }
```

## Output Format

### Standard Output (stdout)

Sub-agent's text response is output.

### Standard Error (stderr)

Execution status and meta information is output:

```
Generated sub-agent name: climpt-git-group-commit-unstaged-changes
Fetching prompt for: climpt-git group-commit unstaged-changes
Starting sub-agent: climpt-git-group-commit-unstaged-changes
Session: abc123, Model: claude-3-opus
Completed. Cost: $0.0150
```

## Deno Permissions

Permissions required for script execution:

| Permission | Reason |
|------------|--------|
| `--allow-read` | File reading |
| `--allow-write` | File writing |
| `--allow-net` | API communication |
| `--allow-env` | Environment variable access |
| `--allow-run` | Climpt CLI execution |

## Dependencies

### npm Packages

```typescript
import { query } from "npm:@anthropic-ai/claude-agent-sdk";
import type { Options, SDKMessage } from "npm:@anthropic-ai/claude-agent-sdk";
```

### JSR Packages

Climpt CLI is executed via jsr:

```bash
deno run jsr:@aidevtool/climpt
```

## Testing Methods

### Unit Test

```bash
# Parameter parsing test
deno run climpt-agent.ts --agent=climpt --c1=climpt-git --c2=group-commit --c3=unstaged-changes
```

### Integration Test

```bash
# Actual Climpt command execution
deno run --allow-all climpt-agent.ts \
  --agent=climpt \
  --c1=climpt-git \
  --c2=group-commit \
  --c3=unstaged-changes
```
