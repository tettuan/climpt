# Climpt Agent Scaffolder

Generate new Climpt agent structures with templates and configuration files.

## Installation

```bash
# Add marketplace (if not already added)
/plugin marketplace add tettuan/climpt

# Install plugin
/plugin install climpt-agent-scaffolder
```

## Usage

### Via Claude Code

Trigger the skill with natural language:

- "agent を作りたい"
- "create agent"
- "scaffold agent"
- "新しい agent を作成"

The skill will ask for:

1. **Agent name** (required): kebab-case (e.g., `my-agent`, `code-reviewer`)
2. **Description**: Agent purpose
3. **completionType**: Completion condition type

### Via CLI

```bash
deno run -A ${CLAUDE_PLUGIN_ROOT}/skills/agent-scaffolder/scripts/scaffold.ts \
  --name my-agent \
  --description "My agent description" \
  --completion-type externalState
```

Options:

| Option              | Short | Description                               |
| ------------------- | ----- | ----------------------------------------- |
| `--name`            | `-n`  | Agent name (required, kebab-case)         |
| `--description`     | `-d`  | Agent description                         |
| `--completion-type` | `-c`  | Completion type (default: externalState)  |
| `--display-name`    |       | Display name (default: derived from name) |
| `--dry-run`         |       | Preview without creating files            |

### Completion Types

| Type              | Use Case                 | Config                |
| ----------------- | ------------------------ | --------------------- |
| `externalState`   | Monitor Issue/PR state   | `maxIterations`       |
| `iterationBudget` | Fixed iteration count    | `maxIterations`       |
| `keywordSignal`   | Keyword-based completion | `completionKeyword`   |
| `stepMachine`     | Step graph-based flow    | `steps_registry.json` |

> **Note**: The scaffolder supports these 4 completion types. For advanced types
> (`checkBudget`, `structuredSignal`, `composite`, `custom`), scaffold with a
> base type and manually edit `agent.json`. See
> [Agent Definition](https://github.com/tettuan/climpt/blob/main/agents/docs/builder/02_agent_definition.md#completiontype)
> for details.

## Generated Structure

```
.agent/{agent-name}/
├── agent.json              # Agent definition
├── steps_registry.json     # Step mappings
├── schemas/
│   └── step_outputs.schema.json
└── prompts/
    ├── system.md
    └── steps/
        ├── initial/default/f_default.md       # Work step: initialization
        ├── continuation/default/f_default.md  # Work step: continuation
        ├── verification/default/f_default.md  # Verification step: validates work output
        └── closure/default/f_default.md       # Closure step: completion
```

## Next Steps After Scaffolding

1. Edit `prompts/system.md` to define the agent's role
2. Customize prompts in `prompts/steps/`
3. Add parameters to `agent.json` if needed
4. Validate configuration: `deno task agent --agent {name} --validate`
5. Verify with:
   `deno run -A agents/scripts/run-agent.ts --agent {name} --dry-run`

## Documentation

- [Builder Guide](https://github.com/tettuan/climpt/tree/main/agents/docs/builder) -
  Detailed agent configuration guide
- [Quickstart](https://github.com/tettuan/climpt/blob/main/agents/docs/builder/01_quickstart.md)
- [Agent Definition](https://github.com/tettuan/climpt/blob/main/agents/docs/builder/02_agent_definition.md)
- [YAML Reference](https://github.com/tettuan/climpt/tree/main/agents/docs/builder/reference) -
  All fields with comments

## Uninstall

When you no longer need the scaffolder:

```bash
/plugin uninstall climpt-agent-scaffolder
```

## License

MIT
