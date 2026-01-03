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

1. **Deno 2.x** (latest version required)
2. **GitHub CLI (`gh`)** - [Installation guide](https://cli.github.com/manual/)

## Quick Start

```bash
# Work on Issue #123 until closed (uses default agent "climpt")
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123

# Work on Project #5 until all items complete
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5

# Run with climpt agent for 10 iterations
deno run -A jsr:@aidevtool/climpt/agents/iterator --name climpt --iterate-max 10
```

## Usage

### Command Syntax

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator [OPTIONS]
```

### Options

| Option          | Alias | Type    | Default  | Description                                                                      |
| --------------- | ----- | ------- | -------- | -------------------------------------------------------------------------------- |
| `--init`        | -     | boolean | -        | Initialize configuration files in current directory.                             |
| `--issue`       | `-i`  | number  | -        | GitHub Issue number. Agent works until issue is closed.                          |
| `--project`     | `-p`  | number  | -        | GitHub Project number. Agent works until all items are done.                     |
| `--iterate-max` | `-m`  | number  | Infinity | Maximum number of Skill invocations.                                             |
| `--name`        | `-n`  | string  | `climpt` | MCP agent name (must be defined in `.agent/climpt/config/registry_config.json`). |
| `--resume`      | `-r`  | boolean | false    | Resume previous SDK session between iterations.                                  |
| `--help`        | `-h`  | -       | -        | Display help message.                                                            |

### Examples

```bash
# First time setup (required)
deno run -A jsr:@aidevtool/climpt/agents/iterator --init

# Issue-based development
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123

# Project-based development
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5

# Run with iteration limit
deno run -A jsr:@aidevtool/climpt/agents/iterator --name climpt --iterate-max 10

# Resume previous session between iterations
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123 --resume

# Unlimited iterations
deno run -A jsr:@aidevtool/climpt/agents/iterator --name climpt
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

### Error: "Configuration file not found"

Run from the project root directory where `iterate-agent/config.json` exists.

### Error: "System prompt template not found"

Ensure prompt file exists: `iterate-agent/prompts/default.md`

## File Structure

```
iterate-agent/
├── config.json                    # Main configuration
├── prompts/
│   └── default.md                 # System prompt template (fallback)
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

### C3L Prompt Templates

System prompts for project mode phases are loaded via C3L (Climpt 3-word Language):

```
.agent/iterator/prompts/dev/
├── start/
│   └── project/
│       ├── f_default.md           # Preparation phase
│       ├── f_processing.md        # Processing phase (with recommended_skills)
│       └── f_again.md             # Re-execution phase
└── review/
    └── project/
        └── f_default.md           # Review phase
```

| Phase | Template | UV Variables |
|-------|----------|--------------|
| preparation | `f_default.md` | agent_name, completion_criteria, target_label |
| processing | `f_processing.md` | + recommended_skills (from preparation) |
| review | `review/project/f_default.md` | agent_name, target_label |
| again | `f_again.md` | agent_name, completion_criteria, target_label |

The `recommended_skills` variable contains skills identified during preparation phase.
If no skills are specified, the value is "指定なし" (none specified).

## Related Documentation

- [Design Specification](../docs/internal/iterate-agent-design.md)
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Climpt Skills](../docs/reference/skills/)
- [GitHub CLI Documentation](https://cli.github.com/manual/)

## License

Same as parent project (MIT).
