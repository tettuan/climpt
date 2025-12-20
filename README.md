# Climpt

A CLI tool for managing prompts and AI interactions - a wrapper for the breakdown package.

## Overview

Climpt allows you to organize pre-configured prompts, invoke the desired prompt with a single command, and output the result.
You can pass values as arguments to be inserted into the prompt when invoked.

Execution examples:
```sh
# Build new tests based on bug reports
cat bug_report.md | climpt-buld new test --edition=bug

# Detailed breakdown from issue to tasks
climpt-breakdown to task --edition=issue --from=github_issue_123.md --adaptation=detailed --uv-storypoint=5

```

Provides a unified interface for AI-assisted development instruction tools, enabling creation, management, and execution of development instructions that AI systems can interpret using TypeScript and JSON Schema.

This tool is designed to work with AI coding agents and is optimized specifically for Cursor and Claude. While the underlying AI model is assumed to be Claude, the syntax and structure are designed to be easily interpreted by other AI models as well.

## Installation

### Recommended: Install as CLI

Climpt is primarily intended to be used as a CLI tool. You can install it using the official Deno/JSR method:

```bash
deno install --allow-read --allow-write --allow-net --allow-env --global climpt jsr:@aidevtool/climpt
```

- `--allow-read`: Allows reading files and directories (required for input files)
- `--allow-write`: Allows writing files and directories (required for output generation)
- `--allow-net`: Allows network access (required for downloading breakdown package from JSR)
- `--allow-env`: Allows environment variable access (required for configuration)
- `-f`: Override existing command
- `--global`: Install globally
- `climpt`: Command name

> **Note:**
> For convenience, you can use `-A` (allow all permissions), but for security, we recommend using specific permission flags as shown above.
> Specify the CLI module as `jsr:@aidevtool/climpt`.
> This is based on the `exports` configuration in `deno.json`.

## Usage

### Basic Commands

After installation, you can use the climpt command directly:

```bash
# Show help
climpt --help

# Generate initial configuration file
climpt init

# Check version
climpt --version
```

Climpt provides access to all features of the breakdown package through a simple wrapper interface.
(In the future, we plan to migrate feature development itself from Breakdown to Climpt.)

### Command Syntax

Climpt commands follow this syntax:

```bash
climpt-<profile> <directive> <layer> [options]
```

**Components:**
- `<profile>`: Profile name (e.g., git, breakdown, build)
- `<directive>`: Action to execute (e.g., create, analyze, trace)
- `<layer>`: Target layer (e.g., refinement-issue, quality-metrics)
- `[options]`: Various options

### Options List

#### Input/Output Options

| Option | Short | Description | Corresponding Variable |
|---------|------|------|------------|
| `--from` | `-f` | Specify input file | `{input_text_file}` |
| `--destination` | `-o` | Specify output destination (file or directory) | `{destination_path}` |
| (STDIN) | - | Receive data from standard input | `{input_text}` |

#### Processing Mode Options

| Option | Short | Description | Usage |
|---------|------|------|------|
| `--edition` | `-e` | Specify input layer type | Used for prompt file selection (defaults to "default" if not specified) |
| `--adaptation` | `-a` | Specify prompt type | Prompt variation selection |

Searches for prompt file name `f_<edition>_<adaptation>.md`.

#### Custom Variable Options

| Option | Description | Example |
|--------|-------------|---------|
| `--uv-*` | Specify user-defined variables | `--uv-max-line-num=100` |

#### System Options

| Option | Description |
|--------|-------------|
| `--help` | Display help message |
| `--version` | Display version information |
| `--config` | Specify profile to use |

### Template Variables and Option Correspondence

Correspondence between variables usable in prompt templates and CLI options:

| Template Variable | CLI Option | Description | Required |
|---------------|-------------|------|------|
| `{input_text}` | STDIN | Text from standard input | ✗ |
| `{input_text_file}` | `-f`, `--from` | Path to input file | ✗ |
| `{destination_path}` | `-o`, `--destination` | Path to output destination | ✗ |
| `{uv-*}` | `--uv-*` | Custom variables (any name) | ✗ |

**Note:** The `-f`/`--from` option and STDIN operate independently and can be used simultaneously.

### Usage Examples

#### 1. Using Standard Input

```bash
# Generate troubleshooting plan from error log
echo "something error" | climpt-diagnose trace stack --edition=test -o=./tmp/abc --uv-max-line-num=3
```

