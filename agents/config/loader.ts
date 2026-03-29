/**
 * Configuration Loader - Load Configuration Files
 *
 * Responsibility: Load and parse agent.json only
 * Side effects: File reads
 *
 * Delegates to ConfigService for actual file operations.
 *
 * @pre path is an existing directory
 * @post return value is an unvalidated AgentDefinition
 */

import { join } from "@std/path";
import { ConfigService } from "../shared/config-service.ts";
import { PATHS } from "../shared/paths.ts";

/** Shared ConfigService instance */
const configService = new ConfigService();

/**
 * Load agent definition from a directory.
 * Does NOT validate or apply defaults.
 *
 * @param agentDir - Path to the agent directory
 * @returns Raw JSON content (unvalidated)
 * @throws ConfigError (AC-SERVICE-*) if file not found, invalid JSON, or read error
 */
export async function loadRaw(agentDir: string): Promise<unknown> {
  return await configService.loadAgentDefinitionRaw(agentDir);
}

/**
 * Load steps registry from a directory.
 *
 * @param agentDir - Path to the agent directory
 * @returns Raw registry JSON or null if not found (registry is optional)
 * @throws ConfigError (AC-SERVICE-004) if file exists but cannot be read/parsed
 */
export async function loadStepsRegistry(agentDir: string): Promise<unknown> {
  return await configService.loadStepsRegistry(agentDir);
}

/**
 * Get agent directory path.
 *
 * @param agentName - Name of the agent
 * @param baseDir - Base directory containing .agent folder
 * @returns Full path to agent directory
 */
export function getAgentDir(agentName: string, baseDir: string): string {
  return configService.getAgentDir(agentName, baseDir);
}

/**
 * Check if an agent exists (has agent.json).
 *
 * @param agentName - Name of the agent
 * @param cwd - Working directory
 * @returns true if agent.json exists
 */
export async function agentExists(
  agentName: string,
  cwd: string = Deno.cwd(),
): Promise<boolean> {
  const agentDir = getAgentDir(agentName, cwd);
  const definitionPath = join(agentDir, PATHS.AGENT_JSON);

  try {
    await Deno.stat(definitionPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all available agents (directories with agent.json).
 *
 * @param cwd - Working directory
 * @returns Sorted list of agent names
 */
export async function listAgents(cwd: string = Deno.cwd()): Promise<string[]> {
  const agentsDir = join(cwd, PATHS.AGENT_DIR_PREFIX);
  const agents: string[] = [];

  try {
    for await (const entry of Deno.readDir(agentsDir)) {
      if (entry.isDirectory) {
        const definitionPath = join(agentsDir, entry.name, PATHS.AGENT_JSON);
        try {
          await Deno.stat(definitionPath);
          agents.push(entry.name);
        } catch {
          // Not a valid agent directory
        }
      }
    }
  } catch {
    // .agent directory doesn't exist
  }

  return agents.sort();
}
