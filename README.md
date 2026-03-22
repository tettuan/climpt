# Climpt

[English](README.md) | [日本語](README.ja.md)

CLI Prompt Management Tool. Agents: Iterator, Reviewer also included. Besides
CLI, it is available through MCP and plugins. The plugin skills run on a
dedicated climpt-agent (via the Claude Agent SDK).

## Quick Start

```bash
# Initialize configuration
deno run -A jsr:@aidevtool/climpt init

# Run your first command
echo "Fix login bug" | deno run -A jsr:@aidevtool/climpt git decide-branch working-branch
```

📖 [Full Documentation](https://tettuan.github.io/climpt/)

## What is Climpt?

Climpt organizes pre-configured prompts and invokes them with a single command.
Three ways to use:

| Method     | Description                                               |
| ---------- | --------------------------------------------------------- |
| **CLI**    | Direct command-line execution                             |
| **MCP**    | Integration with Claude/Cursor via Model Context Protocol |
| **Plugin** | Claude Code plugin with climpt-agent                      |

### Learn More

Explore interactively:
[Climpt NotebookLM](https://notebooklm.google.com/notebook/6a186ac9-70b2-4734-ad46-359e26043507)

## CLI Usage

### Command Syntax

```bash
deno run -A jsr:@aidevtool/climpt <profile> <directive> <layer> [options]
```

**Example:**

```bash
# Break down issue into tasks
deno run -A jsr:@aidevtool/climpt breakdown to task --from=issue.md --adaptation=detailed

# Generate from stdin
echo "error log" | deno run -A jsr:@aidevtool/climpt diagnose trace stack -o=./output/
```

### Key Options

| Option          | Short | Description      |
| --------------- | ----- | ---------------- |
| `--from`        | `-f`  | Input file       |
| `--destination` | `-o`  | Output path      |
| `--edition`     | `-e`  | Prompt edition   |
| `--adaptation`  | `-a`  | Prompt variation |
| `--uv-*`        | -     | Custom variables |

📖 [Full CLI Reference](https://tettuan.github.io/climpt/)

## Prompt Templates

Prompts are organized in `.agent/climpt/prompts/`:

```
.agent/climpt/prompts/<profile>/<directive>/<layer>/f_<edition>_<adaptation>.md
```

**Template Variables:**

- `{input_text}` - Text from stdin
- `{input_text_file}` - Input file path
- `{destination_path}` - Output path
- `{uv-*}` - Custom variables

📖 [Prompt Guide](https://tettuan.github.io/climpt/)

## MCP Server

Integrate with Claude or Cursor via MCP:

```json
{
  "mcpServers": {
    "climpt": {
      "command": "deno",
      "args": ["run", "-A", "jsr:@aidevtool/climpt/mcp"]
    }
  }
}
```

📖 [MCP Configuration Guide](https://tettuan.github.io/climpt/)

## Claude Code Plugin

```bash
# Add marketplace
/plugin marketplace add tettuan/climpt

# Install
/plugin install climpt-agent
```

Features:

- Natural language command execution
- Git workflows (commit, branch, PR)
- Prompt management operations

## Agents

**Prerequisites**: Agents require GitHub CLI (`gh`) installed and authenticated,
plus a Git repository pushed to GitHub.

### Agent Structure

Each agent is defined in `.agent/{agent-name}/` with:

```
.agent/{agent-name}/
├── agent.json          # Agent configuration
├── steps_registry.json # Step definitions for prompts
└── prompts/            # Prompt templates
    └── system.md       # System prompt
```

**agent.json** key properties:

- `name`, `displayName`, `version` - Agent identification
- `runner.verdict.type` - Execution mode (see below)
- `runner.boundaries.allowedTools` - Available tools for the agent
- `runner.flow.prompts.registry` - Path to steps registry
- `runner.logging.directory` - Log output location

**steps_registry.json** defines prompt selection logic for each execution step.

### Creating a New Agent

```bash
deno task agent --init --agent {agent-name}
```

This generates the directory structure with template files.

**Builder Documentation**: For detailed guides on agent configuration and
customization, see [`agents/docs/builder/`](agents/docs/builder/).

### Running Agents

```bash
# List available agents
deno task agent --list

# Run with GitHub Issue
deno task agent --agent {name} --issue {number}

# Run in iterate mode
deno task agent --agent {name} --iterate-max 10
```

### Verdict Types

| Type                | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `poll:state`        | Monitors external resource state (GitHub issue/project, file, API) |
| `count:iteration`   | Runs for specified iterations (`maxIterations`)                    |
| `count:check`       | Runs for specified status checks (`maxChecks`)                     |
| `detect:keyword`    | Exits when agent outputs `verdictKeyword`                          |
| `detect:structured` | Detects structured action block output (`signalType`)              |
| `detect:graph`      | Follows step state machine (`registryPath`, `entryStep`)           |
| `meta:composite`    | Combined conditions with operator (and/or/first)                   |
| `meta:custom`       | Uses custom handler (`handlerPath`)                                |

### Built-in Agents

Agents are run via the runner (`./agents/runner`) with `--agent`:

```bash
# Iterator - Autonomous development
deno run -A jsr:@aidevtool/climpt/agents/runner --agent iterator --issue 123

# Reviewer - Code review
deno run -A jsr:@aidevtool/climpt/agents/runner --agent reviewer --project 1

# Facilitator - Project monitoring
deno run -A jsr:@aidevtool/climpt/agents/runner --agent facilitator --project 1
```

### Agent Documentation

| Document             | Path                                         | Description                                   |
| -------------------- | -------------------------------------------- | --------------------------------------------- |
| Quick Start          | `agents/docs/builder/01_quickstart.md`       | Agent creation guide                          |
| Definition Reference | `agents/docs/builder/02_agent_definition.md` | agent.json fields                             |
| YAML Reference       | `agents/docs/builder/reference/`             | All fields with comments                      |
| Troubleshooting      | `agents/docs/builder/05_troubleshooting.md`  | Common issues and solutions                   |
| Design Docs          | `agents/docs/design/`                        | Architecture and concepts                     |
| JSON Schemas         | `agents/schemas/`                            | agent.schema.json, steps_registry.schema.json |

Use `deno task agent --help` for CLI options. Use
`deno task agent --agent <name> --validate` to validate configuration without
running.

## Orchestrator

The orchestrator coordinates multiple agents through a label-driven state
machine. It is not an agent — it is a separate entry point that dispatches
agents and manages phase transitions via GitHub labels.

```bash
# Process a single issue
deno task workflow --issue 123

# Process issues filtered by label (batch mode)
deno task workflow --label ready --state open

# Dry run
deno task workflow --issue 123 --dry-run --verbose
```

```bash
# JSR entry point
deno run -A jsr:@aidevtool/climpt/agents/orchestrator --issue 123
```

Configure workflows in `.agent/workflow.json`. See
[Workflow Guide](docs/guides/en/15-workflow-guide.md) for details.

### Configuration Example

Minimal `agent.json`:

```json
{
  "name": "my-agent",
  "displayName": "My Agent",
  "version": "1.0.0",
  "description": "Custom agent description",
  "parameters": {
    "issue": {
      "type": "number",
      "description": "GitHub Issue number",
      "required": true,
      "cli": "--issue"
    },
    "iterateMax": {
      "type": "number",
      "description": "Maximum iteration count",
      "default": 3,
      "cli": "--iterate-max"
    }
  },
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md",
      "prompts": {
        "registry": "steps_registry.json",
        "fallbackDir": "prompts/"
      }
    },
    "verdict": {
      "type": "poll:state"
    },
    "boundaries": {
      "allowedTools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
      "permissionMode": "plan"
    },
    "logging": {
      "directory": "tmp/logs/agents/my-agent",
      "format": "jsonl"
    }
  }
}
```

> `required` defaults to `false` when omitted; parameters without it are treated
> as optional.

📖 [Agent Documentation](https://tettuan.github.io/climpt/)

## Configuration

Climpt uses two config files in `.agent/climpt/config/`:

- `<profile>-app.yml` - Prompt/schema directories
- `<profile>-user.yml` - User preferences

📖 [Configuration Guide](https://tettuan.github.io/climpt/)

## Documentation

Install docs locally as markdown:

```bash
# Install all docs
deno run -A jsr:@aidevtool/climpt/docs

# Install English guides only
deno run -A jsr:@aidevtool/climpt/docs install ./docs --category=guides --lang=en

# Combine into single file
deno run -A jsr:@aidevtool/climpt/docs install ./docs --mode=single

# List available docs
deno run -A jsr:@aidevtool/climpt/docs list

# Update to latest version (re-download)
deno run -Ar jsr:@aidevtool/climpt/docs install ./docs
```

The `-r` flag (`--reload`) forces re-download of the latest version from JSR.

📖 [Online Documentation](https://tettuan.github.io/climpt/)

## Examples (E2E Verification)

The [`examples/`](examples/) directory contains executable shell scripts
organized by use case. Run these before each release to verify end-to-end
functionality:

```bash
# Make scripts executable
chmod +x examples/**/*.sh examples/*.sh

# Run setup verification
./examples/01_setup/01_install.sh

# Run CLI basic operations
./examples/02_cli_basic/01_decompose.sh

# Clean up afterwards
./examples/07_clean.sh
```

| Folder                                  | Description                                   |
| --------------------------------------- | --------------------------------------------- |
| [01_setup/](examples/01_setup/)         | Installation and initialization               |
| [02_cli_basic/](examples/02_cli_basic/) | Core CLI commands: decompose, summary, defect |
| [03_mcp/](examples/03_mcp/)             | MCP server setup and IDE integration          |
| [04_docs/](examples/04_docs/)           | Documentation installer                       |
| [05_agents/](examples/05_agents/)       | Agent framework (iterator, reviewer)          |
| [06_registry/](examples/06_registry/)   | Registry generation and structure             |

See [`examples/README.md`](examples/README.md) for full details.

## Requirements

- Deno 2.5+
- Internet connection (for JSR packages)

## License

MIT License - see [LICENSE](LICENSE) file.

## Contributing

Issues and PRs welcome at [GitHub](https://github.com/tettuan/climpt).
