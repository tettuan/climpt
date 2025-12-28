# Climpt Agent Plugin

A Claude Code Plugin that delegates development tasks to Climpt commands through
AI-assisted workflows.

## Overview

Climpt Agent integrates with Claude Code to provide:

- **Automatic Command Discovery**: Natural language requests are matched to
  Climpt commands
- **Dynamic Sub-agent Generation**: Commands are executed through dynamically
  created sub-agents
- **MCP Integration**: Seamless communication with Climpt's command registry

## Prerequisites

- Deno 2.x (recommended 2.4.4+)
- Claude Code
- Climpt CLI (`jsr:@aidevtool/climpt`)

## Installation

### Step 1: Add Marketplace

```bash
/plugin marketplace add tettuan/climpt
```

### Step 2: Install Plugin

```bash
/plugin install climpt-agent
```

**Note**: If the command fails, use `/plugin` to open the plugin browser, navigate to "Discover" tab, find `climpt-agent`, and install from there.

### Step 3: Restart Claude Code

Restart Claude Code to load the new plugin.

### Alternative: Local Installation

For development or testing:

```bash
# Clone the repository
git clone https://github.com/tettuan/climpt.git

# Add local marketplace (marketplace.json is at repo root)
/plugin marketplace add /path/to/climpt
```

## Usage

The Skill automatically activates when you make requests that match Climpt
commands.

### Git Operations

| Request              | Command                                    |
| -------------------- | ------------------------------------------ |
| "Commit my changes"  | `climpt-git group-commit unstaged-changes` |
| "Decide on a branch" | `climpt-git decide-branch working-branch`  |
| "Select PR branch"   | `climpt-git list-select pr-branch`         |
| "Merge up to parent" | `climpt-git merge-up base-branch`          |
| "Find oldest branch" | `climpt-git find-oldest descendant-branch` |

### Meta Operations

| Request                | Command                          |
| ---------------------- | -------------------------------- |
| "Generate frontmatter" | `climpt-meta build frontmatter`  |
| "Create instruction"   | `climpt-meta create instruction` |

## Architecture

```
# Repository root
/.claude-plugin/
└── marketplace.json          # Marketplace registration

# Plugins directory
climpt-plugins/
├── plugins/
│   └── climpt-agent/
│       ├── .claude-plugin/
│       │   └── plugin.json   # Plugin manifest
│       ├── .mcp.json         # MCP server configuration
│       └── skills/
│           └── delegate-climpt-agent/
│               └── SKILL.md  # Skill definition
└── README.md
```

### Components

#### plugin.json

Plugin manifest defining metadata:

```json
{
  "name": "climpt-agent",
  "version": "1.0.0",
  "description": "Delegate tasks to Climpt Agent for AI-assisted development workflows",
  "author": {
    "name": "tettuan",
    "url": "https://github.com/tettuan"
  }
}
```

#### SKILL.md

Defines when Claude should trigger the Skill. The `description` field is used
for matching user requests.

```yaml
---
name: delegate-climpt-agent
description: Delegates development tasks to Climpt Agent...
---
```

#### .mcp.json

MCP server configuration providing `search`, `describe`, `execute`, and `reload`
tools:

```json
{
  "mcpServers": {
    "climpt": {
      "command": "deno",
      "args": ["run", "--allow-read", "...", "jsr:@aidevtool/climpt/mcp"]
    }
  }
}
```

## C3L Naming Convention

Commands follow the C3L (Command 3-Level) specification:

| Level   | Description           | Examples                          |
| ------- | --------------------- | --------------------------------- |
| `agent` | MCP server identifier | `climpt`, `inspector`             |
| `c1`    | Domain identifier     | `git`, `meta`, `spec`             |
| `c2`    | Action identifier     | `group-commit`, `build`           |
| `c3`    | Target identifier     | `unstaged-changes`, `frontmatter` |

Sub-agent names follow the format: `<agent>-<c1>-<c2>-<c3>`

Examples:

- `climpt-git-group-commit-unstaged-changes`
- `climpt-meta-build-frontmatter`

## Workflow

When a user makes a request:

1. **Search**: `mcp__climpt__search` finds matching commands
2. **Describe**: `mcp__climpt__describe` retrieves command details
3. **Execute**: `mcp__climpt__execute` returns the instruction prompt
4. **Follow**: Claude follows the instruction to complete the task

## Troubleshooting

### Plugin Not Found

Verify marketplace registration:

```bash
/plugin marketplace list
```

### Skill Not Triggering

1. Check if the plugin is installed: `/plugin list`
2. Ensure request matches Skill description
3. Try using explicit keywords like "commit", "branch", "frontmatter"

### MCP Connection Issues

Verify MCP server is running:

```bash
deno run --allow-read --allow-write --allow-net --allow-env jsr:@aidevtool/climpt/mcp
```

## Development

### Creating New Skills

See [skills/README.md](skills/README.md) for Agent SDK documentation and skill
creation guidelines.

### Testing Changes

1. Make changes to SKILL.md or scripts
2. Reload the plugin: `/plugin reload climpt-agent`
3. Test with a matching request

## Related Documentation

- [Climpt Main Documentation](../README.md)
- [Skills & Agent SDK](skills/README.md)
- [C3L Specification](../docs/reference/c3l/)
- [MCP Integration](../docs/reference/mcp/)

## License

MIT
