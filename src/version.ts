/**
 * @fileoverview Version configuration module for Climpt CLI
 *
 * This module exports version constants for both Climpt CLI and the
 * breakdown package dependency.
 *
 * @module version
 */

/**
 * Version of the Climpt CLI wrapper.
 *
 * This version should match the version specified in deno.json.
 * When updating the version, make sure to update both:
 * 1. This CLIMPT_VERSION constant
 * 2. The "version" field in deno.json
 *
 * @constant {string}
 * @example
 * ```typescript
 * import { CLIMPT_VERSION } from "./version.ts";
 * console.log(`Climpt version: ${CLIMPT_VERSION}`);
 * ```
 */
export const CLIMPT_VERSION = "1.9.14";

/**
 * Version of the breakdown package to use.
 *
 * This specifies which version of {@link https://jsr.io/@tettuan/breakdown | @tettuan/breakdown}
 * JSR package should be imported and used by the Climpt CLI.
 *
 * @constant {string}
 * @example
 * ```typescript
 * import { BREAKDOWN_VERSION } from "./version.ts";
 * const mod = await import(`jsr:@tettuan/breakdown@^${BREAKDOWN_VERSION}`);
 * ```
 */
export const BREAKDOWN_VERSION = "1.7.0";

/**
 * Version of the frontmatter-to-schema package to use.
 *
 * This specifies which version of {@link https://jsr.io/@aidevtool/frontmatter-to-schema | @aidevtool/frontmatter-to-schema}
 * JSR package is used for registry generation.
 *
 * @constant {string}
 */
export const FRONTMATTER_TO_SCHEMA_VERSION = "1.7.1";
