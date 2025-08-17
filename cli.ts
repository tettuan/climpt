#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

/**
 * @module
 * CLI entry point for Climpt - AI-assisted development instruction tools
 *
 * This module serves as the main executable entry point for the Climpt CLI tool.
 * Climpt is a wrapper around the @tettuan/breakdown package, providing a unified
 * command-line interface for AI-assisted development instruction tools.
 *
 * ## Features
 *
 * - Convert and decompose project documentation (project → issue → task)
 * - Generate summaries and overviews from unorganized information
 * - Create fix proposals from defect information and error logs
 * - Initialize and manage breakdown configurations
 * - Support for multiple output formats (markdown, JSON, YAML)
 * - Configurable through environment variables and config files
 *
 * ## Installation
 *
 * Install globally via JSR:
 *
 * ```bash
 * deno install --allow-read --allow-write --allow-net --allow-env \
 *   --global climpt jsr:@aidevtool/climpt/cli
 * ```
 *
 * ## Usage
 *
 * ### Basic Commands
 *
 * ```bash
 * # Initialize configuration
 * climpt init
 *
 * # Convert project documentation to issues
 * climpt breakdown project -f input.md -o output_dir
 *
 * # Generate summary from input
 * climpt breakdown summary < input.md > output.md
 *
 * # Create fix proposal from error log
 * echo "Error: undefined variable" | climpt breakdown defect
 * ```
 *
 * ### With Configuration
 *
 * ```bash
 * # Use specific configuration
 * climpt --config=git status
 *
 * # Use custom climpt commands
 * climpt-git create refinement-issue -f ./docs/requirements.md
 * climpt-spec analyze quality-metrics -f ./docs/spec.md -o ./report.md
 * ```
 *
 * ## Command Structure
 *
 * Climpt follows a c1/c2/c3 command structure:
 * - **c1**: Tool category (git, spec, test, etc.)
 * - **c2**: Action/directive (create, analyze, execute)
 * - **c3**: Target/layer (refinement-issue, quality-metrics, etc.)
 *
 * @example
 * ```typescript
 * // Programmatic usage
 * import { main } from "jsr:@aidevtool/climpt/cli";
 *
 * await main(["breakdown", "project", "-f", "input.md"]);
 * ```
 */

import { main } from "./src/cli.ts";

await main(Deno.args);
