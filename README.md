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

### Basic Commands

After installation, you can use the climpt command directly:

```bash
# Display help
climpt --help

# Generate initial configuration files
climpt init

# Check version
climpt --version
```

Climpt provides access to all breakdown package functionality through a simple wrapper interface.
(In the future, feature development itself will be migrated from Breakdown to Climpt.)

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

### Options Reference

#### Input/Output Options

| Option | Short | Description | Corresponding Variable |
|--------|-------|-------------|----------------------|
| `--from` | `-f` | Specify input file | `{input_text_file}` |
| `--destination` | `-o` | Specify output destination (file or directory) | `{destination_path}` |
| (STDIN) | - | Receive data from standard input | `{input_text}` |

#### Processing Mode Options

| Option | Short | Description | Purpose |
|--------|-------|-------------|---------|
| `--input` | `-i` | Specify input layer type | Used for prompt file selection (defaults to "default" if not specified) |
| `--adaptation` | `-a` | Specify prompt type | Prompt variation selection |

Searches for prompt file named `f_<input>_<adaptation>.md`.

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

### Template Variables and Options Mapping

Correspondence between variables used in prompt templates and CLI options:

| Template Variable | CLI Option | Description | Required |
|------------------|------------|-------------|----------|
| `{input_text}` | STDIN | Text from standard input | ✗ |
| `{input_text_file}` | `-f`, `--from` | Input file path | ✗ |
| `{destination_path}` | `-o`, `--destination` | Output destination path | ✗ |
| `{uv-*}` | `--uv-*` | Custom variables (any name) | ✗ |

**Note:** The `-f`/`--from` option and STDIN work independently and can be used simultaneously.

### Usage Examples

#### 1. Using Standard Input

```bash
# Generate error handling policy from error logs
echo "something error" | climpt-diagnose trace stack --input=test -o=./tmp/abc --uv-max-line-num=3
```

#### 2. Using File Input

```bash
# Create refinement issue from requirements document
climpt-git create refinement-issue -f=requirements.md -o=./issues/

# Break down issue to tasks in detailed mode
climpt-breakdown to task --input=issue --from=github_issue_123.md --adaptation=detailed --uv-storypoint=5
```

#### 3. Combining Standard Input and File Input

```bash
# Build new tests based on bug report
cat bug_report.md | climpt-build new test --input=bug
```

#### 4. Switching Profiles

```bash
# Use architecture optimization prompts
climpt-arch optimize go -f=current_design.md

# Use setup prompts
climpt-setup climpt list
```

### Prompt File Structure

Prompt files are placed following these rules:

```
.agent/climpt/prompts/<profile>/<directive>/<layer>/f_<input>_<adaptation>.md
```

**Naming Conventions:**
- `f_default.md`: Default prompt (no `--input` or `--adaptation` specified)
- `f_<input>.md`: For specific input type (e.g., `f_code.md`)
- `f_<input>_<adaptation>.md`: Combination of input type and processing mode (e.g., `f_default_strict.md`)

**Frontmatter Example:**

```yaml
---
title: Determine new Git branch and create working branch
input_text: Specify work content within 30 characters
description: Select and create appropriate branch based on branch strategy
options:
  input: ["default"]
  adaptation: []
  input_text: true
  input_file: false
  destination_path: false
---
```

### Error Handling

- **File not found:** Check prompt file path and naming conventions
- **Permission errors:** Verify required permissions (`--allow-read`, `--allow-write`, etc.)
- **Missing configuration:** Run `climpt init` to generate `.agent/climpt/config/default-app.yml`

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

