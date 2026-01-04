# Climpt

[English](README.md) | [日本語](README.ja.md)

CLI Prompt Management Tool. Agents: Iterator, Reviewer also included. Besides CLI, it is available through MCP and plugins. The plugin skills run on a dedicated climpt-agent (via the Claude Agent SDK).

## Quick Start

```bash
# Initialize configuration
deno run -A jsr:@aidevtool/climpt init

# Run your first command
echo "Fix login bug" | deno run -A jsr:@aidevtool/climpt git decide-branch working-branch
```

📖 [Full Documentation](https://tettuan.github.io/climpt/)

## What is Climpt?

Climpt organizes pre-configured prompts and invokes them with a single command. Three ways to use:

| Method | Description |
|--------|-------------|
| **CLI** | Direct command-line execution |
| **MCP** | Integration with Claude/Cursor via Model Context Protocol |
| **Plugin** | Claude Code plugin with climpt-agent |

### Learn More

Explore interactively: [Climpt NotebookLM](https://notebooklm.google.com/notebook/6a186ac9-70b2-4734-ad46-359e26043507)

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

| Option | Short | Description |
|--------|-------|-------------|
| `--from` | `-f` | Input file |
| `--destination` | `-o` | Output path |
| `--edition` | `-e` | Prompt edition |
| `--adaptation` | `-a` | Prompt variation |
| `--uv-*` | - | Custom variables |

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

**Prerequisites**: Agents require GitHub CLI (`gh`) installed and authenticated, plus a Git repository pushed to GitHub.

### Iterator Agent

Autonomous development system using Claude Agent SDK:

```bash
# Initialize first (required)
deno run -A jsr:@aidevtool/climpt/agents/iterator --init

# Then run with an issue
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123
```

### Reviewer Agent

Autonomous code review agent:

```bash
deno run -A jsr:@aidevtool/climpt/agents/reviewer --pr 456
```

📖 [Agent Documentation](https://tettuan.github.io/climpt/)

## Configuration

Climpt uses two config files in `.agent/climpt/config/`:

- `<profile>-app.yml` - Prompt/schema directories
- `<profile>-user.yml` - User preferences

📖 [Configuration Guide](https://tettuan.github.io/climpt/)

## Requirements

- Deno 2.5+
- Internet connection (for JSR packages)

## License

MIT License - see [LICENSE](LICENSE) file.

## Contributing

Issues and PRs welcome at [GitHub](https://github.com/tettuan/climpt).
# Test commit for CI hook