#### 2. Input from File

```bash
# Create refinement issue from requirements document
climpt-git create refinement-issue -f=requirements.md -o=./issues/

# Break down issue into tasks in detailed mode
climpt-breakdown to task --edition=issue --from=github_issue_123.md --adaptation=detailed --uv-storypoint=5
```

#### 3. Combining Standard Input and File Input

```bash
# Build new tests from bug report
cat bug_report.md | climpt-build new test --edition=bug
```

#### 4. Switching Profiles

```bash
# Use architecture optimization prompt
climpt-arch optimize go -f=current_design.md

# Use setup prompt
climpt-setup climpt list
```

### Prompt File Structure

Prompt files are placed according to the following rules:

```
.agent/climpt/prompts/<profile>/<directive>/<layer>/f_<edition>_<adaptation>.md
```

**Naming Conventions:**
- `f_default.md`: Default prompt (no `--edition` and `--adaptation` specified)
- `f_<edition>.md`: For specific edition type (e.g., `f_code.md`)
- `f_<edition>_<adaptation>.md`: Combination of edition type and processing mode (e.g., `f_default_strict.md`)

**Frontmatter Example:**

```yaml
---
title: Determine new git branch creation and create new branch
input_text: Specify work content within 30 characters
description: Select and create appropriate branch based on branching strategy
options:
  edition: ["default"]
  adaptation: []
  input_text: true
  input_file: false
  destination_path: false
---
```

### Error Handling

- **File not found:** Check prompt file path and naming conventions
- **Permission errors:** Verify required permissions (`--allow-read`, `--allow-write`, etc.)
- **Missing configuration file:** Run `climpt init` to generate `.agent/climpt/config/default-app.yml`

## Key Features

- Optimized Markdown conversion prompts
- JSON Schema syntax for AI systems
- Wrapper interface for breakdown package
- Support for various output formats (Markdown/JSON/YAML)

## Purpose

To express development requirements in a standardized way, bridging the gap between human-written specifications and AI-interpretable instructions.

This tool itself does not perform rule-based document generation. It provides prompts and structured formats that are easy for AI to interpret and process, in order to support AI-driven document generation.

## MCP (Model Context Protocol) Server

Climpt includes a built-in MCP server that allows AI assistants like Claude to interact directly with the command registry and execute development tasks through a standardized protocol.

**Important**: When using MCP, the `.deno/bin` directory is **not required**. The MCP server executes commands directly through the protocol without requiring local CLI binaries.

### MCP Features

- **Dynamic Tool Loading**: Automatically loads available tools from `.agent/climpt/registry.json`
- **Full Command Registry Access**: All Climpt commands (git, meta) are available
- **Multiple Registry Support** (v1.6.1+): Manage and switch between multiple agent registries
- **Registry Configuration Management**: Configuration-based registry management via `.agent/climpt/mcp/config.json`
- **Performance Optimization**: Fast responses through registry caching
- **Graceful Fallback**: Defaults to standard tools when configuration is unavailable
- **JSR Distribution**: Run directly from JSR without local installation
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

### Multiple Registry Configuration (v1.6.1+)

From v1.6.1, the MCP server can manage multiple agent registries.

#### MCP Config Setup

Define multiple agents and their registry paths in `.agent/climpt/mcp/config.json`:

```json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json",
    "inspector": ".agent/inspector/registry.json",
    "auditor": ".agent/auditor/registry.json"
  }
}
```

**Configuration Location Priority:**
1. Current directory: `.agent/climpt/mcp/config.json`
2. Home directory: `~/.agent/climpt/mcp/config.json`
3. Default configuration (automatically created)

**Default Configuration:**
Automatically created when MCP starts:
```json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json"
  }
}
```

#### Specifying Agent in Tools

The `search` and `describe` tools allow you to switch registries using the optional `agent` parameter:

```javascript
// Search in climpt registry (default)
search({ query: "commit changes" })

// Search in inspector registry
search({ query: "analyze code quality", agent: "inspector" })

// Get details from auditor registry
describe({ c1: "test", c2: "run", c3: "unit", agent: "auditor" })
```

### Registry Configuration

The MCP server reads configuration from each agent's `.agent/{agent}/registry.json`. This file defines available tools and their command mappings according to the C3L (Climpt 3-word Language) specification.

