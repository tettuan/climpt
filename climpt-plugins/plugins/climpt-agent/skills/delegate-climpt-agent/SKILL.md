---
name: delegate-climpt-agent
description: Use when user mentions 'climpt' or 'climpt-agent', or gives project-specific instructions where general knowledge is insufficient. Climpt provides pre-configured prompts tailored to the project's workflow.
---

# Delegate Climpt Agent

Development task delegation through Climpt's command registry.

## Overview

This Skill connects Claude Code to Climpt by spawning independent sub-agents
using Claude Agent SDK. When a user's request matches a Climpt command, this
Skill creates two text components:

1. **query**: Short search query to find the matching command
2. **intent**: Detailed description of what to execute (for option resolution)

## Workflow

### Step 1: Create query and intent

Analyze the user's request and create:

**query**: Short English phrase for command search
**intent**: Detailed description of execution intent

Examples:

| User Request | query | intent |
|-------------|-------|--------|
| "climpt-agentのoptions-prompt.tsをテストして" | "run specific test" | "Test options-prompt.ts in climpt-agent scripts" |
| "変更をコミットして、semantic groupingで" | "commit changes" | "Commit staged changes with semantic grouping by file type" |
| "frontmatterを生成して、docs/配下に" | "generate frontmatter" | "Generate frontmatter for markdown files in docs/ directory" |

### Step 2: Execute sub-agent script

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  ${CLAUDE_PLUGIN_ROOT}/skills/delegate-climpt-agent/scripts/climpt-agent.ts \
  --query="<search query>" \
  --intent="<detailed intent>" \
  [--agent=climpt] \
  [--options=<opt1,opt2,...>]
```

Parameters:
- `--query`: Short search query to find matching command (required)
- `--intent`: Detailed intent for option resolution (optional, defaults to query)
- `--agent`: Agent name (default: "climpt")
- `--options`: Comma-separated list of additional options (optional)

## When to Use This Skill

Use when the user gives project-specific instructions and it's unclear from general knowledge what should be done. Climpt provides pre-configured prompts tailored to the project's workflow.

## Error Handling

### Search returns no results
1. Inform the user that no matching Climpt command was found
2. Suggest alternative approaches or ask for clarification
3. Try rephrasing the query with different keywords

### Script execution fails
1. Check that Deno is installed and accessible
2. Verify Claude Agent SDK is available
3. Ensure all required permissions are granted
4. Check that registry.json exists

### Sub-agent errors
The sub-agent runs independently and reports its own errors. Check:
1. Working directory is correct
2. Required tools are available
3. The instruction prompt was successfully retrieved
