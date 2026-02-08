# Climpt Agents

Autonomous agent execution framework using the Claude Code SDK. Integrates with
the Climpt prompt management system to enable iterative task execution.

**New to agent configuration?** See the [Builder Guide](./docs/builder/) for
step-by-step documentation on creating and customizing agents.

## Features

- **Dual-Loop Architecture**: Flow Loop (step advancement) + Completion Loop
  (validation)
- **Multiple Completion Strategies**: externalState, iterate, manual, stepFlow
- **C3L Prompt Management**: Structured prompt management through Climpt
  integration
- **Worktree Isolation**: Git worktree support for branch-isolated execution
- **Flexible Configuration**: Type-safe agent definitions via JSON Schema

## Architecture

The agent runtime uses a **dual-loop architecture**:

```
┌─────────────────────────────────────────────────┐
│                  Agent Runner                    │
│  ┌───────────────┐    ┌───────────────────────┐ │
│  │  Flow Loop    │───>│  Completion Loop      │ │
│  │  (steps)      │    │  (validation)         │ │
│  └───────────────┘    └───────────────────────┘ │
└─────────────────────────────────────────────────┘
```

- **Flow Loop**: Advances through steps, manages handoff data, resolves prompts
- **Completion Loop**: Validates completion conditions after completion signal

## Quick Start

### 1. Create a GitHub Issue

```bash
gh issue create --title "Task title" --body "Task description"
```

### 2. Run the Iterator Agent

```bash
# Basic execution with issue number
deno run -A agents/scripts/run-agent.ts --agent iterator --issue <ISSUE_NUMBER>

# Or use deno task
deno task iterate-agent --issue <ISSUE_NUMBER>

# With iteration limit
deno run -A agents/scripts/run-agent.ts --agent iterator --issue 123 --iterate-max 20

# Resume previous session
deno run -A agents/scripts/run-agent.ts --agent iterator --issue 123 --resume
```

### CLI Options

```bash
# Show help
deno run -A agents/scripts/run-agent.ts --help

# List available agents
deno run -A agents/scripts/run-agent.ts --list
```

| Option                 | Description                       |
| ---------------------- | --------------------------------- |
| `--agent, -a <name>`   | Agent name (iterator, reviewer)   |
| `--issue, -i <n>`      | GitHub Issue number               |
| `--iterate-max <n>`    | Maximum iterations (default: 500) |
| `--resume`             | Resume previous session           |
| `--branch <name>`      | Working branch for worktree       |
| `--base-branch <name>` | Base branch for worktree          |
| `--verbose, -v`        | Enable verbose logging            |

### Running the Reviewer Agent

```bash
deno run -A agents/scripts/run-agent.ts --agent reviewer --target src/
```

## Directory Structure

```
agents/
+-- mod.ts                    # Public API exports
+-- CLAUDE.md                 # Agent development guidelines
+-- scripts/
|   +-- run-agent.ts          # Unified agent runner CLI
+-- runner/                   # Core runner implementation
|   +-- runner.ts             # AgentRunner (dual-loop core)
|   +-- builder.ts            # Dependency injection builder
|   +-- cli.ts                # CLI argument parser
|   +-- loader.ts             # Agent definition loader
+-- completion/               # Completion handlers
|   +-- factory.ts            # Handler factory
|   +-- handlers/             # Built-in handlers
+-- loop/                     # Loop utilities
|   +-- step-context.ts       # Step data passing
|   +-- format-validator.ts   # Response format validation
+-- prompts/                  # Prompt resolution
|   +-- resolver.ts           # Prompt resolver
+-- common/                   # Shared utilities
|   +-- types.ts
|   +-- worktree.ts
|   +-- git-utils.ts
+-- validators/               # Pre-close validators
|   +-- registry.ts
|   +-- plugins/
+-- schemas/                  # JSON Schemas
|   +-- agent.schema.json
|   +-- steps_registry.schema.json
+-- docs/                     # Documentation
```

Agent configurations are located in `/.agent/<agent-name>/`:

```
.agent/
+-- iterator/
|   +-- agent.json            # Agent definition
|   +-- config.json           # Runtime config (optional)
|   +-- steps_registry.json   # Step definitions
|   +-- prompts/              # Prompt templates
+-- reviewer/
    +-- ...
```

## Agent Definition (agent.json)

```json
{
  "$schema": "https://raw.githubusercontent.com/tettuan/climpt/main/agents/schemas/agent.schema.json",
  "version": "1.0.0",
  "name": "code-reviewer",
  "displayName": "Code Reviewer",
  "description": "Agent that performs code reviews",

  "behavior": {
    "systemPromptPath": "prompts/system.md",
    "completionType": "manual",
    "completionConfig": {
      "completionKeyword": "REVIEW_COMPLETE"
    },
    "allowedTools": ["Read", "Glob", "Grep", "Bash"],
    "permissionMode": "acceptEdits"
  },

  "parameters": {
    "target": {
      "type": "string",
      "description": "File or directory to review",
      "required": true,
      "cli": "--target"
    }
  },

  "prompts": {
    "registry": "steps_registry.json",
    "fallbackDir": "prompts/"
  },

  "github": {
    "enabled": true,
    "labels": {
      "completion": {
        "add": ["done"],
        "remove": ["in-progress"]
      }
    },
    "defaultClosureAction": "close"
  },

  "logging": {
    "directory": "tmp/logs/agents/code-reviewer",
    "format": "jsonl"
  }
}
```

### GitHub Integration

Configure Issue closure behavior with the `github` section:

```json
{
  "github": {
    "enabled": true,
    "labels": {
      "completion": {
        "add": ["done"],
        "remove": ["in-progress"]
      }
    },
    "defaultClosureAction": "close"
  }
}
```

#### Closure Actions

