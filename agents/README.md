# Climpt Agents

Autonomous agent execution framework using the Claude Code SDK. Integrates with
the Climpt prompt management system to enable iterative task execution.

## Features

- **Iterative Execution**: Automatically continues iterations until completion
  conditions are met
- **Multiple Completion Strategies**: Choose from
  Issue/Project/Iterate/Manual/Custom/StepFlow
- **C3L Prompt Management**: Structured prompt management through Climpt
  integration
- **Action System**: Automatically detect and execute actions (GitHub Issue
  creation, file output, etc.) from agent output
- **Flexible Configuration**: Type-safe agent definitions via JSON Schema

## Quick Start

### Running the Iterator Agent

```bash
# Run with issue completion
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123

# Or with deno task
deno task agent:iterator --issue 123
```

### Running the Reviewer Agent

```bash
deno run -A jsr:@aidevtool/climpt/agents/reviewer --target src/
```

## Directory Structure

```
agents/
+-- mod.ts                    # Public API exports
+-- CLAUDE.md                 # Agent development guidelines
+-- iterator/                 # Iterator agent
|   +-- mod.ts
|   +-- README.md
|   +-- config.json
|   +-- scripts/
+-- reviewer/                 # Reviewer agent
|   +-- mod.ts
|   +-- README.md
|   +-- scripts/
|   +-- prompts/
+-- common/                   # Shared utilities
|   +-- mod.ts
|   +-- types.ts
|   +-- logger.ts
|   +-- step-registry.ts
|   +-- prompt-resolver.ts
|   +-- worktree.ts
|   +-- coordination.ts
+-- schemas/                  # JSON Schemas
|   +-- agent.schema.json
|   +-- steps_registry.schema.json
+-- docs/                     # Documentation
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

  "logging": {
    "directory": "tmp/logs/agents/code-reviewer",
    "format": "jsonl"
  }
}
```

## Completion Types

### 1. manual - Keyword Completion

Completes when agent outputs a specific keyword.

```json
{
  "completionType": "manual",
  "completionConfig": {
    "completionKeyword": "TASK_COMPLETE"
  }
}
```

### 2. iterate - Fixed Iteration

Completes after specified number of iterations.

```json
{
  "completionType": "iterate",
  "completionConfig": {
    "maxIterations": 5
  }
}
```

### 3. issue - GitHub Issue Completion

Completes when related GitHub Issue is closed.

```json
{
  "completionType": "issue",
  "completionConfig": {}
}
```

### 4. project - Project Task Completion

Completes when GitHub Project tasks are all done.

```json
{
  "completionType": "project",
  "completionConfig": {}
}
```

### 5. stepFlow - Step-Based Completion

Completes through state machine-like step transitions.

```json
{
  "completionType": "stepFlow",
  "completionConfig": {}
}
```

### 6. custom - Custom Handler

Implement custom completion logic.

```json
{
  "completionType": "custom",
  "completionConfig": {
    "handlerPath": "./handlers/my-completion.ts"
  }
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

## Action System

Detects specific formats in agent output and automatically executes actions.

### Action Output Format

When an agent outputs the following format, actions are executed:

````markdown
```action
{
  "type": "github-issue",
  "content": "Bug description...",
  "metadata": {
    "title": "Fix authentication error",
    "labels": ["bug", "high-priority"]
  }
}
```
````

### Available Action Types

- `github-issue` - Create GitHub Issue
- `github-comment` - Comment on Issue
- `file` - File output
- `log` - Log output

## Use Cases

### 1. Issue Resolution Agent

```bash
deno task agent:iterator --issue 42
```

### 2. Code Review Agent

```bash
deno task agent:reviewer --target src/ --focus security
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
```

## Logs

Logs are saved in JSONL format at the configured `logging.directory`:

```
tmp/logs/agents/my-agent/
+-- 2024-01-15T10-30-00-000Z.jsonl
```

## Documentation

Detailed documentation is available in the `docs/` directory:

- [01_architecture.md](./docs/01_architecture.md) - Architecture overview
- [02_agent_definition.md](./docs/02_agent_definition.md) - Agent definition
  schema
- [03_runner.md](./docs/03_runner.md) - Agent runner design
- [04_completion_handlers.md](./docs/04_completion_handlers.md) - Completion
  handlers
- [05_prompt_system.md](./docs/05_prompt_system.md) - Prompt system
- [06_action_system.md](./docs/06_action_system.md) - Action system
- [07_config_system.md](./docs/07_config_system.md) - Configuration system
- [08_implementation_guide.md](./docs/08_implementation_guide.md) -
  Implementation guide
- [step_flow_design.md](./docs/step_flow_design.md) - Step flow design
- [migration_guide.md](./docs/migration_guide.md) - Migration guide

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
