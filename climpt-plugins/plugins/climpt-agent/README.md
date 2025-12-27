# Climpt Agent Plugin

Delegates development tasks to sub-agents using Claude Agent SDK.

## Features

- Spawns independent sub-agents for complex tasks
- Automatic command matching via cosine similarity search
- Supports git operations, meta operations, and more

## Sandbox Requirement

**This plugin requires `dangerouslyDisableSandbox: true` when running from
Claude Code.**

### Why?

The Claude Agent SDK spawns a child `claude` process that needs write access to:

| Path                         | Purpose           |
| ---------------------------- | ----------------- |
| `~/.claude/projects/`        | Session logs      |
| `~/.claude/todos/`           | Task state        |
| `~/.claude/shell-snapshots/` | Shell environment |

Claude Code's sandbox blocks these writes, causing the SDK stream to fail with
JSON parse errors like:

```
Unterminated string in JSON at position 73536
```

### Alternatives

If you prefer not to disable the sandbox:

1. **Run from terminal directly** - Execute the deno command outside Claude Code
2. **Use MCP tools** - Use Climpt MCP tools directly instead of delegating to
   sub-agent

## Usage

See [SKILL.md](skills/delegate-climpt-agent/SKILL.md) for detailed workflow
instructions.
