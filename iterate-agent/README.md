# Iterate Agent

Autonomous development agent that executes cycles through iterations using
Claude Agent SDK and Climpt Skills.

## Overview

Iterate Agent is a CLI-based autonomous agent that continuously executes
development tasks by:

1. Fetching requirements from GitHub Issues or Projects
2. Using **delegate-climpt-agent** Skill to execute tasks
3. Evaluating progress against completion criteria
4. Asking Climpt for the next logical task
5. Repeating until completion criteria are met

## Features

- **Autonomous Execution**: Runs without human intervention
- **GitHub Integration**: Works with Issues and Projects via `gh` CLI
- **Role-Based Prompts**: 5 specialized roles (developer, QA, architect, DevOps,
  tech writer)
- **Climpt Skills Integration**: Leverages existing Climpt infrastructure
- **Detailed Logging**: JSONL format with automatic rotation (max 100 files)
- **Flexible Completion**: Complete by Issue close, Project done, or iteration
  count

## Prerequisites

1. **Deno** (v1.40 or later)
2. **GitHub CLI (`gh`)** - [Installation guide](https://cli.github.com/manual/)
3. **GITHUB_TOKEN** environment variable with `repo` and `project` scopes
4. **Claude API Key** - Set as `ANTHROPIC_API_KEY` environment variable

## Quick Start

### 1. Setup Environment

```bash
# Set GitHub token
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxx"

# Set Claude API key
export ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxxxxxxxxxxx"
```

### 2. Run the Agent

```bash
# Work on Issue #123 until closed (uses default agent "climpt")
deno task iterate-agent --issue 123

# Work on Project #5 until all items complete
deno task iterate-agent --project 5

# Run with climpt agent for 10 iterations
deno task iterate-agent --name climpt --iterate-max 10
```

## Usage

### Command Syntax

```bash
deno task iterate-agent [OPTIONS]
```

### Options

| Option          | Alias | Type   | Default  | Description                                                                      |
| --------------- | ----- | ------ | -------- | -------------------------------------------------------------------------------- |
| `--issue`       | `-i`  | number | -        | GitHub Issue number. Agent works until issue is closed.                          |
| `--project`     | `-p`  | number | -        | GitHub Project number. Agent works until all items are done.                     |
| `--iterate-max` | `-m`  | number | Infinity | Maximum number of Skill invocations.                                             |
| `--name`        | `-n`  | string | `climpt` | MCP agent name (must be defined in `.agent/climpt/config/registry_config.json`). |
| `--help`        | `-h`  | -      | -        | Display help message.                                                            |

### Examples

```bash
# Example 1: Issue-based development
deno task iterate-agent --issue 123

# Example 2: Project-based development
deno task iterate-agent --project 5

# Example 3: Run with iteration limit
deno task iterate-agent --name climpt --iterate-max 10

# Example 4: Work on Issue #456
deno task iterate-agent --issue 456 --name climpt

# Example 5: Unlimited iterations
deno task iterate-agent --name climpt
```

## Agents

Iterate Agent uses agents defined in
`.agent/climpt/config/registry_config.json`:

| Agent    | Description               | Tools                                      | Permission Mode |
| -------- | ------------------------- | ------------------------------------------ | --------------- |
| `climpt` | General development tasks | Skill, Read, Write, Edit, Bash, Glob, Grep | `acceptEdits`   |

### Customizing Agent Configuration

Agent configuration is in `iterate-agent/config.json`:

- System prompt template: `iterate-agent/prompts/default.md`
- Allowed tools: Configure which tools the agent can use
- Permission mode: Control how the agent handles operations

You can add more agents by:

1. Adding the agent to `.agent/climpt/config/registry_config.json` with its
   registry path
2. Adding agent configuration to `iterate-agent/config.json`
3. Creating a system prompt template in `iterate-agent/prompts/`

## Configuration

Main configuration is in `iterate-agent/config.json`:

```json
{
  "version": "1.0.0",
  "agents": {
    "climpt": {
      "systemPromptTemplate": "iterate-agent/prompts/default.md",
      "allowedTools": [
        "Skill",
        "Read",
        "Write",
        "Edit",
        "Bash",
        "Glob",
        "Grep"
      ],
      "permissionMode": "acceptEdits"
    }
  },
  "github": {
    "tokenEnvVar": "GITHUB_TOKEN",
    "apiVersion": "2022-11-28"
  },
  "logging": {
    "directory": "tmp/logs/agents",
    "maxFiles": 100,
    "format": "jsonl"
  }
}
```

## Logging

Logs are saved in JSONL format:

```
tmp/logs/agents/{role}/session-{timestamp}.jsonl
```

Example:

```
tmp/logs/agents/product-developer/session-2025-12-20T10-00-00-000Z.jsonl
```

### Log Levels

- `info`: General execution flow
- `debug`: Detailed execution info
- `assistant`: Main Claude's messages
- `user`: Messages sent to Claude
- `system`: SDK system messages
- `result`: Task completion results
- `error`: Errors and exceptions

### Log Rotation

- Maximum 100 files per role
- Oldest files are automatically deleted when limit is reached

## How It Works

### Iteration Flow

**Note**: 1 iteration = 1 complete main Claude session from start to finish.
Multiple Skill invocations can occur within a single iteration.

1. **Initialize**: Load config, create logger, build system prompt
2. **Fetch Requirements**: Get Issue/Project details from GitHub (initial setup
   only)
3. **Iteration Loop**: For each iteration:
   - Start new Claude Agent session with current prompt
   - Main Claude analyzes requirements and invokes **delegate-climpt-agent**
     Skill (potentially multiple times)
   - Sub-agents execute tasks and return summaries
   - Session completes naturally
   - Increment iteration count
   - Check completion criteria (Issue closed, Project done, or max iterations)
   - If incomplete, prepare continuation prompt for next iteration
   - Repeat
4. **Cleanup**: Log summary, close logger

### Completion Criteria

| Type    | Criteria                    | Check Method                                  |
| ------- | --------------------------- | --------------------------------------------- |
| Issue   | Issue is closed             | `gh issue view {number} --json state`         |
| Project | All items are done/closed   | `gh project view {number} --format json`      |
| Iterate | Iteration count reaches max | Counter increment after each complete session |

## Troubleshooting

### Error: "gh command not found"

Install GitHub CLI:

```bash
# macOS
brew install gh

# Linux
# See https://cli.github.com/manual/installation
```

### Error: "GITHUB_TOKEN not found"

Set the environment variable:

```bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxx"
```

### Error: "Configuration file not found"

Run from the project root directory where `iterate-agent/config.json` exists.

### Error: "System prompt template not found"

Ensure prompt file exists: `iterate-agent/prompts/default.md`

## File Structure

```
iterate-agent/
├── config.json                    # Main configuration
├── prompts/
│   └── default.md                 # System prompt template
├── scripts/
│   ├── agent.ts                   # Main entry point
│   ├── cli.ts                     # CLI argument parsing
│   ├── config.ts                  # Configuration loader
│   ├── github.ts                  # GitHub integration
│   ├── logger.ts                  # JSONL logger
│   ├── prompts.ts                 # System prompt builder
│   └── types.ts                   # TypeScript types
└── README.md                      # This file

tmp/logs/agents/
├── climpt/
│   └── session-2025-12-20T10-00-00-000Z.jsonl
└── ...
```

## Related Documentation

- [Design Specification](../docs/internal/iterate-agent-design.md)
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Climpt Skills](../docs/reference/skills/)
- [GitHub CLI Documentation](https://cli.github.com/manual/)

## License

Same as parent project (MIT).
