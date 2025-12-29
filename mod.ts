/**
 * @fileoverview Climpt - CLI tool for AI-assisted development instructions
 * @module
 *
 * Wrapper CLI around @tettuan/breakdown package.
 *
 * **MCP utilities are SHARED** - Also used by MCP server and external consumers via JSR.
 */

// Export main CLI functionality
export { main } from "./src/cli.ts";

// Export MCP utilities for shared use
export {
  describeCommand,
  searchCommands,
  searchWithRRF,
} from "./src/mcp/similarity.ts";
export type { RRFResult } from "./src/mcp/similarity.ts";
export type {
  Command,
  MCPConfig,
  Registry,
  SearchResult,
} from "./src/mcp/types.ts";
export { DEFAULT_MCP_CONFIG } from "./src/mcp/types.ts";

// Export registry loading utilities
export { loadMCPConfig, loadRegistryForAgent } from "./src/mcp/registry.ts";

// Execute main function when mod.ts is run directly
if (import.meta.main) {
  const { main } = await import("./src/cli.ts");
  await main(Deno.args);
}
