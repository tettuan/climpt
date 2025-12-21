/**
 * @fileoverview Shared registry loading utilities
 * @module mcp/registry
 *
 * **SHARED MODULE** - Used by MCP server, mod.ts exports, and external consumers via JSR.
 *
 * @see docs/internal/registry-specification.md - MCPConfig and registry file paths
 * @see docs/internal/command-operations.md - Registry loading specification
 */

import type { Command, MCPConfig, Registry } from "./types.ts";
import { DEFAULT_MCP_CONFIG } from "./types.ts";

/**
 * Load or create MCP configuration from known paths.
 *
 * Attempts to load configuration from:
 * 1. `.agent/climpt/config/registry_config.json` (project-specific)
 * 2. `~/.agent/climpt/config/registry_config.json` (user-specific)
 *
 * If no configuration file is found, creates a default configuration
 * in the project directory.
 *
 * @returns Promise that resolves to loaded config or default config
 */
export async function loadMCPConfig(): Promise<MCPConfig> {
  const configPaths = [
    ".agent/climpt/config/registry_config.json",
    `${
      Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ""
    }/.agent/climpt/config/registry_config.json`,
  ];

  // Try to load existing config
  for (const configPath of configPaths) {
    try {
      const configText = await Deno.readTextFile(configPath);
      const config = JSON.parse(configText) as MCPConfig;
      console.error(`⚙️ Loaded MCP config from ${configPath}`);
      return config;
    } catch {
      // Continue to next path
    }
  }

  // Create default config if not found
  const defaultConfigPath = ".agent/climpt/config/registry_config.json";
  try {
    await Deno.mkdir(".agent/climpt/config", { recursive: true });
    await Deno.writeTextFile(
      defaultConfigPath,
      JSON.stringify(DEFAULT_MCP_CONFIG, null, 2),
    );
    console.error(`✨ Created default MCP config at ${defaultConfigPath}`);
  } catch (error) {
    console.error("⚠️ Failed to create MCP config:", error);
  }

  return DEFAULT_MCP_CONFIG;
}

/**
 * Load command registry for a specific agent.
 *
 * Loads command definitions from the registry file specified
 * in the MCP configuration. Attempts to load from both the current
 * directory and the user's home directory.
 *
 * @param config - MCP configuration containing registry paths
 * @param agentName - Name of the agent whose registry to load
 * @returns Promise that resolves to an array of commands for the agent
 */
export async function loadRegistryForAgent(
  config: MCPConfig,
  agentName: string,
): Promise<Command[]> {
  const registryPath = config.registries[agentName];
  if (!registryPath) {
    console.error(`⚠️ No registry path configured for agent: ${agentName}`);
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

    console.error(
      `⚙️ Loaded ${commands.length} commands for agent '${agentName}'`,
    );
    return commands;
  } catch (error) {
    console.error(
      `⚠️ Failed to load registry for agent '${agentName}':`,
      error,
    );
    return [];
  }
}
