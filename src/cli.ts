/**
 * @fileoverview CLI module for Climpt - A wrapper around the breakdown package
 *
 * This module provides the main entry point for the Climpt CLI application,
 * which serves as a wrapper around the @tettuan/breakdown JSR package.
 *
 * @module cli
 */

// Import the breakdown package dynamically using the version from version.ts
import { BREAKDOWN_VERSION, CLIMPT_VERSION, FRONTMATTER_TO_SCHEMA_VERSION } from "./version.ts";
import { runInit } from "./init/mod.ts";

let runBreakdown: (args: string[]) => Promise<void>;

/**
 * Dynamically imports the breakdown package with the specified version.
 * This function lazily loads the breakdown module to improve startup performance
 * and ensure version consistency.
 *
 * @returns {Promise<void>} A promise that resolves when the module is loaded
 * @internal
 */
async function importBreakdown(): Promise<void> {
  const mod = await import(`jsr:@tettuan/breakdown@^${BREAKDOWN_VERSION}`);
  runBreakdown = mod.runBreakdown;
}

/**
 * Display Climpt help message
 * @internal
 */
function showHelp(): void {
  console.log(
    `Climpt v${CLIMPT_VERSION} - AI-Assisted Development Instruction Tool

A CLI wrapper around the @tettuan/breakdown JSR package for managing prompts
and AI interactions.

Usage:
  climpt [command] [options]
  climpt-<profile> <directive> <layer> [options]

Basic Commands:
  init                    Initialize breakdown configuration
  --help, -h              Show this help message
  --version, -v           Show Climpt and Breakdown version information

Command Syntax:
  climpt-<profile> <directive> <layer> [options]

  Components:
    <profile>    Profile name (e.g., git, breakdown, build)
    <directive>  Action to execute (e.g., create, analyze, trace)
    <layer>      Target layer (e.g., refinement-issue, quality-metrics)
    [options]    Various options

Options:
  Input/Output:
    -f, --from=<file>           Specify input file
    -o, --destination=<path>    Specify output destination
    (STDIN)                     Receive data from standard input

  Processing Mode:
    -e, --edition=<layer>       Specify input layer type (default: "default")
    -a, --adaptation=<type>     Specify prompt type/variation

  Custom Variables:
    --uv-<name>=<value>         Define user variables (e.g., --uv-max-line-num=100)

  System:
    --config=<prefix>           Use custom config prefix
    --help, -h                  Show this help message
    --version, -v               Show version information

Examples:
  # Initialize configuration
  climpt init

  # Create refinement issue from requirements
  climpt-git create refinement-issue -f=requirements.md -o=./issues/

  # Break down issue to tasks
  climpt-breakdown to task -e=issue -f=issue.md -a=detailed --uv-storypoint=5

  # Generate from standard input
  echo "error log" | climpt-diagnose trace stack -e=test -o=./output

MCP Server:
  Climpt supports Model Context Protocol (MCP) for AI assistant integration.
  For details: https://jsr.io/@aidevtool/climpt

Documentation:
  https://github.com/tettuan/climpt
`,
  );
}

