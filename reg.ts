#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

/**
 * @module
 * Registry Generation CLI for Climpt
 *
 * This module generates registry.json from prompt frontmatter using
 * @aidevtool/frontmatter-to-schema.
 *
 * ## Usage
 *
 * ### Via JSR (recommended)
 *
 * ```bash
 * deno run --allow-read --allow-write --allow-env jsr:@aidevtool/climpt/reg
 * ```
 *
 * ### With Options
 *
 * ```bash
 * deno run --allow-read --allow-write --allow-env jsr:@aidevtool/climpt/reg \
 *   --output=./custom-registry.json
 * ```
 *
 * ## Options
 *
 * - `--base=<dir>` - Base directory (default: current directory)
 * - `--schema=<path>` - Schema file path
 * - `--input=<pattern>` - Input glob pattern
 * - `--output=<path>` - Output file path
 * - `--template=<path>` - Template file path
 *
 * ## Default Paths
 *
 * When run from project root, uses these defaults:
 * - Schema: .agent/climpt/frontmatter-to-schema/registry.schema.json
 * - Input: .agent/climpt/prompts/**\/*.md
 * - Output: .agent/climpt/registry.json
 * - Template: .agent/climpt/frontmatter-to-schema/registry.template.json
 *
 * @example
 * ```typescript
 * import { generateRegistry } from "jsr:@aidevtool/climpt/reg";
 *
 * const result = await generateRegistry({
 *   output: "./custom-registry.json"
 * });
 * console.log(`Processed ${result.processedDocuments} documents`);
 * ```
 */

import { main } from "./src/reg/index.ts";

export { generateRegistry } from "./src/reg/index.ts";
export type { GenerateOptions } from "./src/reg/index.ts";

if (import.meta.main) {
  await main();
}
