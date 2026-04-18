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
export const CLIMPT_VERSION = "1.13.26";

/**
 * Version of the breakdown package to use.
 *
 * This specifies which version of {@link https://jsr.io/@tettuan/breakdown | @tettuan/breakdown}
 * JSR package should be imported and used by the Climpt CLI.
 *
 * Pinned exact (no caret) — breakdown 1.8.5 changed the runBreakdown
 * Result shape from `Result<string, string>` to
 * `Result<string | undefined, BreakdownError>`, which silently broke the
 * c3l-prompt-loader's typecast and caused the continuation.polling
 * PR-C3L-004 regression (see tmp/label-bootstrap-failure/investigation/
 * T5a-resolver-rootcause.md). Do not change to a caret range without
 * widening the loader to handle both shapes.
 *
 * @constant {string}
 * @example
 * ```typescript
 * import { BREAKDOWN_VERSION } from "./version.ts";
 * const mod = await import(`jsr:@tettuan/breakdown@${BREAKDOWN_VERSION}`);
 * ```
 */
export const BREAKDOWN_VERSION = "1.8.4";

/**
 * Version of the frontmatter-to-schema package to use.
 *
 * This specifies which version of {@link https://jsr.io/@aidevtool/frontmatter-to-schema | @aidevtool/frontmatter-to-schema}
 * JSR package is used for registry generation.
 *
 * @constant {string}
 */
export const FRONTMATTER_TO_SCHEMA_VERSION = "1.7.3";
