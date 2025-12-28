/**
 * @fileoverview Type definitions for Climpt Agent plugin
 * @module climpt-plugins/climpt-agent/lib/types
 *
 * Independent implementation for plugin use.
 * Follows the same specification as MCP server implementation.
 *
 * @see docs/internal/registry-specification.md - Registry and Command schema definitions
 */

/**
 * User variable definition from registry
 * Maps variable name to description
 */
export interface UserVariable {
  [key: string]: string;
}

/**
 * Command definition loaded from registry.json
 *
 * @see docs/internal/registry-specification.md#command-スキーマ
 */
export interface Command {
  /** Domain identifier (C3L level 1) */
  c1: string;

  /** Action identifier (C3L level 2) */
  c2: string;

  /** Target identifier (C3L level 3) */
  c3: string;

  /** Human-readable description */
  description: string;

  /** Usage instructions (optional) */
  usage?: string;

  /** Command options (optional) */
  options?: {
    edition?: string[];
    adaptation?: string[];
    file?: boolean;
    stdin?: boolean;
    destination?: boolean;
  };

  /**
   * User variables (uv-*) array
   * Each item maps a variable name to its description
   * Used for {uv-*} template expansion in instructions
   */
  uv?: UserVariable[];
}

/**
 * Search result with similarity score
 *
 * @see docs/internal/command-operations.md#結果フォーマット
 */
export interface SearchResult {
  c1: string;
  c2: string;
  c3: string;
  description: string;
  /** Cosine similarity score (0-1) */
  score: number;
}

/**
 * Registry structure
 *
 * @see docs/internal/registry-specification.md#registry-スキーマ
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
 *
 * @see docs/internal/registry-specification.md#mcp-config
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
    climpt: ".agent/climpt/registry.json",
  },
};
