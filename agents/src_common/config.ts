/**
 * Configuration loading utilities
 *
 * Delegates file I/O to ConfigService for centralized config loading.
 */

import { deepMerge } from "./deep-merge.ts";
import type { AgentDefinition, ResolvedAgentDefinition } from "./types.ts";
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
    runner: {
      flow: {
        systemPromptPath: "",
        prompts: { registry: "", fallbackDir: "" },
      },
      completion: { type: "iterationBudget", config: {} },
      boundaries: {
        allowedTools: [],
        permissionMode: "plan",
      },
      integrations: {
        github: { enabled: false },
      },
      execution: {
        worktree: { enabled: false },
      },
      logging: { directory: "", format: "jsonl" },
    },
  };
}

/**
 * Apply default values to agent definition
 */
export function applyDefaults(
  definition: AgentDefinition,
): ResolvedAgentDefinition {
  const defaults = getDefaults();
  return {
    ...definition,
    runner: {
      ...definition.runner,
      integrations: {
        ...definition.runner.integrations,
        github: definition.runner.integrations?.github ??
          defaults.runner?.integrations?.github,
      },
      execution: {
        ...(definition.runner.execution ?? { worktree: { enabled: false } }),
        worktree: definition.runner.execution?.worktree ??
          defaults.runner?.execution?.worktree,
      },
      logging: definition.runner.logging ??
        defaults.runner?.logging ?? { directory: "", format: "jsonl" as const },
    },
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
