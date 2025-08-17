# Climpt

A CLI tool for managing prompts and AI interactions - a wrapper around the breakdown package.

## Overview

Climpt is a command-line interface tool that serves as a wrapper around the `@tettuan/breakdown` JSR package. It provides a unified interface for AI-assisted development instruction tools, enabling developers to create, manage, and execute development instructions using TypeScript and JSON Schema for AI system interpretation.

This tool is designed to work in conjunction with AI Coding agents, specifically optimized for Cursor (the author's primary tool). The underlying AI model is assumed to be Claude-4-sonnet, though the syntax and structure are designed to be easily interpretable by other AI models.

## Installation

### Recommended: Install as CLI

Climpt is primarily designed to be used as a CLI tool. You can install it using the official Deno/JSR method:

```bash
deno install --allow-read --allow-write --allow-net --allow-env --global climpt jsr:@aidevtool/climpt
```

- `--allow-read`: Allow reading files and directories (required for input files)
- `--allow-write`: Allow writing files and directories (required for output generation)

# Climpt

A CLI tool for managing prompts and AI interactions - a wrapper around the breakdown package.

## Overview

Climpt allows you to select from a set of prepared prompts and call the desired prompt with a single command, outputting the result. You can pass values to be inserted into the prompt as command-line arguments.

Example usage:
```sh
# Create new tests based on a bug report
cat bug_report.md | climpt-build new test --input=bug

# Detailed breakdown from issue to task
climpt-breakdown to task --input=issue --from=github_issue_123.md --adaptation=detailed --uv-storypoint=5
```

Climpt provides a unified interface for AI-assisted development instruction tools, enabling the creation, management, and execution of development instructions interpretable by AI systems using TypeScript and JSON Schema.

This tool is designed to work in conjunction with AI coding agents, especially optimized for Cursor and Claude. The underlying AI model is assumed to be Claude, but the syntax and structure are designed to be easily interpretable by other AI models as well.

## Installation

### Recommended: Install as CLI

Climpt is primarily intended to be used as a CLI tool. You can install it using the official Deno/JSR method:

```bash
deno install --allow-read --allow-write --allow-net --allow-env --global climpt jsr:@aidevtool/climpt
```

- `--allow-read`: Allow reading files and directories (required for input files)
- `--allow-write`: Allow writing files and directories (required for output generation)
- `--allow-net`: Allow network access (required for downloading breakdown package from JSR)
- `--allow-env`: Allow environment variable access (required for configuration)
- `-f`: Force overwrite existing command
- `--global`: Install globally
- `climpt`: Command name

> **Note:**
> While `-A` (allow all permissions) can be used for convenience, it is recommended to use specific permission flags as shown above for better security.
> The CLI module must be specified as `jsr:@aidevtool/climpt`.
> This is based on the `exports` configuration in `deno.json`.

## Usage

After installation, you can use the climpt command directly:

```bash
climpt --help
climpt init
climpt to project --config=custom
```

Climpt provides access to all breakdown package functionality through a simple wrapper interface.
(In the future, feature development itself will be migrated from Breakdown to Climpt.)

## Key Features

- Optimized Markdown conversion prompts
- JSON Schema syntax for AI systems
- Wrapper interface for the breakdown package
- Support for various output formats (Markdown/JSON/YAML)

## Purpose

To provide a standardized way to express development requirements, bridging the gap between human-written specifications and AI-interpretable instructions.

This tool itself does not generate documents based on rules. It supports AI document generation by providing prompts and structured formats that are easy for AI to interpret and handle.

## MCP (Model Context Protocol) Server

Climpt includes a built-in MCP server that enables AI assistants like Claude to interact directly with the command registry and execute development tasks through a standardized protocol.

**Important**: When using MCP, the `.deno/bin` directory is **not required**. The MCP server executes commands directly through the protocol without needing local CLI binaries.

### MCP Features

- **Dynamic Tool Loading**: Automatically loads available tools from `.agent/climpt/registry.json`
- **Full Command Registry Access**: All Climpt commands (code, docs, git, meta, spec, test) are available
- **Graceful Fallback**: Defaults to standard tools when configuration is unavailable
- **JSR Distribution**: Can be run directly from JSR without local installation
- **No Binary Dependencies**: Works without `.deno/bin` installation

### MCP Configuration

Configure the MCP server in your Claude or Cursor settings (`.mcp.json` or `~/.claude.json`):

```json
{
  "mcpServers": {
    "climpt": {
      "command": "deno",
      "args": [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-run",
        "jsr:@aidevtool/climpt/mcp"
      ]
    }
  }
}
```

### Registry Configuration

The MCP server loads its configuration from `.agent/climpt/registry.json`. This file defines available tools and their command mappings following the C3L (Climpt 3-word Language) specification.

#### Registry File Schema

```typescript
{
  "tools": {
    // Tool definitions array - each becomes available as climpt-{name}
    "availableConfigs": [
      {
        "name": string,        // Tool identifier (e.g., "git", "spec", "test")
        "description": string, // Human-readable description
        "usage": string       // Example usage pattern
      }
    ],
    
    // Command registry - defines all available C3L commands
    "commands": [
      {
        "c1": string,         // Domain/category (git, spec, test, code, docs, meta)
        "c2": string,         // Action/directive (create, analyze, execute, etc.)
        "c3": string,         // Target/layer (refinement-issue, quality-metrics, etc.)
        "description": string // Command description
      }
    ]
  }
}
```

#### Complete Registry Template

```json
{
  "tools": {
    "availableConfigs": [
      {
        "name": "git",
        "description": "Git operations and repository management",
        "usage": "climpt-git create refinement-issue --from=requirements.md"
      },
      {
        "name": "spec",
        "description": "Specification analysis and management",
        "usage": "climpt-spec analyze quality-metrics --input=spec.md"
      },
      {
        "name": "test",
        "description": "Testing and verification operations",
        "usage": "climpt-test execute integration-suite --config=test.yml"
      },
      {
        "name": "code",
        "description": "Code generation and development tasks",
        "usage": "climpt-code create implementation --from=design.md"
      },
      {
        "name": "docs",
        "description": "Documentation generation and management",
        "usage": "climpt-docs generate api-reference --format=markdown"
      },
      {
        "name": "meta",
        "description": "Meta operations and command management",
        "usage": "climpt-meta list available-commands"
      }
    ],
    "commands": [
      // Git commands
      {
        "c1": "git",
        "c2": "create",
        "c3": "refinement-issue",
        "description": "Create a refinement issue from requirements documentation"
      },
      {
        "c1": "git",
        "c2": "analyze",
        "c3": "commit-history",
        "description": "Analyze commit history and generate insights"
      },
      
      // Spec commands
      {
        "c1": "spec",
        "c2": "analyze",
        "c3": "quality-metrics",
        "description": "Analyze specification quality and completeness"
      },
      {
        "c1": "spec",
        "c2": "validate",
        "c3": "requirements",
        "description": "Validate requirements against standards"
      },
      
      // Test commands
      {
        "c1": "test",
        "c2": "execute",
        "c3": "integration-suite",
        "description": "Execute integration test suite"
      },
      {
        "c1": "test",
        "c2": "generate",
        "c3": "unit-tests",
        "description": "Generate unit tests from specifications"
      },
      
      // Code commands
      {
        "c1": "code",
        "c2": "create",
        "c3": "implementation",
        "description": "Create implementation from design documents"
      },
      {
        "c1": "code",
        "c2": "refactor",
        "c3": "architecture",
        "description": "Refactor code architecture based on patterns"
      },
      
      // Docs commands
      {
        "c1": "docs",
        "c2": "generate",
        "c3": "api-reference",
        "description": "Generate API reference documentation"
      },
      {
        "c1": "docs",
        "c2": "update",
        "c3": "user-guide",
        "description": "Update user guide documentation"
      },
      
      // Meta commands
      {
        "c1": "meta",
        "c2": "list",
        "c3": "available-commands",
        "description": "List all available Climpt commands"
      },
      {
        "c1": "meta",
        "c2": "resolve",
        "c3": "command-definition",
        "description": "Resolve and display command definitions"
      }
    ]
  }
}
```

**Loading Process**:
1. Server reads `.agent/climpt/registry.json` at startup
2. Dynamically creates tools from `availableConfigs`
3. Falls back to defaults if file is missing
4. Each tool becomes available as `climpt-{name}`

**Field Descriptions**:
- `name`: Identifier used in the command (e.g., `climpt-git`)
- `description`: Shown to AI assistants for tool selection
- `usage`: Example command demonstrating typical usage
- `c1/c2/c3`: Follow C3L specification for command structure
- Commands are matched using the c1/c2/c3 pattern

**Quick Start**:
Copy the template file to your project:
```bash
cp examples/mcp/registry.template.json .agent/climpt/registry.json
```

A complete template file is available at [`examples/mcp/registry.template.json`](examples/mcp/registry.template.json)

### Running the MCP Server

You can also run the MCP server directly:

```bash
# From JSR (recommended)
deno run --allow-read --allow-write --allow-net --allow-env --allow-run jsr:@aidevtool/climpt/mcp

# Locally for development
deno run --allow-read --allow-write --allow-net --allow-env --allow-run ./src/mcp/index.ts
```

The MCP server provides AI assistants with structured access to all Climpt functionality, enabling them to:
- Execute development tasks programmatically
- Access the complete command registry
- Generate and manage documentation
- Perform Git operations
- Analyze specifications
- Run tests and verifications

## Use Cases

Select from various prompts and obtain the desired prompt with a single command. The main use cases are:

- Centralized management of patterned prompts
- Dynamic invocation from CLI agents like Claude Code
- Building processing flows by mediating prompts in chained operations
- Using refined prompt sets for specific implementation domains
- Letting the coding agent choose prompts

Additional use cases include:

- Guiding and stabilizing code generated by coding agents
- Executing highly abstract implementations with reproducibility

Deno is used for advanced usage. Climpt is optimized and provided as multiple Deno execution commands. The prepared execution commands can switch profiles.

## Setup

### Initial Setup

Climpt requires `.agent/climpt/config/default-app.yml`.
Usually, running `climpt init` at the project root will generate this file.

You can also install it at any hierarchy, such as under `tests/`. However, it is more convenient to manage multiple executables under `.deno/bin/*`.

### Multiple Installation Configuration

Profile switching is done with the `--config` option. When calling Deno, add `--config=profilename`.

This enables the following:

First, prepare multiple calls with different `--config` under `.deno/bin`.

```
.deno/bin
├── climpt-arch         # --config=arch
├── climpt-breakdown    # --config=breakdown
├── climpt-build        # --config=build
├── climpt-diagnose     # --config=diagnose
├── climpt-research     # --config=research
├── climpt-setup        # --config=setup
└── climpt-verify       # --config=verify
```

Next, prepare corresponding configuration files. The * part of `*-app.yml` is the profile name. You can change the accepted argument specification for each profile. For example, `arch` can run `climpt-arch optimize go`, but you can make it so that `climpt-setup optimize go` cannot be executed.

```
.agent/climpt
├── config
│   ├── arch-app.yml
│   ├── arch-user.yml
│   ├── breakdown-app.yml
│   ├── breakdown-user.yml
│   ├── build-app.yml
│   ├── build-user.yml
```

Finally, prepare template prompts. The location of prompts can be switched by configuration, so you can change the storage hierarchy for each profile. In the example below, the same `prompts/` hierarchy is divided by profile name.

```
.agent/climpt
├── prompts
│   ├── arch
│   │   └── optimize
│   │       └── go
│   │           └── f_default.md
│   ├── breakdown
│   │   └── to
│   │       ├── issue
│   │       │   ├── f_default.md
│   │       │   ├── f_detailed.md
│   ├── diagnose
│   │   └── trace
│   │       └── stack
│   │           └── f_test.md
│   ├── setup
│   │   └── climpt
│   │       └── list
│   │           └── f_default.md
```

### Operation

Add frequently used prompt files to the prompt hierarchy. Important prompts for the project should be placed under Git management.

Prompts can use template variables for substitution.

#### Prompt Implementation Sample

For an actual prompt implementation example, please refer to [`examples/prompts/list/usage/f_default.md`](/examples/prompts/list/usage/f_default.md). This file is a sample implementation of a prompt template for generating a list of available commands in Climpt. It includes examples of frontmatter configuration, template variable usage, and structured output definition using JSON Schema.

``````markdown
# Error Handling Policy

Errors are categorized by type, and policies are considered. Then, files are separated by error type and saved to the output destination. The maximum number of lines per file is {uv-max-line-num}.

Output destination: `{destination_path}`


# Error Content

`````
{input_text}
`````
``````

When you run the following CLI against the above template, the values will be replaced:

```
echo "something error" | climpt-diagnose trace stack --input=test -o=./tmp/abc --uv-max-line-num=3
```

### Update

To update to the latest version, simply run the same installation command again:

```bash
deno install --allow-read --allow-write --allow-net --allow-env --global climpt jsr:@aidevtool/climpt
```

### Uninstall

#### For global installation

```bash
deno uninstall climpt
```

#### For local (project) installation

```bash
deno uninstall --root .deno climpt
```
- Use `--root .deno` to uninstall from the project's `.deno/bin` directory.

### Notes

- The climpt command automatically uses `cli.ts` as the entry point due to the `bin` configuration in `deno.json`.
- Deno 2.4 or later is recommended.
- For detailed usage instructions, refer to the "Usage" section above.

### Local Installation to Project Directory

If you want to use the climpt command only within a specific project, you can install it to `.deno/bin` using the `--root` option:

```bash
deno install --allow-read --allow-write --allow-net --allow-env --global --root .deno -n climpt jsr:@aidevtool/climpt
```

After installation, add the bin directory to your PATH:

```bash
export PATH="$(pwd)/.deno/bin:$PATH"
```

To make this setting persistent, add it to your shell configuration file (e.g., `~/.zshrc` or `~/.bashrc`).

## Architecture

Climpt is designed as a lightweight wrapper around the `@tettuan/breakdown` package, providing a unified CLI interface while maintaining all the functionality of the underlying breakdown tools.

## Requirements

- Deno 2.4 or later (recommended)
- Internet connection (for JSR package downloads)

> **Note:** Deno 2.x is recommended.

## License

MIT License - see LICENSE file for details.

## Contributing

This project is a wrapper around the breakdown package. For core functionality improvements, please refer to the breakdown package repository.