#### Registry File Schema

```typescript
{
  "version": string,           // Registry version (e.g., "1.0.0")
  "description": string,       // Overall registry description
  "tools": {
    // Array of tool names in C3L v0.5 format (climpt-{domain})
    "availableConfigs": string[],  // ["climpt-git", "climpt-meta"]

    // Command registry - defines all available C3L commands
    "commands": [
      {
        "c1": string,         // Domain/category in C3L v0.5 format (climpt-git, climpt-meta)
        "c2": string,         // Action/directive (create, analyze, execute, etc.)
        "c3": string,         // Target/layer (refinement-issue, quality-metrics, etc.)
        "description": string,// Command description
        "usage": string,      // Usage and examples
        "options": {          // Options available for this command
          "edition": string[],   // Edition types (used for prompt file selection)
          "adaptation": string[], // Prompt types (prompt variation selection)
          "file": boolean,  // File input support
          "stdin": boolean,       // Standard input support
          "destination": boolean  // Output destination specification support
        }
      }
    ]
  }
}
```

#### Complete Registry Template

```json
{
  "version": "1.0.0",
  "description": "Climpt comprehensive configuration for MCP server and command registry",
  "tools": {
    "availableConfigs": [
      "climpt-git",
      "climpt-meta"
    ],
    "commands": [
      {
        "c1": "climpt-git",
        "c2": "decide-branch",
        "c3": "working-branch",
        "description": "Decide whether to create a new branch or continue on the current branch based on task content",
        "usage": "climpt-git decide-branch working-branch",
        "options": {
          "edition": ["default"],
          "adaptation": ["default"],
          "file": false,
          "stdin": true,
          "destination": false
        }
      },
      {
        "c1": "climpt-git",
        "c2": "merge-up",
        "c3": "base-branch",
        "description": "Merge a derived working branch back into its parent working branch",
        "usage": "climpt-git merge-up base-branch",
        "options": {
          "edition": ["default"],
          "adaptation": ["default"],
          "file": false,
          "stdin": false,
          "destination": false
        }
      },
      {
        "c1": "climpt-meta",
        "c2": "build",
        "c3": "frontmatter",
        "description": "Generate C3L v0.5 compliant frontmatter for Climpt instruction files",
        "usage": "climpt-meta build frontmatter",
        "options": {
          "edition": ["default"],
          "adaptation": ["default", "detailed"],
          "file": false,
          "stdin": true,
          "destination": true
        }
      },
      {
        "c1": "climpt-meta",
        "c2": "create",
        "c3": "instruction",
        "description": "Create a new Climpt instruction file from stdin input, following C3L specification with all required configurations",
        "usage": "climpt-meta create instruction",
        "options": {
          "edition": ["default"],
          "adaptation": ["default", "detailed"],
          "file": false,
          "stdin": true,
          "destination": true
        }
      }
    ]
  }
}
```

**Loading Process**:
1. Server loads `.agent/climpt/registry.json` on startup
2. Dynamically creates tools from `availableConfigs`
3. Falls back to defaults if file not found
4. Each tool is available as `climpt-{name}`

**Field Descriptions**:
- `version`: Registry schema version
- `description`: Overall registry description
- `availableConfigs`: Array of tool names in C3L v0.5 format (e.g., `climpt-git`, `climpt-meta`)
- `commands`: Array of command definitions following C3L specification
  - `c1/c2/c3`: Command structure (domain/action/target)
  - `description`: Purpose of the command
  - `usage`: Usage and examples
  - `options`: Options available for each command
    - `edition`: Edition types (used for prompt file selection, defaults to "default" if not specified) (e.g., ["default", "code", "bug"])
    - `adaptation`: Prompt types (prompt variation selection) (e.g., ["default", "detailed", "strict"])
    - `file`: Whether file input is supported (true or false)
    - `stdin`: Whether standard input is supported (true or false)
    - `destination`: Whether output destination can be specified (true or false)

**Quick Start**:
Copy the template file to your project:
```bash
cp examples/mcp/registry.template.json .agent/climpt/registry.json
```

Complete template file available at [`examples/mcp/registry.template.json`](examples/mcp/registry.template.json)

### Registry Generation

Generate or update `registry.json` from prompt frontmatter:

```bash
# Via JSR (recommended)
deno run --allow-read --allow-write --allow-env jsr:@aidevtool/climpt/reg

# Local repository (using deno task)
deno task generate-registry
```

