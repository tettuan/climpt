/**
 * Common module exports
 */

export * from "./types.ts";
export * from "./contracts.ts";
export { deepMerge, deepMergeAll } from "./deep-merge.ts";
export { type LogEntry, Logger, type LoggerOptions } from "./logger.ts";
export {
  applyDefaults,
  getDefaults,
  loadRuntimeConfig,
  mergeConfigurations,
  resolveAgentPaths,
  type RuntimeConfig,
} from "./config.ts";
export {
  getNumberProperty,
  getProperty,
  getStringProperty,
  isArray,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isStringArray,
} from "./type-guards.ts";
