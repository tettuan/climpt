/**
 * Configuration loading utilities
 *
 * Delegates file I/O to ConfigService for centralized config loading.
 */

import { deepMerge } from "./deep-merge.ts";
import type { AgentDefinition } from "./types.ts";
import { ConfigService, type RuntimeConfig } from "../shared/config-service.ts";

export type { RuntimeConfig };

/** Shared ConfigService instance */
const configService = new ConfigService();

/**
 * Load runtime configuration from config.json in agent directory
 */
export async function loadRuntimeConfig(
  agentDir: string,
): Promise<RuntimeConfig> {
  return await configService.loadRuntimeConfig(agentDir);
}

/**
 * Merge configuration layers: defaults < agent.json < config.json < CLI args
 */
export function mergeConfigurations<T extends Record<string, unknown>>(
  ...layers: Partial<T>[]
): T {
  return layers.reduce(
    (acc, layer) => deepMerge(acc as T, layer),
    {} as Partial<T>,
  ) as T;
}

/**
 * Get default values for optional fields
 */
export function getDefaults(): Partial<AgentDefinition> {
  return {
    github: {
      enabled: false,
    },
    worktree: {
      enabled: false,
    },
  };
}

/**
 * Apply default values to agent definition
 */
export function applyDefaults(definition: AgentDefinition): AgentDefinition {
  const defaults = getDefaults();
  return {
    ...definition,
    github: definition.github ?? defaults.github,
    worktree: definition.worktree ?? defaults.worktree,
  };
}

/**
 * Resolve paths relative to agent directory
 */
export function resolveAgentPaths(
  definition: AgentDefinition,
  agentDir: string,
): AgentDefinition {
  return configService.resolveAgentPaths(definition, agentDir);
}
