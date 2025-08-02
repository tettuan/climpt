/**
 * @fileoverview Version configuration module for Climpt CLI
 *
 * This module exports the VERSION constant used throughout the application
 * to maintain consistency with the breakdown package version.
 *
 * @module version
 */

/**
 * Version configuration for Climpt CLI
 *
 * This version should match the version specified in deno.json.
 * When updating the version, make sure to update both:
 * 1. This VERSION constant
 * 2. The "version" field in deno.json
 *
 * This ensures consistency between the breakdown package version
 * and the climpt wrapper version.
 */
export const VERSION = "1.3.4";
