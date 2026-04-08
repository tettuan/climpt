/**
 * ConfigService - Centralized Configuration Loading
 *
 * Consolidates config loading patterns scattered across:
 * - agents/config/loader.ts (loadRaw, loadStepsRegistry)
 * - agents/config/mod.ts (loadConfiguration, ConfigurationService)
 * - agents/runner/loader.ts (loadAgentDefinition - deprecated)
 * - agents/src_common/config.ts (loadRuntimeConfig, resolveAgentPaths)
 * - agents/runner/sandbox-defaults.ts (mergeSandboxConfig)
 *
 * Consumers should use ConfigService instead of direct file reads.
 */

import { join } from "@std/path";
import type { AgentDefinition } from "../src_common/types.ts";
import { PATHS } from "./paths.ts";
import {
  acServiceFileNotFound,
  acServiceInvalidJson,
  acServiceLoadFailed,
  acServiceRegistryLoadFailed,
} from "./errors/config-errors.ts";

/**
 * Runtime configuration loaded from config.json
 */
export interface RuntimeConfig {
  cwd?: string;
  debug?: boolean;
  plugins?: string[];
  environment?: Record<string, string>;
}

/**
 * ConfigService centralizes all config file loading operations.
 *
 * Methods:
 * - loadAgentDefinitionRaw: Load raw agent.json (unvalidated)
 * - loadRuntimeConfig: Load optional config.json
 * - loadStepsRegistry: Load optional steps_registry.json
 * - resolveAgentPaths: Resolve relative paths in definition
 * - getAgentDir: Get agent directory path
 */
export class ConfigService {
  /**
   * Get agent directory path from agent name and base directory.
   *
   * @param agentName - Name of the agent
   * @param cwd - Base directory containing .agent folder
   * @returns Full path to agent directory
   */
  getAgentDir(agentName: string, cwd: string): string {
    return join(cwd, PATHS.AGENT_DIR_PREFIX, agentName);
  }

  /**
   * Load raw agent definition from agent.json.
   * Does NOT validate or apply defaults.
   *
   * @param agentDir - Path to the agent directory
   * @returns Raw JSON content (unvalidated)
   * @throws ConfigError (AC-SERVICE-*) if file not found, invalid JSON, or read error
   */
  async loadAgentDefinitionRaw(agentDir: string): Promise<unknown> {
    const configPath = join(agentDir, PATHS.AGENT_JSON);

    try {
      const content = await Deno.readTextFile(configPath);
      return JSON.parse(content);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw acServiceFileNotFound(configPath);
      }
      if (error instanceof SyntaxError) {
        throw acServiceInvalidJson(configPath);
      }
      throw acServiceLoadFailed(
        configPath,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Load runtime configuration from config.json in agent directory.
   * Config file is optional; returns empty object if not found.
   *
   * @param agentDir - Path to the agent directory
   * @returns Runtime configuration or empty object
   */
  async loadRuntimeConfig(agentDir: string): Promise<RuntimeConfig> {
    const configPath = join(agentDir, "config.json");

    try {
      const content = await Deno.readTextFile(configPath);
      return JSON.parse(content) as RuntimeConfig;
    } catch {
      // Config file is optional
      return {};
    }
  }

  /**
   * Load steps registry from steps_registry.json in agent directory.
   * Registry is optional; returns null if not found.
   *
   * @param agentDir - Path to the agent directory
   * @param customRegistryPath - Optional full path to the registry file.
   *   When provided, used instead of the default `agentDir/steps_registry.json`.
   * @returns Raw registry JSON or null if not found
   * @throws ConfigError (AC-SERVICE-004) if file exists but cannot be read/parsed
   */
  async loadStepsRegistry(
    agentDir: string,
    customRegistryPath?: string,
  ): Promise<unknown> {
    const registryPath = customRegistryPath ??
      join(agentDir, PATHS.STEPS_REGISTRY);

    try {
      const content = await Deno.readTextFile(registryPath);
      return JSON.parse(content);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null; // Registry is optional
      }
      throw acServiceRegistryLoadFailed(
        registryPath,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Resolve relative paths in agent definition to absolute paths.
   *
   * @param definition - Agent definition with relative paths
   * @param agentDir - Agent directory for path resolution
   * @returns New definition with resolved paths
   */
  resolveAgentPaths(
    definition: AgentDefinition,
    agentDir: string,
  ): AgentDefinition {
    return {
      ...definition,
      runner: {
        ...definition.runner,
        flow: {
          ...definition.runner.flow,
          systemPromptPath: join(
            agentDir,
            definition.runner.flow.systemPromptPath,
          ),
          prompts: {
            ...definition.runner.flow.prompts,
            registry: join(agentDir, definition.runner.flow.prompts.registry),
          },
        },
        ...(definition.runner.logging
          ? {
            logging: {
              ...definition.runner.logging,
              directory: definition.runner.logging.directory.startsWith("/")
                ? definition.runner.logging.directory
                : join(agentDir, definition.runner.logging.directory),
            },
          }
          : {}),
      },
    };
  }
}
