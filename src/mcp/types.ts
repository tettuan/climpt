/**
 * @fileoverview Type definitions for MCP server and shared utilities
 * @module mcp/types
 *
 * **SHARED MODULE** - Used by MCP server, mod.ts exports, and external consumers via JSR.
 *
 * @see docs/internal/registry-specification.md - Registry and Command schema definitions
 */

/**
 * Command definition loaded from registry.json
 */
export interface Command {
  /**
   * Domain identifier (first level of C3L hierarchy)
   * @example "git", "spec", "test", "code", "docs", "meta"
   */
  c1: string;

  /**
   * Action identifier (second level of C3L hierarchy)
   * @example "create", "analyze", "execute", "generate"
   */
  c2: string;

  /**
   * Target identifier (third level of C3L hierarchy)
   * @example "unstaged-changes", "quality-metrics", "unit-tests"
   */
  c3: string;

  /**
   * Human-readable description of what this command does
   */
  description: string;

  /**
   * Optional usage instructions or examples for the command
   */
  usage?: string;

  /**
   * Optional command options configuration
   */
  options?: {
    /**
     * Edition parameter names that can be provided to the command
     */
    edition?: string[];

    /**
     * Adaptation parameter names for command customization
     */
    adaptation?: string[];

    /**
     * Whether this command supports file input via -f/--from flag
     */
    file?: boolean;

    /**
     * Whether this command supports stdin input
     */
    stdin?: boolean;

    /**
     * Whether this command supports destination output via -d/--destination flag
     */
    destination?: boolean;

    /**
     * User-defined variables that can be passed via --uv-* options
     * @example { "max-line-num": "Maximum lines per file", "storypoint": "Story point estimation" }
     */
    uv?: {
      [name: string]: string;
    };
  };
}

/**
 * Search result with similarity score
 */
export interface SearchResult {
  /**
   * Domain identifier from the matched command
   */
  c1: string;

  /**
   * Action identifier from the matched command
   */
  c2: string;

  /**
   * Target identifier from the matched command
   */
  c3: string;

  /**
   * Description of the matched command
   */
  description: string;

  /**
   * Cosine similarity score (0-1) indicating relevance to search query
   * Higher scores indicate better matches
   */
  score: number;
}

/**
 * Registry structure
 */
export interface Registry {
  /**
   * Version of the registry schema
   */
  version: string;

  /**
   * Human-readable description of this registry
   */
  description: string;

  /**
   * Tools configuration and command definitions
   */
  tools: {
    /**
     * Optional array of available tool configuration names
     */
    availableConfigs?: string[];

    /**
     * Array of command definitions available in this registry
     */
    commands: Command[];
  };
}

/**
 * MCP configuration structure
 * Maps agent names to their registry.json paths
 */
export interface MCPConfig {
  /**
   * Mapping of agent names to their respective registry.json file paths
   * @example { "climpt": ".agent/climpt/registry.json", "inspector": ".agent/inspector/registry.json" }
   */
  registries: {
    /**
     * Path to the registry.json file for this agent
     */
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
