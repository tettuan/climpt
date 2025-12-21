/**
 * Iterate Agent - Configuration Loader
 *
 * Loads and validates configuration from iterate-agent/config.json.
 */

import { join } from "@std/path";
import type { AgentName, IterateAgentConfig, AgentConfig } from "./types.ts";

/**
 * Load the main configuration file
 *
 * @param configPath - Path to config.json (defaults to iterate-agent/config.json)
 * @returns Parsed configuration
 * @throws Error if file doesn't exist or is invalid
 */
export async function loadConfig(
  configPath: string = "iterate-agent/config.json"
): Promise<IterateAgentConfig> {
  try {
    const content = await Deno.readTextFile(configPath);
    const config = JSON.parse(content) as IterateAgentConfig;

    // Validate config structure
    validateConfig(config);

    return config;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `Configuration file not found: ${configPath}. Run from project root.`
      );
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in configuration file: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate configuration structure
 *
 * @param config - Configuration to validate
 * @throws Error if validation fails
 */
function validateConfig(config: IterateAgentConfig): void {
  if (!config.version) {
    throw new Error("Configuration missing required field: version");
  }

  if (!config.agents || typeof config.agents !== "object") {
    throw new Error("Configuration missing or invalid field: agents");
  }

  if (!config.github || !config.github.tokenEnvVar) {
    throw new Error("Configuration missing required field: github.tokenEnvVar");
  }

  if (!config.logging || !config.logging.directory) {
    throw new Error("Configuration missing required field: logging.directory");
  }

  // Validate each agent has required fields
  for (const [agentName, agentConfig] of Object.entries(config.agents)) {
    if (!agentConfig.systemPromptTemplate) {
      throw new Error(
        `Agent "${agentName}" missing required field: systemPromptTemplate`
      );
    }
    if (!agentConfig.allowedTools || !Array.isArray(agentConfig.allowedTools)) {
      throw new Error(`Agent "${agentName}" missing or invalid field: allowedTools`);
    }
    if (!agentConfig.permissionMode) {
      throw new Error(
        `Agent "${agentName}" missing required field: permissionMode`
      );
    }
  }
}

/**
 * Get configuration for a specific agent
 *
 * @param config - Main configuration
 * @param agentName - MCP agent name
 * @returns Agent-specific configuration
 * @throws Error if agent doesn't exist
 */
export function getAgentConfig(
  config: IterateAgentConfig,
  agentName: AgentName
): AgentConfig {
  const agentConfig = config.agents[agentName];

  if (!agentConfig) {
    throw new Error(
      `Agent "${agentName}" not found in configuration. Available agents: ${
        Object.keys(config.agents).join(", ")
      }`
    );
  }

  return agentConfig;
}

/**
 * Load system prompt template for an agent
 *
 * @param agentConfig - Agent configuration
 * @param basePath - Base path for resolving template path (defaults to cwd)
 * @returns System prompt template content
 * @throws Error if template file doesn't exist
 */
export async function loadSystemPromptTemplate(
  agentConfig: AgentConfig,
  basePath: string = Deno.cwd()
): Promise<string> {
  const templatePath = join(basePath, agentConfig.systemPromptTemplate);

  try {
    return await Deno.readTextFile(templatePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `System prompt template not found: ${templatePath}`
      );
    }
    throw error;
  }
}

/**
 * Get GitHub token from environment
 *
 * @param config - Main configuration
 * @returns GitHub token value
 * @throws Error if token not found in environment
 */
export function getGitHubToken(config: IterateAgentConfig): string {
  const token = Deno.env.get(config.github.tokenEnvVar);

  if (!token) {
    throw new Error(
      `GitHub token not found. Set ${config.github.tokenEnvVar} environment variable.`
    );
  }

  return token;
}

/**
 * Ensure log directory exists
 *
 * @param config - Main configuration
 * @param agentName - MCP agent name
 * @returns Full path to log directory
 */
export async function ensureLogDirectory(
  config: IterateAgentConfig,
  agentName: AgentName
): Promise<string> {
  const logDir = join(config.logging.directory, agentName);

  try {
    await Deno.mkdir(logDir, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }

  return logDir;
}
