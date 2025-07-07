# Climpt

A CLI tool for managing prompts and AI interactions - a wrapper around the breakdown package.

## Overview

Climpt is a command-line interface tool that serves as a wrapper around the `@tettuan/breakdown` JSR package. It provides a unified interface for AI-assisted development instruction tools, enabling developers to create, manage, and execute development instructions using TypeScript and JSON Schema for AI system interpretation.

This tool is designed to work in conjunction with AI Coding agents, specifically optimized for Cursor (the author's primary tool). The underlying AI model is assumed to be Claude-4-sonnet, though the syntax and structure are designed to be easily interpretable by other AI models.

## Installation

### Recommended: Install as CLI

Climpt is primarily designed to be used as a CLI tool. You can install it using the official Deno/JSR method:

```bash
deno install -A -f --global climpt jsr:@aidevtool/climpt
```

- `-A`: Allow all permissions (recommended)
- `-f`: Force overwrite existing command
- `--global`: Install globally
- `climpt`: Command name

> **Note:**  
> The CLI module must be specified as `jsr:@aidevtool/climpt`.  
> This is based on the `exports` configuration in `deno.json`.

## Usage

Once installed, you can use climpt commands directly:

```bash
climpt --help
climpt init
climpt to project --config=custom
```

Climpt provides access to all breakdown package functionality through a simple wrapper interface.
## Key Features

- Optimized Markdown conversion prompts
- JSON Schema syntax for AI systems
- Wrapper interface for the breakdown package
- Support for various output formats (Markdown/JSON/YAML)

## Purpose

To provide a standardized way to express development requirements, bridging the gap between human-written specifications and AI-interpretable instructions.

## Process Overview

This tool itself does not generate documents based on rules. It supports AI document generation by providing prompts and structured formats that are easy for AI to interpret and handle.

## Available Commands

The Climpt tool provides access to the following main commands from the breakdown package:

| Command | Description                                                | Project                              | Issue                      | Task                       |
| ------- | ---------------------------------------------------------- | ------------------------------------ | -------------------------- | -------------------------- |
| to      | Convert input Markdown to next layer format               | Decompose to project                 | Decompose project to issue | Decompose issue to task    |
| summary | Generate new Markdown or specified layer Markdown         | Generate project overview           | Generate issue overview    | Generate task overview     |
| defect  | Generate fixes from error logs or defect information      | Generate project info from defects  | Generate issue from defects| Generate task from defects |

### Project Decomposition

```bash
climpt to project <written_project_summary.md> -o <project_dir>
```

### Issue Decomposition

```bash
climpt to issue <project_summary.md|written_issue.md> -o <issue_dir>
```

### Task Decomposition

```bash
climpt to task <issue.md|written_task.md> -o <tasks_dir>
```

### Markdown Summary Generation

**Project Summary** - Generate project overview from unorganized information:

```bash
echo "<messy_something>" | climpt summary project -o <project_summary.md>
```

**Issue Summary** - Generate issue from task groups:

```bash
climpt summary issue --from=<aggregated_tasks.md> --input=task -o=<issue_markdown_dir>
```

**Task Summary** - Generate organized tasks from unorganized task information:

```bash
climpt summary task --from=<unorganized_tasks.md> -o=<task_markdown_dir>
```

### Fix Generation from Defect Information

**Project-level defect analysis**

```bash
tail -100 "<error_log_file>" | climpt defect project -o <project_defect.md>
```

**Issue-level defect analysis**

```bash
climpt defect issue --from=<bug_report.md> -o=<issue_defect_dir>
```

**Task-level defect analysis**

```bash
climpt defect task --from=<improvement_request.md> -o=<task_defect_dir>
```

## Use Case Patterns

### 1. From Unorganized Information to Project Implementation

```bash
echo "<messy_something>" | climpt summary project -o <project_summary.md>
climpt to project <project_summary.md> -o <project_dir>
climpt to issue <project_summary.md> -o <issue_dir>
climpt to task <issue.md> -o <tasks_dir>
```

### 2. Creating Issues from Task Groups

```bash
climpt summary issue --from=<aggregated_tasks.md> --input=task -o=<issue_markdown_dir>
# Edit generated issues as needed
climpt to task <issue.md> -o <tasks_dir>
```

### 3. Generating Fix Tasks from Defect Information

```bash
tail -100 "<error_log_file>" | climpt defect project -o <project_defect.md>
climpt defect issue --from=<project_defect.md> -o=<issue_defect_dir>
climpt defect task --from=<issue_defect.md> -o=<task_defect_dir>
```

### 4. Creating Fix Proposals from Improvement Requests

```bash
climpt defect task --from=<improvement_request.md> -o=<task_defect_dir>
```

## Setup

### Update

To update to the latest version, simply run the same installation command again:

```bash
deno install -A -f --global climpt jsr:@aidevtool/climpt
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
- Deno 1.40 or later is recommended.
- For detailed usage instructions, refer to the "Usage" section above.

### Local Installation to Project Directory

If you want to use the climpt command only within a specific project, you can install it to `.deno/bin` using the `--root` option:

```bash
deno install -A -f --global --root .deno -n climpt jsr:@aidevtool/climpt
```

After installation, add the bin directory to your PATH:

```bash
export PATH="$(pwd)/.deno/bin:$PATH"
```

To make this setting persistent, add it to your shell configuration file (e.g., `~/.zshrc` or `~/.bashrc`).

## Architecture

Climpt is designed as a lightweight wrapper around the `@tettuan/breakdown` package, providing a unified CLI interface while maintaining all the functionality of the underlying breakdown tools.

## Requirements

- Deno 1.40 or later
- Internet connection (for JSR package downloads)

## License

MIT License - see LICENSE file for details.

## Contributing

This project is a wrapper around the breakdown package. For core functionality improvements, please refer to the breakdown package repository.