| Action            | Description                         |
| ----------------- | ----------------------------------- |
| `close`           | Close the Issue (default)           |
| `label-only`      | Update labels only, keep Issue open |
| `label-and-close` | Update labels then close            |

The AI can override `defaultClosureAction` via structured output.

## Completion Types

### 1. externalState - External State Monitoring

Completes based on external state (e.g., GitHub Issue closed). Used by iterator
agent.

```json
{
  "completionType": "externalState",
  "completionConfig": {
    "maxIterations": 500
  }
}
```

### 2. iterationBudget - Fixed Iteration

Completes after specified number of iterations.

```json
{
  "completionType": "iterationBudget",
  "completionConfig": {
    "maxIterations": 5
  }
}
```

### 3. keywordSignal - Keyword Completion

Completes when agent outputs a specific keyword.

```json
{
  "completionType": "keywordSignal",
  "completionConfig": {
    "completionKeyword": "TASK_COMPLETE"
  }
}
```

### 4. stepMachine - Step-Based Completion

Completes through state machine-like step transitions.

```json
{
  "completionType": "stepMachine",
  "completionConfig": {}
}
```

## Step Registry

### steps_registry.json

```json
{
  "version": "1.0.0",
  "basePath": "prompts",
  "steps": {
    "system": {
      "name": "System Prompt",
      "path": "system.md",
      "variables": ["uv-agent_name", "uv-completion_criteria"]
    },
    "initial_review": {
      "name": "Review Initial",
      "c1": "steps",
      "c2": "initial",
      "c3": "review",
      "edition": "default",
      "variables": ["uv-target", "uv-focus"]
    }
  }
}
```

### Path Resolution

| Method | Example                                                        | Resolves To                                 |
| ------ | -------------------------------------------------------------- | ------------------------------------------- |
| `path` | `"path": "system.md"`                                          | `prompts/system.md`                         |
| C3L    | `c1: "steps", c2: "initial", c3: "review", edition: "default"` | `prompts/steps/initial/review/f_default.md` |

## Use Cases

### 1. Issue Resolution Agent

```bash
deno run -A agents/scripts/run-agent.ts --agent iterator --issue 42
```

### 2. Code Review Agent

```bash
deno run -A agents/scripts/run-agent.ts --agent reviewer --target src/
```

## Programmatic API

```typescript
import { runIterator } from "jsr:@aidevtool/climpt/agents";

const result = await runIterator({
  issue: 123,
  cwd: Deno.cwd(),
});

console.log(`Success: ${result.success}`);
console.log(`Iterations: ${result.totalIterations}`);
console.log(`Completion: ${result.completionReason}`);

// SDK metrics (available when SDK returns them)
if (result.totalCostUsd !== undefined) {
  console.log(`Cost: $${result.totalCostUsd.toFixed(4)} USD`);
}
if (result.numTurns !== undefined) {
  console.log(`SDK turns: ${result.numTurns}`);
}
if (result.durationMs !== undefined) {
  console.log(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
}
```

## Execution Report

Upon completion, the runner outputs a summary including SDK metrics:

```
============================================================
Agent completed: SUCCESS
Total iterations: 3
Reason: All completion conditions met
Total cost: $0.1234 USD
SDK turns: 15
Duration: 45.2s
============================================================
```

These metrics (`totalCostUsd`, `numTurns`, `durationMs`) are also recorded in
JSONL log entries for each iteration.

## Logs

Logs are saved in JSONL format at the configured `logging.directory`:

```
tmp/logs/agents/my-agent/
+-- 2024-01-15T10-30-00-000Z.jsonl
```

## Documentation

Core design docs live under `agents/docs/design/`, while builder/guide docs live
under `agents/docs/builder/`:

Design:

- [design/01_runner.md](./docs/design/01_runner.md) - Agent runner design
- [design/02_prompt_system.md](./docs/design/02_prompt_system.md) - Prompt
  system
- [design/03_structured_outputs.md](./docs/design/03_structured_outputs.md) -
  Structured output handling
- [design/04_philosophy.md](./docs/design/04_philosophy.md) - Design philosophy
- [design/05_core_architecture.md](./docs/design/05_core_architecture.md) -
  Flow/Completion architecture
- [design/06_contracts.md](./docs/design/06_contracts.md) - Contracts & I/O
- [design/07_extension_points.md](./docs/design/07_extension_points.md) -
  Extension points
- [design/08_step_flow_design.md](./docs/design/08_step_flow_design.md) - Flow
  step requirements

Builder/Guides:

- [builder/01_quickstart.md](./docs/builder/01_quickstart.md) - Quickstart
- [builder/02_agent_definition.md](./docs/builder/02_agent_definition.md) -
  Agent definition schema
- [builder/03_builder_guide.md](./docs/builder/03_builder_guide.md) - End-to-end
  builder guide
- [builder/04_config_system.md](./docs/builder/04_config_system.md) - Config
  layering
- [builder/migration_guide.md](./docs/builder/migration_guide.md) - Migration
  guide
- [builder/migration_incompatibilities.md](./docs/builder/migration_incompatibilities.md)
  - Incompatibilities list
- [builder/migration_template.md](./docs/builder/migration_template.md) -
  Migration template

## Troubleshooting

### Sandbox Error

In environments where Claude Code sandbox is enabled, some operations may be
restricted:

```json
{
  "behavior": {
    "disableSandbox": true
  }
}
```

### Module Resolution Error

If npm package resolution fails:

```bash
deno cache --reload mod.ts
```

### GitHub CLI Authentication

Authenticate before using GitHub integration features:

```bash
gh auth login
```

## Related Projects

- [Climpt](https://jsr.io/@aidevtool/climpt) - Prompt management system
- [Claude Code SDK](https://github.com/anthropics/claude-code) - Claude Code API
