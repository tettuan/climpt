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

## Projects with node_modules (npm/pnpm)

If your project uses npm or pnpm alongside Deno tools, add this to your
`deno.json`:

```json
{
  "nodeModulesDir": "auto"
}
```

### Why?

When Deno detects a `node_modules/` directory, it switches to "manual" mode and
tries to resolve npm packages from there. Since `@anthropic-ai/claude-agent-sdk`
isn't in your project's node_modules, Deno fails with:

```
error: Import 'file:///path/to/project' failed.
    0: Is a directory (os error 21)
```

Setting `"nodeModulesDir": "auto"` tells Deno to resolve npm packages
independently from its own cache, ignoring the existing node_modules.

### Common setup

```
your-project/
├── deno.json          ← Add "nodeModulesDir": "auto"
├── node_modules/      ← For React/Vite (npm/pnpm)
├── package.json
└── .agent/climpt/     ← Climpt prompts
```

## Usage

See [SKILL.md](skills/delegate-climpt-agent/SKILL.md) for detailed workflow
instructions.
