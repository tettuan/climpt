---
name: delegate-climpt-agent
description: Use PROACTIVELY when user mentions 'climpt', 'climpt-agent', or requests any language processing task expressible as a command. Climpt invokes prompts via commands; this Skill delegates to sub-agents for execution.
---

# Delegate Climpt Agent

Climpt is a CLI that invokes prompts. Users register language processing tasks
as commands, each command expands into a prompt, and arguments dynamically embed
instructions. This Skill spawns sub-agents to execute matched commands.

## Workflow

### Step 1: Create query text

Analyze the user's request and create a short English query:

- "変更をコミットして" → "commit my changes"
- "コードをリファクタして" → "refactor code"
- "ドキュメントを生成" → "generate documentation"

### Step 2: Execute script

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  ${CLAUDE_PLUGIN_ROOT}/skills/delegate-climpt-agent/scripts/climpt-agent.ts \
  --query="<query text>" \
  [--agent=climpt] \
  [--options=<opt1,opt2,...>]
```

## Command Reference

Commands are defined in `registry.json` and follow C3L naming:
`<agent>-<c1>-<c2>-<c3>`

Example: `climpt-git-group-commit-unstaged-changes`

## When to Use This Skill

- User mentions "climpt" or requests a registered command
- Task involves language processing expressible as command → prompt expansion
- User wants to pass options for dynamic prompt customization

## Error Handling

- **No matching command**: Rephrase query or ask user for clarification
- **Script fails**: Check Deno, Claude Agent SDK, permissions, and registry.json
- **Sub-agent errors**: Verify working directory and instruction prompt
  retrieval
