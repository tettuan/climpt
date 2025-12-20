/**
 * @fileoverview Registry loading utilities for Climpt Agent plugin
 * @module climpt-plugins/climpt-agent/lib/registry
 *
 * Independent implementation for plugin use.
 * Follows the same specification as MCP server implementation.
 *
 * @see docs/internal/registry-specification.md - MCPConfig and registry file paths
 * @see docs/internal/command-operations.md - Registry loading specification
 */

import type { Command, MCPConfig, Registry } from "./types.ts";
import { DEFAULT_MCP_CONFIG } from "./types.ts";

/**
 * Load MCP configuration from known paths.
 *
 * Search order:
 * 1. `.agent/climpt/mcp/config.json` (project-specific)
 * 2. `~/.agent/climpt/mcp/config.json` (user-specific)
 *
 * If not found, creates default configuration in project directory.
 *
 * @see docs/internal/command-operations.md#registry-loading
 *
 * @returns Loaded config or default config
 */
export async function loadMCPConfig(): Promise<MCPConfig> {
  const configPaths = [
    ".agent/climpt/mcp/config.json",
    `${
      Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ""
    }/.agent/climpt/mcp/config.json`,
  ];

  // Try to load existing config
  for (const configPath of configPaths) {
    try {
      const configText = await Deno.readTextFile(configPath);
      const config = JSON.parse(configText) as MCPConfig;
      return config;
    } catch {
      // Continue to next path
    }
  }

  // Create default config if not found
  const defaultConfigPath = ".agent/climpt/mcp/config.json";
  try {
    await Deno.mkdir(".agent/climpt/mcp", { recursive: true });
    await Deno.writeTextFile(
      defaultConfigPath,
      JSON.stringify(DEFAULT_MCP_CONFIG, null, 2),
    );
  } catch {
    // Silent failure - caller can handle errors
  }

  return DEFAULT_MCP_CONFIG;
}

/**
 * Load command registry for a specific agent.
 *
 * Search order:
 * 1. Registry path from current directory
 * 2. Registry path from user home directory
 *
 * @see docs/internal/command-operations.md#registry-loading
 *
 * @param config - MCP configuration containing registry paths
 * @param agentName - Name of the agent whose registry to load
 * @returns Array of commands for the agent
 */
export async function loadRegistryForAgent(
  config: MCPConfig,
  agentName: string,
): Promise<Command[]> {
  const registryPath = config.registries[agentName];
  if (!registryPath) {
    return [];
  }

  try {
    let configText: string;

    try {
      configText = await Deno.readTextFile(registryPath);
    } catch {
      // If not found in current directory, try user's home directory
      const homeDir = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
      const homePath = `${homeDir}/${registryPath}`;
      configText = await Deno.readTextFile(homePath);
    }

    const registry: Registry = JSON.parse(configText);
    const commands = registry.tools?.commands || [];

    return commands;
  } catch {
    return [];
  }
}
