/**
 * Configuration Loader - Load Configuration Files
 *
 * Responsibility: Load and parse agent.json only
 * Side effects: File reads
 *
 * @pre path is an existing directory
 * @post return value is an unvalidated AgentDefinition
 */

import { join } from "@std/path";

/**
 * Error thrown when configuration loading fails.
 */
export class ConfigurationLoadError extends Error {
  public readonly path: string;
  public readonly originalCause?: Error;

  constructor(
    path: string,
    message: string,
    cause?: Error,
  ) {
    super(`Configuration load failed at ${path}: ${message}`, { cause });
    this.name = "ConfigurationLoadError";
    this.path = path;
    this.originalCause = cause;
  }
}

/**
 * Load agent definition from a directory.
 * Does NOT validate or apply defaults.
 *
 * @param agentDir - Path to the agent directory
 * @returns Raw JSON content (unvalidated)
 * @throws ConfigurationLoadError if file not found, invalid JSON, or read error
 */
export async function loadRaw(agentDir: string): Promise<unknown> {
  const configPath = join(agentDir, "agent.json");

  try {
    const content = await Deno.readTextFile(configPath);
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new ConfigurationLoadError(configPath, "File not found");
    }
    if (error instanceof SyntaxError) {
      throw new ConfigurationLoadError(configPath, "Invalid JSON", error);
    }
    throw new ConfigurationLoadError(
      configPath,
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error : undefined,
    );
  }
}

/**
 * Load steps registry from a directory.
 *
 * @param agentDir - Path to the agent directory
 * @returns Raw registry JSON or null if not found (registry is optional)
 * @throws ConfigurationLoadError if file exists but cannot be read/parsed
 */
export async function loadStepsRegistry(agentDir: string): Promise<unknown> {
  const registryPath = join(agentDir, "steps_registry.json");

  try {
    const content = await Deno.readTextFile(registryPath);
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null; // Registry is optional
    }
    throw new ConfigurationLoadError(
      registryPath,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Get agent directory path.
 *
 * @param agentName - Name of the agent
 * @param baseDir - Base directory containing .agent folder
 * @returns Full path to agent directory
 */
export function getAgentDir(agentName: string, baseDir: string): string {
  return join(baseDir, ".agent", agentName);
}