/**
 * Main entry point for the Climpt CLI application.
 *
 * This function serves as the primary interface for executing Climpt commands.
 * It dynamically loads the breakdown package and delegates command execution
 * to the appropriate handlers.
 *
 * Climpt is a command-line interface tool that serves as a wrapper around the
 * `@tettuan/breakdown` JSR package. It provides a unified interface for AI-assisted
 * development instruction tools, enabling developers to create, manage, and execute
 * development instructions using TypeScript and JSON Schema for AI system interpretation.
 *
 * ## Features
 * - Optimized Markdown conversion prompts
 * - JSON Schema syntax for AI systems
 * - Wrapper interface for the breakdown package
 * - Support for various output formats (Markdown/JSON/YAML)
 *
 * ## Available Commands
 * - `init` - Initialize breakdown configuration
 * - `to <type> <layer>` - Convert input Markdown to next layer format
 * - `summary <type>` - Generate new Markdown or specified layer Markdown
 * - `defect <type>` - Generate fixes from error logs or defect information
 * - `--version` or `-v` - Show Climpt and Breakdown version information
 * - `--help` - Show help message
 * - `version` - Show version information
 * - `help` - Show help message
 *
 * ## Command Examples
 * ### Project Decomposition
 * ```bash
 * climpt to project <written_project_summary.md> -o <project_dir>
 * ```
 *
 * ### Issue Decomposition
 * ```bash
 * climpt to issue <project_summary.md|written_issue.md> -o <issue_dir>
 * ```
 *
 * ### Task Decomposition
 * ```bash
 * climpt to task <issue.md|written_task.md> -o <tasks_dir>
 * ```
 *
 * ### Summary Generation
 * ```bash
 * echo "<messy_something>" | climpt summary project -o <project_summary.md>
 * climpt summary issue --from=<aggregated_tasks.md> --edition=task -o=<issue_markdown_dir>
 * climpt summary task --from=<unorganized_tasks.md> -o=<task_markdown_dir>
 * ```
 *
 * ### Defect Analysis
 * ```bash
 * tail -100 "<error_log_file>" | climpt defect project -o <project_defect.md>
 * climpt defect issue --from=<bug_report.md> -o=<issue_defect_dir>
 * climpt defect task --from=<improvement_request.md> -o=<task_defect_dir>
 * ```
 *
 * ## Use Case Patterns
 * ### From Unorganized Information to Project Implementation
 * ```bash
 * echo "<messy_something>" | climpt summary project -o <project_summary.md>
 * climpt to project <project_summary.md> -o <project_dir>
 * climpt to issue <project_summary.md> -o <issue_dir>
 * climpt to task <issue.md> -o <tasks_dir>
 * ```
 *
 * ### Creating Issues from Task Groups
 * ```bash
 * climpt summary issue --from=<aggregated_tasks.md> --edition=task -o=<issue_markdown_dir>
 * climpt to task <issue.md> -o <tasks_dir>
 * ```
 *
 * ## Installation
 * ```bash
 * deno install -A -f --global climpt jsr:@aidevtool/climpt
 * ```
 *
 * ## Design Philosophy
 * This tool is designed to work in conjunction with AI Coding agents, specifically
 * optimized for Cursor. The underlying AI model is assumed to be Claude-4-sonnet,
 * though the syntax and structure are designed to be easily interpretable by other AI models.
 *
 * The purpose is to provide a standardized way to express development requirements,
 * bridging the gap between human-written specifications and AI-interpretable instructions.
 *
 * @param _args - Command line arguments passed to the CLI
 * @returns Promise that resolves when the command execution is complete
 *
 * @example
 * ```typescript
 * import { main } from "./cli.ts";
 *
 * // Execute with command line arguments
 * await main(["init"]);
 * await main(["to", "project", "--config=custom"]);
 * await main(["summary", "project", "-o", "output.md"]);
 * await main(["--help"]);
 * ```
 */
export async function main(_args: string[] = []): Promise<void> {
  try {
    // Handle help argument
    if (_args.includes("-h") || _args.includes("--help")) {
      showHelp();
      return;
    }

    // Handle version argument
    if (_args.includes("-v") || _args.includes("--version")) {
      console.log(`Climpt v${CLIMPT_VERSION}`);
      console.log(`├── Breakdown v${BREAKDOWN_VERSION}`);
      console.log(`└── FrontmatterToSchema v${FRONTMATTER_TO_SCHEMA_VERSION}`);
      return;
    }

    // Handle init command - Climpt native implementation
    if (_args[0] === "init") {
      const result = await runInit(_args.slice(1));
      if (!result.success) {
        Deno.exit(1);
      }
      return;
    }

    if (!runBreakdown) {
      await importBreakdown();
    }
    // Call the runBreakdown function with arguments
    await runBreakdown(_args);
  } catch (error) {
    console.error("Failed to execute:", error);
    Deno.exit(1);
  }
}
