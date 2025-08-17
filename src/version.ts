/**
 * @fileoverview Version configuration module for Climpt CLI
 *
 * This module exports version constants for both Climpt CLI and the
 * breakdown package dependency.
 *
 * @module version
 */

/**
 * Version of the Climpt CLI wrapper
 *
 * This version should match the version specified in deno.json.
 * When updating the version, make sure to update both:
 * 1. This CLIMPT_VERSION constant
 * 2. The "version" field in deno.json
 */
export const CLIMPT_VERSION = "1.5.0";

/**
 * Version of the breakdown package to use
 *
 * This specifies which version of @tettuan/breakdown JSR package
 * should be imported and used by the Climpt CLI.
 */
export const BREAKDOWN_VERSION = "1.4.1";