Options:
- `--base=<dir>` - Base directory
- `--schema=<path>` - Schema file path
- `--input=<pattern>` - Input glob pattern
- `--output=<path>` - Output file path
- `--template=<path>` - Template file path

This uses `@aidevtool/frontmatter-to-schema` to:
1. Read prompts from `.agent/climpt/prompts/**/*.md`
2. Extract frontmatter and transform using `.agent/climpt/frontmatter-to-schema/registry.schema.json`
3. Output to `.agent/climpt/registry.json`

### Running the MCP Server

You can also run the MCP server directly:

```bash
# From JSR (recommended)
deno run --allow-read --allow-write --allow-net --allow-env --allow-run jsr:@aidevtool/climpt/mcp

# Locally for development
deno run --allow-read --allow-write --allow-net --allow-env --allow-run ./src/mcp/index.ts
```

The MCP server provides AI assistants with structured access to all Climpt functionality.

## Claude Code Plugin

Climpt provides a Claude Code Plugin for seamless integration with AI-assisted development workflows.

### Quick Install

```bash
# Add marketplace
/plugin marketplace add https://github.com/tettuan/climpt-marketplace

# Install plugin
/plugin install climpt-agent
```

### Features

- **Natural Language Commands**: Automatically search and execute Climpt commands from natural language requests
- **Git Workflows**: Commit grouping, branch management, PR workflows
- **Meta Operations**: Frontmatter generation, instruction file creation

See [climpt-plugins/README.md](climpt-plugins/README.md) for detailed documentation.

## Iterate Agent

Iterate Agent is an autonomous development system that continuously executes development tasks using the Claude Agent SDK.

### Overview

Iterate Agent runs development workflows autonomously by:
- Fetching requirements from GitHub Issues or Projects
- Using Climpt Skills to execute tasks through delegate-climpt-agent
- Evaluating progress against completion criteria
- Iterating until the work is complete

### Setup

Add a task to your `deno.json` (configuration example):

```json
{
  "tasks": {
    "iterate-agent": "deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys iterate-agent/scripts/agent.ts"
  }
}
```

### Quick Start

```bash
# Prerequisites: Set environment variables
export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxx"
export ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxxxxxxxxxxx"

# Direct execution (after setting up the task)
deno task iterate-agent --issue 123

# Or run directly without task configuration
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys iterate-agent/scripts/agent.ts --issue 123
```

### Usage Examples

```bash
# Work on Issue #123 until closed
deno task iterate-agent --issue 123

# Work on Project #5 until all items complete
deno task iterate-agent --project 5

# Run for maximum 10 iterations
deno task iterate-agent --iterate-max 10
```

### Key Features

- **Autonomous Execution**: Runs without human intervention
- **GitHub Integration**: Works with Issues and Projects via `gh` CLI
- **Climpt Skills Integration**: Leverages existing Climpt infrastructure
- **Detailed Logging**: JSONL format with automatic rotation (max 100 files)
- **Flexible Completion**: Complete by Issue close, Project done, or iteration count

### Documentation

For detailed usage, configuration, and troubleshooting, see [iterate-agent/README.md](iterate-agent/README.md).

## Climpt Use Cases

Switch between diverse prompts and get the desired prompt with a single command.
Primarily designed for the following use cases:

- Want to centrally manage the use of patterned prompts
- Want to dynamically invoke from CLI agents like Claude Code
- Want to build processing flows by mediating prompts in processing chains
- Want to use specific refined prompt sets for specific implementation domains
- Want Coding Agents to select prompts

Also, as applied use cases, the following scenarios are anticipated:

- Want to guide and stabilize the code generated by Coding Agents
- Want to execute high-abstraction implementations with high reproducibility

For application purposes, we use Deno.
Climpt is prepared and optimized as multiple Deno execution commands.
The prepared execution commands can switch profiles.

## Setup

### Initial Configuration

Climpt requires `.agent/climpt/config/default-app.yml`.
Normally, it is generated by running `climpt init` in the project root.

You can also install it in any hierarchical location. For example, it's possible to init under tests/.
The recommended approach is to prepare multiple executable files in `.deno/bin/*`. This is more convenient and manageable than having them scattered in various places.