- **Command Search**: Semantic search using cosine similarity to find commands based on natural language descriptions
- **Command Details**: Retrieve complete command definitions including all options and variations
- **Dynamic Tool Loading**: Automatically loads available tools from `.agent/climpt/registry.json`
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
  "version": string,           // Registry version (e.g., "1.0.0")
  "description": string,       // Overall registry description
  "tools": {
    // Tool names array - each becomes available as climpt-{name}
    "availableConfigs": string[],  // ["git", "spec", "test", "code", "docs", "meta"]

    // Command registry - defines all available C3L commands
    "commands": [
      {
        "c1": string,         // Domain/category (git, spec, test, code, docs, meta)
        "c2": string,         // Action/directive (create, analyze, execute, etc.)
        "c3": string,         // Target/layer (refinement-issue, quality-metrics, etc.)
        "description": string,// Command description
        "usage": string,      // Usage instructions and examples
        "options": {          // Available options for this command
          "input": string[],     // Input layer type (used for prompt file selection)
          "adaptation": string[], // Prompt type (used for prompt variation selection)
          "file": boolean,  // File input support
          "stdin": boolean,       // Standard input support
          "destination": boolean  // Output destination support
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
      "code",
      "docs",
      "git",
      "meta",
      "spec",
      "test"
    ],
    "commands": [
      // Git commands
      {
        "c1": "git",
        "c2": "create",
        "c3": "refinement-issue",
        "description": "Create a refinement issue from requirements documentation",
        "usage": "Create refinement issues from requirement documents.\nExample: climpt-git create refinement-issue -f requirements.md",
        "options": {
          "input": ["default"],
          "adaptation": ["default", "detailed"],
          "file": true,
          "stdin": false,
          "destination": true
        }
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
- `version`: Registry schema version
- `description`: Overall registry description
- `availableConfigs`: Array of tool names that become available as `climpt-{name}` commands
- `commands`: Array of command definitions following C3L specification
  - `c1/c2/c3`: Command structure (domain/action/target)
  - `description`: Command purpose
  - `usage`: Usage instructions with examples
  - `options`: Available options for each command
    - `input`: Input layer type (used for prompt file selection, defaults to "default" if not specified) (e.g., ["default", "code", "bug"])
    - `adaptation`: Prompt type (used for prompt variation selection) (e.g., ["default", "detailed", "strict"])
    - `file`: Whether file input is supported (true or false)
    - `stdin`: Whether standard input is supported (true or false)
    - `destination`: Whether output destination can be specified (true or false)

**Quick Start**:
Copy the template file to your project:
```bash
cp examples/mcp/registry.template.json .agent/climpt/registry.json
```

A complete template file is available at [`examples/mcp/registry.template.json`](examples/mcp/registry.template.json)

### Available MCP Tools

The MCP server provides the following tools:

#### `search` Tool

Pass a brief description of the command you want to execute. Finds the 3 most similar commands using cosine similarity against command descriptions. You can then select the most appropriate command from the results.

**Arguments:**
- `query` (required): Brief description of what you want to do (e.g., 'commit changes to git', 'generate API documentation', 'run tests')

**Behavior:**
- Searches registry.json using `c1 + c2 + c3 + description` as the search target
- Uses cosine similarity to rank results
- Returns top 3 most similar commands
- Each result includes `c1`, `c2`, `c3`, `description`, and similarity `score`

**Example:**
```json
{
  "tool": "search",
  "arguments": {
    "query": "commit changes to git repository"
  }
}

// Response
{
  "results": [
    {
      "c1": "git",
      "c2": "group-commit",
      "c3": "unstaged-changes",
      "description": "Create a group commit for unstaged changes",
      "score": 0.338
    },
    {
      "c1": "git",
      "c2": "analyze",
      "c3": "commit-history",
      "description": "Analyze commit history and generate insights",
      "score": 0.183
    }
  ]
}
```

#### `describe` Tool

Pass the c1, c2, c3 identifiers from search results. Returns all matching command details including usage instructions and available options. You can then choose the optimal option combination for your use case.

**Arguments:**
- `c1` (required): Domain identifier from search result (e.g., git, spec, test, code, docs, meta)
- `c2` (required): Action identifier from search result (e.g., create, analyze, execute, generate)
- `c3` (required): Target identifier from search result (e.g., unstaged-changes, quality-metrics, unit-tests)

**Behavior:**
- Returns all matching records from registry.json
- Preserves complete JSON structure including usage, options, and file/stdin/destination support
- Returns multiple records if the same c1/c2/c3 exists with different option variations

**Example:**
```json
{
  "tool": "describe",
  "arguments": {
    "c1": "git",
    "c2": "group-commit",
    "c3": "unstaged-changes"
  }
}

// Response
{
  "commands": [
    {
      "c1": "git",
      "c2": "group-commit",
      "c3": "unstaged-changes",
      "description": "Create a group commit for unstaged changes",
      "usage": "Create a group commit for unstaged changes.\nExample: climpt-git group-commit unstaged-changes -f requirements.md",
      "options": {
        "input": ["default"],
        "adaptation": ["default", "detailed"],
        "file": true,
        "stdin": false,
        "destination": true
      }
    }
  ]
}
```

#### `execute` Tool

Based on the detailed information obtained from describe, pass the four required parameters: `<agent-name>`, `<c1>`, `<c2>`, `<c3>`. Also include option arguments (`-*`/`--*` format) obtained from describe. Create values for options before passing to execute. The result from execute is an instruction document - follow the obtained instructions to proceed.

**Note:** If you need STDIN support, execute the climpt command directly via CLI instead of using MCP.

**Arguments:**
- `agent` (required): Agent name from C3L specification (e.g., 'climpt', 'inspector', 'auditor'). Corresponds to the Agent-Domain model where agent is the autonomous executor.
- `c1` (required): Domain identifier from describe result (e.g., git, spec, test, code, docs, meta)
- `c2` (required): Action identifier from describe result (e.g., create, analyze, execute, generate)
- `c3` (required): Target identifier from describe result (e.g., unstaged-changes, quality-metrics, unit-tests)
- `options` (optional): Array of command-line options from describe result (e.g., `['-f=file.txt']`)

**Behavior:**
- Constructs `--config` parameter following C3L v0.5: `agent === "climpt"` ? `c1` : `agent-c1`
- Executes: `deno run jsr:@aidevtool/climpt --config=... c2 c3 [options]`
- Returns stdout, stderr, exit code, and executed command string
- The output contains instructions to follow

**Example (Basic):**
```json
{
  "tool": "execute",
  "arguments": {
    "agent": "climpt",
    "c1": "git",
    "c2": "group-commit",
    "c3": "unstaged-changes"
  }
}

// Response
{
  "success": true,
  "exitCode": 0,
  "stdout": "# Instructions for Git Group Commit...",
  "stderr": "",
  "command": "deno run jsr:@aidevtool/climpt --config=git group-commit unstaged-changes"
}
```

**Example (With Options):**
```json
{
  "tool": "execute",
  "arguments": {
    "agent": "inspector",
    "c1": "code",
    "c2": "analyze",
    "c3": "complexity",
    "options": ["-f=src/main.ts"]
  }
}

// Response
{
  "success": true,
  "exitCode": 0,
  "stdout": "# Code Analysis Instructions...",
  "stderr": "",
  "command": "deno run jsr:@aidevtool/climpt --config=inspector-code analyze complexity -f=src/main.ts"
}
```

### Running the MCP Server

You can also run the MCP server directly:

```bash
# From JSR (recommended)
deno run --allow-read --allow-write --allow-net --allow-env --allow-run jsr:@aidevtool/climpt/mcp

# Locally for development
deno run --allow-read --allow-write --allow-net --allow-env --allow-run ./src/mcp/index.ts
```

The MCP server provides AI assistants with structured access to all Climpt functionality.

## Climpt Use Cases

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

You can also install it at any hierarchy, such as under `tests/`. However, the recommended approach is to prepare multiple executables under `.deno/bin/*`, which provides better convenience for management than scattering them in various locations.

Furthermore, by placing them under `.deno/bin/*` with alternative names like `subagent-*` or `inspector-*`, you can also support Sub-Agents.

### Configuration File Structure

Climpt uses two types of configuration files:

#### app.yml (Application Configuration)

Defines the directory locations for prompts and schemas.

```yaml
# Example: .agent/climpt/config/git-app.yml
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts/git"
app_schema:
  base_dir: "schema/git"
```

#### user.yml (User Configuration)

Customizes default values and behavior for options. Particularly useful for setting `destination` prefixes.

```yaml
# Example: .agent/climpt/config/git-user.yml
options:
  destination:
    prefix: "output/git"  # Automatically prepended to paths specified with -o
```

**Configuration Priority:**
1. Command-line options (highest priority)
2. `user.yml` settings
3. `app.yml` settings
4. Default values

**Destination Prefix Behavior Example:**

```bash
# With prefix: "output/git" set in user.yml
climpt-git create issue -o=tasks/task1.md
# Actual output: output/git/tasks/task1.md

# Without prefix configuration
climpt-git create issue -o=tasks/task1.md
# Actual output: tasks/task1.md
```

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

- Deno 2.5 or later (recommended)
- Internet connection (for JSR package downloads)

> **Note:** Deno 2.x is recommended.

## License

MIT License - see LICENSE file for details.

## Contributing

This project is a wrapper around the breakdown package. For core functionality improvements, please refer to the breakdown package repository.
