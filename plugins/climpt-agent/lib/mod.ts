/**
 * @fileoverview Climpt Agent plugin library exports
 * @module climpt-plugins/climpt-agent/lib
 *
 * Self-contained implementation for plugin use.
 * Specifications are shared with MCP server via documentation.
 *
 * @see docs/internal/registry-specification.md
 * @see docs/internal/command-operations.md
 */

export type {
  Command,
  MCPConfig,
  Registry,
  SearchResult,
  UserVariable,
} from "./types.ts";
export { DEFAULT_MCP_CONFIG } from "./types.ts";

export {
  describeCommand,
  searchCommands,
  searchWithRRF,
} from "./similarity.ts";
export type { RRFResult } from "./similarity.ts";

export { loadMCPConfig, loadRegistryForAgent } from "./registry.ts";
