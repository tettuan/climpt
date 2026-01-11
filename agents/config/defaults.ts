/**
 * Configuration Defaults - Apply Default Values
 *
 * Responsibility: Apply default values only
 * Side effects: None (Query - returns new object)
 *
 * Note: Following the design principle of "eliminating implicit defaults",
 * we aim to reduce defaults and require them as explicit mandatory items.
 */

import type { AgentDefinition } from "../src_common/types.ts";

/**
 * Default values for agent definition.
 * These are applied when fields are missing.
 */
const DEFAULTS = {
  behavior: {
    completionType: "iterationBudget" as const,
    completionConfig: {
      maxIterations: 10,
    },
    permissionMode: "plan" as const,
    allowedTools: ["*"],
  },
  prompts: {
    registry: "steps_registry.json",
    fallbackDir: "prompts",
  },
  logging: {
    directory: "logs",
    format: "jsonl" as const,
  },
  actions: {
    enabled: false,
    types: [] as string[],
    outputFormat: "action",
  },
  github: {
    enabled: false,
  },
  worktree: {
    enabled: false,
  },
  parameters: {} as Record<string, unknown>,
};

/**
 * Apply default values to a raw definition.
 * Returns a new object (does not mutate input).
 *
 * @param raw - Raw definition from JSON
 * @returns AgentDefinition with defaults applied
 */
export function applyDefaults(raw: unknown): AgentDefinition {
  const def = raw as Record<string, unknown>;
  const rawBehavior = (def.behavior as Record<string, unknown>) ?? {};
  const rawPrompts = (def.prompts as Record<string, unknown>) ?? {};
  const rawLogging = (def.logging as Record<string, unknown>) ?? {};
  const rawCompletionConfig =
    (rawBehavior.completionConfig as Record<string, unknown>) ?? {};

  // Deep merge with defaults
  return {
    $schema: def.$schema as string | undefined,
    version: (def.version as string) ?? "1.0.0",
    name: def.name as string,
    displayName: (def.displayName as string) ?? (def.name as string),
    description: (def.description as string) ?? "",
    behavior: {
      systemPromptPath: rawBehavior.systemPromptPath as string,
      completionType: (rawBehavior
        .completionType as AgentDefinition["behavior"]["completionType"]) ??
        DEFAULTS.behavior.completionType,
      completionConfig: {
        ...DEFAULTS.behavior.completionConfig,
        ...rawCompletionConfig,
      },
      allowedTools: (rawBehavior.allowedTools as string[]) ??
        DEFAULTS.behavior.allowedTools,
      permissionMode: (rawBehavior
        .permissionMode as AgentDefinition["behavior"]["permissionMode"]) ??
        DEFAULTS.behavior.permissionMode,
      sandboxConfig: rawBehavior
        .sandboxConfig as AgentDefinition["behavior"]["sandboxConfig"],
    },
    parameters: (def.parameters as AgentDefinition["parameters"]) ??
      DEFAULTS.parameters,
    prompts: {
      registry: (rawPrompts.registry as string) ?? DEFAULTS.prompts.registry,
      fallbackDir: (rawPrompts.fallbackDir as string) ??
        DEFAULTS.prompts.fallbackDir,
    },
    actions: (def.actions as AgentDefinition["actions"]) ?? DEFAULTS.actions,
    github: (def.github as AgentDefinition["github"]) ?? DEFAULTS.github,
    worktree: (def.worktree as AgentDefinition["worktree"]) ??
      DEFAULTS.worktree,
    logging: {
      directory: (rawLogging.directory as string) ??
        DEFAULTS.logging.directory,
      format: (rawLogging.format as AgentDefinition["logging"]["format"]) ??
        DEFAULTS.logging.format,
      maxFiles: rawLogging.maxFiles as number | undefined,
    },
  };
}

/**
 * Freeze the definition to prevent accidental mutation.
 *
 * @param obj - Object to freeze
 * @returns Frozen (readonly) object
 */
export function freeze<T>(obj: T): Readonly<T> {
  return Object.freeze(obj);
}

/**
 * Deep freeze an object and all nested objects.
 *
 * @param obj - Object to deep freeze
 * @returns Deep frozen object
 */
export function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  Object.freeze(obj);

  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, unknown>)[key];
    if (
      value !== null && typeof value === "object" && !Object.isFrozen(value)
    ) {
      deepFreeze(value);
    }
  }

  return obj;
}
