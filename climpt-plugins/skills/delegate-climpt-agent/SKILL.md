---
name: delegate-climpt-agent
description: Delegates development tasks to Climpt Agent. Use when user asks to perform git operations, create instructions, manage branches, generate frontmatter, or any development workflow that matches Climpt commands. Climpt provides AI-assisted prompts for git commits, branch management, PR workflows, and meta operations.
---

# Delegate Climpt Agent

Development task delegation through Climpt's command registry.

## Overview

This Skill connects Claude Code to Climpt by spawning independent sub-agents using Claude Agent SDK. When a user's request matches a Climpt command, this Skill searches the command registry to identify the appropriate command, then executes the `climpt-agent.ts` script to create an isolated sub-agent that handles the task.

## Workflow

### Step 1: Search for matching commands

Use `mcp__climpt__search` to find commands that match the user's intent:

```
mcp__climpt__search({
  "query": "<user's intent>",
  "agent": "climpt"
})
```

The search returns matching commands with similarity scores. Select the best match based on the score and description.

### Step 2: Execute sub-agent script

Run `scripts/climpt-agent.ts` with C3L parameters to spawn an independent sub-agent:

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  scripts/climpt-agent.ts \
  --agent=climpt \
  --c1=<domain> \
  --c2=<action> \
  --c3=<target> \
  [--options=<opt1,opt2,...>]
```

The script:
1. Calls Climpt CLI to retrieve the instruction prompt
2. Creates a sub-agent using Claude Agent SDK
3. Runs the sub-agent with the prompt to complete the task

### Example: Commit Changes

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  scripts/climpt-agent.ts \
  --agent=climpt --c1=git --c2=group-commit --c3=unstaged-changes
```

This spawns sub-agent `climpt-git-group-commit-unstaged-changes` which:
- Analyzes unstaged changes
- Groups files by semantic proximity
- Executes commits with appropriate messages

### Optional: Get command details

Use `mcp__climpt__describe` to preview command options before execution:

```
mcp__climpt__describe({
  "agent": "climpt",
  "c1": "<domain>",
  "c2": "<action>",
  "c3": "<target>"
})
```

## Command Reference

Commands follow the C3L naming convention:

| Level | Description | Examples |
|-------|-------------|----------|
| `agent` | MCP server identifier | `climpt`, `inspector` |
| `c1` | Domain identifier | `git`, `meta`, `spec` |
| `c2` | Action identifier | `group-commit`, `build`, `create` |
| `c3` | Target identifier | `unstaged-changes`, `frontmatter`, `instruction` |

Sub-agent name format: `<agent>-<c1>-<c2>-<c3>`

### Example Commands

#### Git Operations (c1: git)

| c2 | c3 | Description |
|----|-----|-------------|
| `group-commit` | `unstaged-changes` | Group file changes by semantic proximity and commit |
| `decide-branch` | `working-branch` | Decide whether to create a new branch based on task content |
| `find-oldest` | `descendant-branch` | Find and merge the oldest related branch |
| `list-select` | `pr-branch` | List branches with PRs and select next target |
| `merge-up` | `base-branch` | Merge derived branches up to parent branch |

#### Meta Operations (c1: meta)

| c2 | c3 | Description |
|----|-----|-------------|
| `build` | `frontmatter` | Generate C3L v0.5 compliant frontmatter |
| `create` | `instruction` | Create new instruction file |

## Dynamic Sub-agent

When executing commands, a sub-agent is dynamically created with the name format:

```
<agent>-<c1>-<c2>-<c3>
```

Examples:
- `climpt-git-group-commit-unstaged-changes` (agent=climpt, c1=git)
- `climpt-meta-build-frontmatter` (agent=climpt, c1=meta)

## When to Use This Skill

Use this Skill when the user:
- Wants to commit changes in a structured way
- Needs help with branch management decisions
- Wants to create or update instruction files
- Asks about git workflow best practices
- Requests help with PR workflows
- Needs to generate frontmatter for documentation

## Error Handling

### Search returns no results
1. Inform the user that no matching Climpt command was found
2. Suggest alternative approaches or ask for clarification
3. Consider using `mcp__climpt__reload` if the registry might be outdated

### Script execution fails
1. Check that Deno is installed and accessible
2. Verify Claude Agent SDK is available (`npm:@anthropic-ai/claude-agent-sdk`)
3. Ensure all required permissions are granted (--allow-read, --allow-write, etc.)
4. Check script path is relative to the skill directory

### Sub-agent errors
The sub-agent runs independently and reports its own errors. Check:
1. Working directory is correct
2. Required tools are available in `allowedTools`
3. Climpt CLI can access the command registry
