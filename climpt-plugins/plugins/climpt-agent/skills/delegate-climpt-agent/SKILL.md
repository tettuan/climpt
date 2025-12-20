---
name: delegate-climpt-agent
description: Delegates development tasks to Climpt Agent. Use when user asks to perform git operations, create instructions, manage branches, generate frontmatter, or any development workflow that matches Climpt commands. Climpt provides AI-assisted prompts for git commits, branch management, PR workflows, and meta operations.
---

# Delegate Climpt Agent

Development task delegation through Climpt's command registry.

## Overview

This Skill connects Claude Code to Climpt by spawning independent sub-agents using Claude Agent SDK. When a user's request matches a Climpt command, this Skill creates a short query text that describes the user's intent, then executes the `climpt-agent.ts` script. The script internally handles the multi-stage workflow (search → describe → execute) and runs an isolated sub-agent to complete the task.

## Workflow

### Step 1: Create query text

Analyze the user's request and create a short, descriptive query text in English. The query should capture the essence of what the user wants to do.

Examples:
- "変更をコミットして" → "commit my changes"
- "新しいブランチを作成" → "create new branch"
- "frontmatterを生成" → "generate frontmatter"
- "古いブランチを削除" → "delete old branches"

### Step 2: Execute sub-agent script

Run `climpt-agent.ts` from the plugin's scripts directory with the query to spawn an independent sub-agent:

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  ${CLAUDE_PLUGIN_ROOT}/skills/delegate-climpt-agent/scripts/climpt-agent.ts \
  --query="<query text>" \
  [--agent=climpt] \
  [--options=<opt1,opt2,...>]
```

Parameters:
- `--query`: Natural language description of what to do (required)
- `--agent`: Agent name (default: "climpt")
- `--options`: Comma-separated list of additional options (optional)

The script automatically:
1. Loads the command registry
2. Searches for matching commands using cosine similarity
3. Selects the best match and gets command details
4. Executes Climpt CLI to get the instruction prompt
5. Runs a sub-agent with the prompt to complete the task

### Example: Commit Changes

User request: "変更をコミットして"

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  ${CLAUDE_PLUGIN_ROOT}/skills/delegate-climpt-agent/scripts/climpt-agent.ts \
  --query="commit my changes"
```

This spawns sub-agent `climpt-git-group-commit-unstaged-changes` which:
- Analyzes unstaged changes
- Groups files by semantic proximity
- Executes commits with appropriate messages

### Example: Generate Frontmatter

User request: "frontmatterを生成して"

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  ${CLAUDE_PLUGIN_ROOT}/skills/delegate-climpt-agent/scripts/climpt-agent.ts \
  --query="generate frontmatter"
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

### Available Commands

#### Git Operations (c1: git)

| c2 | c3 | Description | Query Examples |
|----|-----|-------------|----------------|
| `group-commit` | `unstaged-changes` | Group file changes by semantic proximity and commit | "commit changes", "git commit" |
| `decide-branch` | `working-branch` | Decide whether to create a new branch based on task content | "decide branch", "need new branch" |
| `find-oldest` | `descendant-branch` | Find and merge the oldest related branch | "find oldest branch", "merge oldest" |
| `list-select` | `pr-branch` | List branches with PRs and select next target | "list pr branches", "select pr" |
| `merge-up` | `base-branch` | Merge derived branches up to parent branch | "merge up", "merge to parent" |

#### Meta Operations (c1: meta)

| c2 | c3 | Description | Query Examples |
|----|-----|-------------|----------------|
| `build` | `frontmatter` | Generate C3L v0.5 compliant frontmatter | "generate frontmatter", "build frontmatter" |
| `create` | `instruction` | Create new instruction file | "create instruction", "new instruction" |

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
The script will exit with an error if no matching command is found. In this case:
1. Inform the user that no matching Climpt command was found
2. Suggest alternative approaches or ask for clarification
3. Try rephrasing the query with different keywords

### Script execution fails
1. Check that Deno is installed and accessible
2. Verify Claude Agent SDK is available (`npm:@anthropic-ai/claude-agent-sdk`)
3. Ensure all required permissions are granted (--allow-read, --allow-write, etc.)
4. Check that registry.json exists at `.agent/climpt/registry.json`

### Sub-agent errors
The sub-agent runs independently and reports its own errors. Check:
1. Working directory is correct
2. Required tools are available in `allowedTools`
3. The instruction prompt was successfully retrieved
