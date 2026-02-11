/**
 * @fileoverview Simple logger utility for Climpt
 * @module utils/logger
 *
 * Centralizes console output for logic layers (MCP, registry, etc.)
 * to reduce scattered `deno-lint-ignore no-console` annotations.
 *
 * All output goes to stderr to avoid mixing with CLI stdout.
 * CLI user-facing output (console.log in src/cli.ts, src/init/, src/docs/)
 * remains unchanged.
 */

// deno-lint-ignore-file no-console

export const logger = {
  debug: (...args: unknown[]): void => console.error("[DEBUG]", ...args),
  info: (...args: unknown[]): void => console.error("[INFO]", ...args),
  warn: (...args: unknown[]): void => console.warn("[WARN]", ...args),
  error: (...args: unknown[]): void => console.error("[ERROR]", ...args),
};
