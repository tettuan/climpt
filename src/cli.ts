/**
 * @fileoverview CLI module for Climpt - A wrapper around the breakdown package
 * 
 * This module provides the main entry point for the Climpt CLI application,
 * which serves as a wrapper around the @tettuan/breakdown JSR package.
 * 
 * @module cli
 */

// Import the breakdown package statically
import { runBreakdown } from "jsr:@tettuan/breakdown@^1.2.0";

/**
 * Main entry point for the Climpt CLI application.
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
 * climpt summary issue --from=<aggregated_tasks.md> --input=task -o=<issue_markdown_dir>
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
 * climpt summary issue --from=<aggregated_tasks.md> --input=task -o=<issue_markdown_dir>
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
    // Call the runBreakdown function with arguments
    await runBreakdown(_args);
  } catch (error) {
    console.error("Failed to execute breakdown:", error);
    Deno.exit(1);
  }
}
