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
import { isRecord } from "../src_common/type-guards.ts";
import { AGENT_LIMITS } from "../shared/constants.ts";
import { PATHS } from "../shared/paths.ts";

/**
 * Default values for agent definition.
 * These are applied when fields are missing.
 */
const DEFAULTS = {
  runner: {
    flow: {
      prompts: {
        registry: PATHS.STEPS_REGISTRY,
        fallbackDir: PATHS.PROMPTS_DIR,
      },
    },
    completion: {
      type: "iterationBudget" as const,
      config: {
        maxIterations: AGENT_LIMITS.DEFAULT_MAX_ITERATIONS,
      },
    },
    boundaries: {
      permissionMode: "plan" as const,
      allowedTools: ["*"],
      github: {
        enabled: false,
      },
    },
    execution: {
      worktree: {
        enabled: false,
      },
    },
    telemetry: {
      logging: {
        directory: PATHS.LOGS_DIR,
        format: "jsonl" as const,
      },
    },
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
  if (!isRecord(raw)) {
    throw new Error("applyDefaults: input must be an object");
  }
  const def = raw;
  const rawRunner = isRecord(def.runner) ? def.runner : {};
  const rawFlow = isRecord(rawRunner.flow) ? rawRunner.flow : {};
  const rawCompletion = isRecord(rawRunner.completion)
    ? rawRunner.completion
    : {};
  const rawBoundaries = isRecord(rawRunner.boundaries)
    ? rawRunner.boundaries
    : {};
  const rawExecution = isRecord(rawRunner.execution) ? rawRunner.execution : {};
  const rawTelemetry = isRecord(rawRunner.telemetry) ? rawRunner.telemetry : {};

  const rawPrompts = isRecord(rawFlow.prompts) ? rawFlow.prompts : {};
  const rawCompletionConfig = isRecord(rawCompletion.config)
    ? rawCompletion.config
    : {};
  const rawLogging = isRecord(rawTelemetry.logging) ? rawTelemetry.logging : {};

  // Deep merge with defaults
  return {
    $schema: def.$schema as string | undefined,
    version: (def.version as string) ?? "1.0.0",
    name: def.name as string,
    displayName: (def.displayName as string) ?? (def.name as string),
    description: (def.description as string) ?? "",
    parameters: (def.parameters as AgentDefinition["parameters"]) ??
      DEFAULTS.parameters,
    runner: {
      flow: {
        systemPromptPath: rawFlow.systemPromptPath as string,
        prompts: {
          registry: (rawPrompts.registry as string) ??
            DEFAULTS.runner.flow.prompts.registry,
          fallbackDir: (rawPrompts.fallbackDir as string) ??
            DEFAULTS.runner.flow.prompts.fallbackDir,
        },
        schemas: rawFlow
          .schemas as AgentDefinition["runner"]["flow"]["schemas"],
      },
      completion: {
        type: (rawCompletion
          .type as AgentDefinition["runner"]["completion"]["type"]) ??
          DEFAULTS.runner.completion.type,
        config: {
          ...DEFAULTS.runner.completion.config,
          ...rawCompletionConfig,
        },
      },
      boundaries: {
        allowedTools: (rawBoundaries.allowedTools as string[]) ??
          DEFAULTS.runner.boundaries.allowedTools,
        permissionMode: (rawBoundaries
          .permissionMode as AgentDefinition["runner"]["boundaries"][
            "permissionMode"
          ]) ??
          DEFAULTS.runner.boundaries.permissionMode,
        sandbox: rawBoundaries
          .sandbox as AgentDefinition["runner"]["boundaries"]["sandbox"],
        askUserAutoResponse: rawBoundaries
          .askUserAutoResponse as string | undefined,
        defaultModel: rawBoundaries.defaultModel as string | undefined,
        github: (rawBoundaries
          .github as AgentDefinition["runner"]["boundaries"]["github"]) ??
          DEFAULTS.runner.boundaries.github,
        actions: rawBoundaries
          .actions as AgentDefinition["runner"]["boundaries"]["actions"],
      },
      execution: {
        worktree: (rawExecution
          .worktree as AgentDefinition["runner"]["execution"]["worktree"]) ??
          DEFAULTS.runner.execution.worktree,
        finalize: rawExecution
          .finalize as AgentDefinition["runner"]["execution"]["finalize"],
      },
      telemetry: {
        logging: {
          directory: (rawLogging.directory as string) ??
            DEFAULTS.runner.telemetry.logging.directory,
          format: (rawLogging
            .format as AgentDefinition["runner"]["telemetry"]["logging"][
              "format"
            ]) ??
            DEFAULTS.runner.telemetry.logging.format,
          maxFiles: rawLogging.maxFiles as number | undefined,
        },
      },
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
