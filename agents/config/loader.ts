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

import { ConfigService } from "../shared/config-service.ts";

/**
 * Error thrown when configuration loading fails - canonical source: shared/errors/env-errors.ts
 */
import { ConfigurationLoadError } from "../shared/errors/env-errors.ts";
export { ConfigurationLoadError };

/** Shared ConfigService instance */
const configService = new ConfigService();

/**
 * Load agent definition from a directory.
 * Does NOT validate or apply defaults.
 *
 * @param agentDir - Path to the agent directory
 * @returns Raw JSON content (unvalidated)
 * @throws ConfigurationLoadError if file not found, invalid JSON, or read error
 */
export async function loadRaw(agentDir: string): Promise<unknown> {
  return await configService.loadAgentDefinitionRaw(agentDir);
}

/**
 * Load steps registry from a directory.
 *
 * @param agentDir - Path to the agent directory
 * @returns Raw registry JSON or null if not found (registry is optional)
 * @throws ConfigurationLoadError if file exists but cannot be read/parsed
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