Furthermore, by placing them under `.deno/bin/*` with different names like `subagent-*` or `inspector-*`, you can also support Sub-Agents.

### Configuration File Structure

Climpt uses two types of configuration files:

#### app.yml (Application Configuration)

Defines the placement directories for prompts and schemas.

```yaml
# Example of .agent/climpt/config/git-app.yml
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts/git"
app_schema:
  base_dir: "schema/git"
```

#### user.yml (User Configuration)

Customize option default values and behavior. In particular, you can set a prefix for `destination`.

```yaml
# Example of .agent/climpt/config/git-user.yml
options:
  destination:
    prefix: "output/git"  # Prefix automatically added before paths specified with -o
```

**Configuration Priority:**
1. Command-line options (highest priority)
2. `user.yml` configuration
3. `app.yml` configuration
4. Default values

**Destination Prefix Behavior Example:**

```bash
# If prefix: "output/git" is set in user.yml
climpt-git create issue -o=tasks/task1.md
# Actual output destination: output/git/tasks/task1.md

# Without prefix configured
climpt-git create issue -o=tasks/task1.md
# Actual output destination: tasks/task1.md
```

### Multiple Installation Configuration

Profile switching is done with the `--config` option.
When calling Deno, add `--config=profilename`.

This achieves the following:

First, prepare multiple invocations with different --config under .deno/bin.

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

Next, prepare multiple corresponding configurations. The * part of `*-app.yml` is the profile name.
You can change the accepted argument specifications for each profile.
For example, `arch` can execute `climpt-arch optimize go`, but you can create a situation where `climpt-setup optimize go` cannot be executed.

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

Finally, prepare template prompts.
The prompt placement location can be switched in the configuration. Therefore, you can change the storage hierarchy for each profile.
In the example below, the same prompts/ hierarchy is organized by profile name.

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

### Operations

Add frequently used prompt files to the prompt hierarchy.
Place prompts that are important to the project under Git management.

Prompts can use template variables for replacement.

#### Prompt Implementation Sample

For an actual prompt implementation example, refer to [`examples/prompts/list/usage/f_default.md`](/examples/prompts/list/usage/f_default.md). This file is an implementation sample of a prompt template for generating a list of available commands in Climpt. It includes frontmatter configuration methods, template variable usage, and structured output definition using JSON Schema.

``````markdown
# Error Troubleshooting Plan

Classify errors by type and consider a plan.
After that, separate by error type into files and save to the output destination.
The maximum number of lines to write in one file is {uv-max-line-num}.

Output destination: `{destination_path}`


# Error Content

`````
{input_text}
`````
``````

When the following CLI is executed against the above template, the values are replaced:

```
echo "something error" | climpt-diagnose trace stack --edition=test -o=./tmp/abc --uv-max-line-num=3
```

### Update

To update to the latest version, run the same installation command again:

```bash
deno install --allow-read --allow-write --allow-net --allow-env --global climpt jsr:@aidevtool/climpt
```

### Uninstall

#### For Global Installation

```bash
deno uninstall climpt
```

#### For Local (Project) Installation

```bash
deno uninstall --root .deno climpt
```
- Use `--root .deno` to uninstall from the project's `.deno/bin` directory.

### Notes

- The climpt command automatically uses `cli.ts` as the entry point via the `bin` configuration in `deno.json`.
- Deno 2.4 or later is recommended.
- For detailed usage, refer to the "Usage" section.

### Local Installation to Project Directory

If you want to use the climpt command only within a specific project, you can install it to `.deno/bin` using the `--root` option:

```bash
deno install --allow-read --allow-write --allow-net --allow-env --global --root .deno -n climpt jsr:@aidevtool/climpt
```

After installation, add the bin directory to your PATH:

```bash
export PATH="$(pwd)/.deno/bin:$PATH"
```

To make this configuration permanent, add it to your shell configuration file (e.g., `~/.zshrc` or `~/.bashrc`).

## Architecture

Climpt is designed as a lightweight wrapper for the `@tettuan/breakdown` package, providing a unified CLI interface while maintaining all features of the underlying breakdown tool.

## Requirements

- Deno 2.5 or later (recommended)
- Internet connection (required for downloading JSR packages)

> **Note:** Deno 2.x is recommended.

## License

MIT License - see LICENSE file for details.

## Contributing

This project is a wrapper for the breakdown package. For core feature improvements, refer to the breakdown package repository.
