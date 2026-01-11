#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env
/**
 * Generate registry.json from prompt frontmatter
 *
 * Uses @aidevtool/frontmatter-to-schema transformFiles API
 * for programmatic control over the generation process.
 *
 * Usage:
 *   deno task generate-registry
 *   deno run --allow-read --allow-write --allow-env scripts/generate-registry.ts
 */

import { transformFiles } from "@aidevtool/frontmatter-to-schema";

const baseDir = Deno.cwd();
const SCHEMA_PATH =
  `${baseDir}/.agent/climpt/frontmatter-to-schema/registry.schema.json`;
const INPUT_PATTERN = `${baseDir}/.agent/climpt/prompts/**/*.md`;
const OUTPUT_PATH = `${baseDir}/.agent/climpt/registry.json`;

// deno-lint-ignore no-console
console.log("Generating registry.json from prompt frontmatter...");
// deno-lint-ignore no-console
console.log(`  Schema: ${SCHEMA_PATH}`);
// deno-lint-ignore no-console
console.log(`  Input: ${INPUT_PATTERN}`);
// deno-lint-ignore no-console
console.log(`  Output: ${OUTPUT_PATH}`);

const TEMPLATE_PATH =
  `${baseDir}/.agent/climpt/frontmatter-to-schema/registry.template.json`;

const result = await transformFiles({
  schema: SCHEMA_PATH,
  input: INPUT_PATTERN,
  output: OUTPUT_PATH,
  template: TEMPLATE_PATH,
});

if (result.isOk()) {
  const { processedDocuments, outputPath, executionTime } = result.unwrap();
  // deno-lint-ignore no-console
  console.log(`\nSuccess! Generated registry.json`);
  // deno-lint-ignore no-console
  console.log(`  Processed: ${processedDocuments} documents`);
  // deno-lint-ignore no-console
  console.log(`  Output: ${outputPath}`);
  // deno-lint-ignore no-console
  console.log(`  Time: ${executionTime}ms`);
} else {
  // deno-lint-ignore no-console
  console.error(`\nError:`, result);
  Deno.exit(1);
}
