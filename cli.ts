#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

/**
 * @fileoverview CLI entry point for Climpt - AI-assisted development instruction tools
 * 
 * This module serves as the main executable entry point for the Climpt CLI tool.
 * Climpt is a wrapper around the @tettuan/breakdown package, providing a unified
 * command-line interface for AI-assisted development instruction tools.
 * 
 * The CLI enables developers to:
 * - Convert and decompose project documentation (project → issue → task)
 * - Generate summaries and overviews from unorganized information
 * - Create fix proposals from defect information and error logs
 * - Initialize and manage breakdown configurations
 * 
 * This script imports and executes the main function with command line arguments,
 * making it the primary executable for the Climpt tool when installed globally.
 * 
 * @example CLI Usage
 * ```bash
 * # Install globally
 * deno install -A -f --global climpt jsr:@aidevtool/climpt/cli
 * 
 * # Use commands
 * climpt init
 * climpt to project <input.md> -o <output_dir>
 * climpt summary project < input.md > output.md
 * ```
 * 
 * @module cli
 */

import { main } from "./src/cli.ts";

await main(Deno.args);
