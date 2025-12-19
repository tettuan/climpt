---
name: delegate-climpt-agent
description: Delegates development tasks to Climpt Agent. Use when user asks to perform git operations, create instructions, manage branches, generate frontmatter, or any development workflow that matches Climpt commands. Climpt provides AI-assisted prompts for git commits, branch management, PR workflows, and meta operations.
---

# Delegate Climpt Agent

Development task delegation through Climpt's command registry.

## Overview

This Skill connects Claude Code to Climpt, an AI-assisted CLI tool that provides structured prompts for development workflows. When a user's request matches a Climpt command, this Skill searches the command registry, retrieves the appropriate instruction prompt, and executes it.

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

### Step 2: Get command details

Use `mcp__climpt__describe` with the matched c1, c2, c3 from search results:

```
mcp__climpt__describe({
  "agent": "climpt",
  "c1": "<command-group>",
  "c2": "<action>",
  "c3": "<target>"
})
```

This provides detailed information about the command including:
- Full description
- Usage instructions
- Available options (edition, adaptation, file, stdin, destination)

### Step 3: Execute command

Use `mcp__climpt__execute` to get the instruction prompt:

```
mcp__climpt__execute({
  "agent": "climpt",
  "c1": "<command-group>",
  "c2": "<action>",
  "c3": "<target>",
  "options": {}
})
```

The execute tool returns the instruction document (prompt). Use this prompt to guide the task execution.

> **Note**: `agent` is always `"climpt"`. Command groups like `climpt-git` are specified via `c1`.

## Command Reference

Commands follow the C3L naming convention:

| Level | Description | Examples |
|-------|-------------|----------|
| `c1` | Domain identifier (command group) | `climpt-git`, `climpt-meta` |
| `c2` | Action identifier | `group-commit`, `build`, `create` |
| `c3` | Target identifier | `unstaged-changes`, `frontmatter`, `instruction` |

### Example Commands

#### Git Operations (climpt-git)

| c2 | c3 | Description |
|----|-----|-------------|
| `group-commit` | `unstaged-changes` | Group file changes by semantic proximity and commit |
| `decide-branch` | `working-branch` | Decide whether to create a new branch based on task content |
| `find-oldest` | `descendant-branch` | Find and merge the oldest related branch |
| `list-select` | `pr-branch` | List branches with PRs and select next target |
| `merge-up` | `base-branch` | Merge derived branches up to parent branch |

#### Meta Operations (climpt-meta)

| c2 | c3 | Description |
|----|-----|-------------|
| `build` | `frontmatter` | Generate C3L v0.5 compliant frontmatter |
| `create` | `instruction` | Create new instruction file |

## Dynamic Sub-agent

When executing commands, a sub-agent is dynamically created with the name format:

```
<c1>-<c2>-<c3>
```

Examples:
- `climpt-git-group-commit-unstaged-changes`
- `climpt-meta-build-frontmatter`

## When to Use This Skill

Use this Skill when the user:
- Wants to commit changes in a structured way
- Needs help with branch management decisions
- Wants to create or update instruction files
- Asks about git workflow best practices
- Requests help with PR workflows
- Needs to generate frontmatter for documentation

## Error Handling

If a search returns no results:
1. Inform the user that no matching Climpt command was found
2. Suggest alternative approaches or ask for clarification
3. Consider using `mcp__climpt__reload` if the registry might be outdated
