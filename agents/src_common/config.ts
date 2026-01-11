/**
 * Configuration loading utilities
 */

import { join } from "@std/path";
import { deepMerge } from "./deep-merge.ts";
import type { AgentDefinition } from "./types.ts";

export interface RuntimeConfig {
  cwd?: string;
  debug?: boolean;
  plugins?: string[];
  environment?: Record<string, string>;
}

/**
 * Load runtime configuration from config.json in agent directory
 */
export async function loadRuntimeConfig(
  agentDir: string,
): Promise<RuntimeConfig> {
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
    actions: {
      enabled: false,
      types: [],
      outputFormat: "action",
    },
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
    actions: definition.actions ?? defaults.actions,
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
  return {
    ...definition,
    behavior: {
      ...definition.behavior,
      systemPromptPath: join(agentDir, definition.behavior.systemPromptPath),
    },
    prompts: {
      ...definition.prompts,
      registry: join(agentDir, definition.prompts.registry),
      fallbackDir: join(agentDir, definition.prompts.fallbackDir),
    },
    logging: {
      ...definition.logging,
      directory: definition.logging.directory.startsWith("/")
        ? definition.logging.directory
        : join(agentDir, definition.logging.directory),
    },
  };
}
