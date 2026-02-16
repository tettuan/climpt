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
import type { AgentDefinition, SandboxConfig } from "../src_common/types.ts";
import { PATHS } from "./paths.ts";
import { ConfigurationLoadError } from "./errors/env-errors.ts";

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
 * - getSandboxConfig: Merge sandbox config with defaults
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
   * @throws ConfigurationLoadError if file not found, invalid JSON, or read error
   */
  async loadAgentDefinitionRaw(agentDir: string): Promise<unknown> {
    const configPath = join(agentDir, PATHS.AGENT_JSON);

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
   * @returns Raw registry JSON or null if not found
   * @throws ConfigurationLoadError if file exists but cannot be read/parsed
   */
  async loadStepsRegistry(agentDir: string): Promise<unknown> {
    const registryPath = join(agentDir, PATHS.STEPS_REGISTRY);

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
   * Merge agent sandbox config with defaults.
   * Agent config takes precedence over defaults.
   *
   * @param agentConfig - Agent-specific sandbox config (optional)
   * @returns Merged sandbox config
   */
  getSandboxConfig(agentConfig?: SandboxConfig): SandboxConfig {
    const defaults = getDefaultSandboxConfig();

    if (!agentConfig) {
      return defaults;
    }

    if (agentConfig.enabled === false) {
      return agentConfig;
    }

    const defaultNetwork = defaults.network;
    const mergedNetwork = agentConfig.network
      ? {
        mode: agentConfig.network.mode ?? defaultNetwork?.mode,
        trustedDomains: agentConfig.network.trustedDomains ??
          defaultNetwork?.trustedDomains,
      }
      : defaultNetwork;

    const defaultFilesystem = defaults.filesystem;
    const mergedFilesystem = {
      allowedPaths: [
        ...(defaultFilesystem?.allowedPaths ?? []),
        ...(agentConfig.filesystem?.allowedPaths ?? []),
      ],
    };

    return {
      enabled: agentConfig.enabled ?? defaults.enabled,
      network: mergedNetwork,
      filesystem: mergedFilesystem,
    };
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
            fallbackDir: join(
              agentDir,
              definition.runner.flow.prompts.fallbackDir,
            ),
          },
        },
        telemetry: {
          ...definition.runner.telemetry,
          logging: {
            ...definition.runner.telemetry.logging,
            directory:
              definition.runner.telemetry.logging.directory.startsWith("/")
                ? definition.runner.telemetry.logging.directory
                : join(agentDir, definition.runner.telemetry.logging.directory),
          },
        },
      },
    };
  }
}

// ============================================================================
// Default sandbox config (extracted from runner/sandbox-defaults.ts)
// ============================================================================

const DEFAULT_TRUSTED_DOMAINS = [
  "api.anthropic.com",
  "statsig.anthropic.com",
  "sentry.anthropic.com",
  "*.anthropic.com",
  "*.*.anthropic.com",
  "api.github.com",
  "github.com",
  "*.githubusercontent.com",
  "uploads.github.com",
  "jsr.io",
  "*.jsr.io",
  "deno.land",
  "*.deno.land",
  "registry.npmjs.org",
];

function getDefaultFilesystemPaths(): string[] {
  const home = Deno.env.get("HOME") ?? "";
  if (!home) {
    return [];
  }
  return [
    `${home}/.claude/projects/`,
    `${home}/.claude/statsig/`,
    `${home}/.claude/telemetry/`,
  ];
}

function getDefaultSandboxConfig(): SandboxConfig {
  return {
    enabled: true,
    network: {
      mode: "custom",
      trustedDomains: DEFAULT_TRUSTED_DOMAINS,
    },
    filesystem: {
      allowedPaths: getDefaultFilesystemPaths(),
    },
  };
}
