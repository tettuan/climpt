/**
 * @fileoverview Type definitions for MCP server
 * @module mcp/types
 */

/**
 * Command definition loaded from registry.json
 */
export interface Command {
  c1: string;
  c2: string;
  c3: string;
  description: string;
  usage?: string;
  options?: {
    input?: string[];
    adaptation?: string[];
    file?: boolean;
    stdin?: boolean;
    destination?: boolean;
  };
}

/**
 * Search result with similarity score
 */
export interface SearchResult {
  c1: string;
  c2: string;
  c3: string;
  description: string;
  score: number;
}

/**
 * Registry structure
 */
export interface Registry {
  version: string;
  description: string;
  tools: {
    availableConfigs?: string[];
    commands: Command[];
  };
}

/**
 * MCP configuration structure
 * Maps agent names to their registry.json paths
 */
export interface MCPConfig {
  registries: {
    [agentName: string]: string;
  };
}

/**
 * Default MCP configuration
 */
export const DEFAULT_MCP_CONFIG: MCPConfig = {
  registries: {
    "climpt": ".agent/climpt/registry.json",
  },
};
