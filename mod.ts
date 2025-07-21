/**
 * @fileoverview Climpt - A CLI tool for managing prompts and AI interactions
 * 
 * Climpt is a comprehensive wrapper CLI tool around the breakdown package (@tettuan/breakdown),
 * providing a unified interface for AI-assisted development instruction tools.
 * It enables developers to create, manage, and execute development instructions
 * using TypeScript and JSON Schema for AI system interpretation.
 * 
 * ## Key Features
 * - **Project Decomposition**: Convert high-level project descriptions into structured issues and tasks
 * - **Summary Generation**: Create organized documentation from unstructured information
 * - **Defect Analysis**: Generate fix proposals from error logs and defect reports
 * - **AI-Optimized**: Designed for integration with AI coding assistants like Cursor and Claude
 * - **Type-Safe**: Built with TypeScript and JSON Schema for reliable AI interpretation
 * 
 * ## Main Functionality
 * This module exports the core `main` function which serves as the primary entry point
 * for all CLI operations. The function accepts command-line arguments and delegates
 * execution to the appropriate breakdown package functionality.
 * 
 * ## Usage Patterns
 * 
 * ### As a Library
 * ```typescript
 * import { main } from "jsr:@aidevtool/climpt";
 * 
 * // Execute CLI commands programmatically
 * await main(["init"]);
 * await main(["to", "project", "input.md", "-o", "output/"]);
 * await main(["summary", "task", "--from=tasks.md", "-o=summary.md"]);
 * ```
 * 
 * ### As a CLI Tool
 * ```bash
 * # Install globally
 * deno install -A -f --global climpt jsr:@aidevtool/climpt
 * 
 * # Use commands
 * climpt init
 * climpt to project <input.md> -o <output_dir>
 * climpt defect task --from=<bug_report.md> -o=<fix_tasks_dir>
 * ```
 * 
 * ## Architecture
 * Climpt maintains a minimal wrapper architecture, ensuring that all core functionality
 * remains in the breakdown package while providing a convenient CLI interface.
 * This design allows for easy updates and maintains consistency with the underlying
 * breakdown tools.
 * 
 * @module
 */

// Export main CLI functionality
export { main } from "./src/cli.ts";
