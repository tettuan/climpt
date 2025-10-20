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
