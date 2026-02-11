# User Documentation

This section is for users who want to use Climpt for prompt management and
CLI-based development workflows.

## Getting Started

### English Guides

- [Overview](../guides/en/00-overview.md) - What is Climpt?
- [Key Concepts](../guides/en/00-1-concepts.md) - Understanding C3L and core
  concepts
- [Prerequisites](../guides/en/01-prerequisites.md) - System requirements
- [Installation](../guides/en/02-installation.md) - How to install
- [Configuration](../guides/en/03-configuration.md) - Setting up your
  environment
- [Basic Usage](../guides/en/04-basic-usage.md) - Common commands
- [Advanced Usage](../guides/en/05-advanced-usage.md) - Power user features
- [Troubleshooting](../guides/en/06-troubleshooting.md) - Common issues
- [CLI Reference](../guides/en/07-cli-reference.md) - Full command reference
- [Prompt Structure](../guides/en/08-prompt-structure.md) - Understanding
  prompts

### Japanese Guides (日本語ガイド)

- [概要](../guides/ja/00-overview.md)
- [コンセプト](../guides/ja/00-1-concepts.md)
- [前提条件](../guides/ja/01-prerequisites.md)
- [インストール](../guides/ja/02-installation.md)
- [設定](../guides/ja/03-configuration.md)
- [基本的な使い方](../guides/ja/04-basic-usage.md)
- [高度な使い方](../guides/ja/05-advanced-usage.md)
- [トラブルシューティング](../guides/ja/06-troubleshooting.md)
- [CLIリファレンス](../guides/ja/07-cli-reference.md)
- [プロンプト構造](../guides/ja/08-prompt-structure.md)

## MCP Server Integration

- [MCP Setup Guide](../mcp-setup.md) - Integrating Climpt with Claude Code via
  MCP

## Prompt Customization

- [Prompt Customization Guide](../prompt-customization-guide.md) - Creating and
  modifying prompts

## C3L Specification

The C3L (Climpt Command Language) defines how commands are structured:

- [C3L Specification v0.5](../c3l_specification_v0.5.md) - Latest specification
- [C3L Known Issues](../C3L-issues.md) - Known limitations

## Using Autonomous Agents

Climpt includes autonomous agents for development tasks:

### Iterator Agent

Executes tasks iteratively until completion criteria are met:

```bash
# Issue mode: Run until issue is closed
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123

# Project mode: Complete all phases of a project
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5
```

### Reviewer Agent

Reviews implementation against requirements:

```bash
deno run -A jsr:@aidevtool/climpt/agents/reviewer --project 25
```

## Claude Code Plugin

For Claude Code users, install the Climpt plugin for seamless integration:

```bash
# Via Claude Code
/install-plugin tettuan/climpt/plugins/climpt-agent
```

Usage with the delegate skill:

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  -- ${CLAUDE_PLUGIN_ROOT}/skills/delegate-climpt-agent/scripts/climpt-agent.ts \
  --action="create draft" --target="specification document"
```

## Quick Reference

| Task            | Command                                  |
| --------------- | ---------------------------------------- |
| Run a prompt    | `climpt <directive> <layer>`             |
| With edition    | `climpt -e=detailed <directive> <layer>` |
| With input file | `climpt -f=input.md <directive> <layer>` |
| List commands   | Use MCP `search` tool                    |

## Examples (E2E Verification)

The [`examples/`](../../examples/) directory contains executable shell scripts
for verifying end-to-end functionality. Run these before each release:

```bash
chmod +x examples/**/*.sh examples/*.sh
./examples/01_setup/01_install.sh
./examples/02_cli_basic/01_decompose.sh
```

See [`examples/README.md`](../../examples/README.md) for the full list.

## Related Documentation

- [Developer Documentation](../developer/index.md) - For developers building
  agents
- [Internal Specifications](../internal/index.md) - Technical specifications
