/**
 * Verdict handler factory
 *
 * Supports both new behavior-based type names and legacy aliases.
 * Legacy types are automatically resolved to their new equivalents.
 */

import type { AgentDefinition } from "../src_common/types.ts";
import { PromptResolver } from "../common/prompt-resolver.ts";
import {
  createEmptyRegistry,
  loadStepRegistry,
} from "../common/step-registry.ts";
import { join } from "@std/path";
import type { VerdictHandler, VerdictStepIds } from "./types.ts";
import type { ExtendedStepsRegistry } from "../common/validation-types.ts";
import { type IssueContractConfig, IssueVerdictHandler } from "./issue.ts";
import { GitHubStateChecker } from "./external-state-checker.ts";
import {
  type ExternalStateAdapterConfig,
  ExternalStateVerdictAdapter,
} from "./external-state-adapter.ts";
import { IterationBudgetVerdictHandler } from "./iteration-budget.ts";
import { KeywordSignalVerdictHandler } from "./keyword-signal.ts";
import { CheckBudgetVerdictHandler } from "./check-budget.ts";
import { StructuredSignalVerdictHandler } from "./structured-signal.ts";
import { CompositeVerdictHandler } from "./composite.ts";
import { AGENT_LIMITS } from "../shared/constants.ts";
import { PATHS } from "../shared/paths.ts";
import {
  acVerdict001PollStateRequiresIssue,
  acVerdict002DetectStructuredRequiresSignalType,
  acVerdict003CompositeRequiresConditionsAndOperator,
  acVerdict004CustomRequiresHandlerPath,
  acVerdict005UnknownCompletionType,
  acVerdict006CustomHandlerMustExportFactory,
  acVerdict007FailedToLoadCustomHandler,
  acVerdict011DetectGraphRequiresRegistry,
  acVerdict012EntryStepPairMissing,
  acVerdict013EntryStepPairMalformed,
  ConfigError,
} from "../shared/errors/config-errors.ts";

/**
 * Factory function type for creating completion handlers
 */
type HandlerFactory = (
  args: Record<string, unknown>,
  promptResolver: PromptResolver,
  definition: AgentDefinition,
  agentDir: string,
  stepIds: VerdictStepIds,
) => VerdictHandler | Promise<VerdictHandler>;

/**
 * Read the entryStepMapping pair for a verdict type.
 *
 * The registry must declare both `initial` and `continuation` step ids
 * explicitly under entryStepMapping[verdictType]. The runtime never derives
 * one from the other — see design/04_step_flow_design.md §2.1.
 */
function resolveStepIds(
  registry: ExtendedStepsRegistry,
  verdictType: string,
): VerdictStepIds {
  const pair = registry.entryStepMapping?.[verdictType];
  if (pair === undefined) {
    throw acVerdict012EntryStepPairMissing(verdictType);
  }
  if (
    typeof pair !== "object" || pair === null ||
    typeof (pair as { initial?: unknown }).initial !== "string" ||
    typeof (pair as { continuation?: unknown }).continuation !== "string" ||
    (pair as { initial: string }).initial.length === 0 ||
    (pair as { continuation: string }).continuation.length === 0
  ) {
    throw acVerdict013EntryStepPairMalformed(
      verdictType,
      `expected { initial: string, continuation: string }, got ${
        JSON.stringify(pair)
      }`,
    );
  }
  return {
    initial: (pair as { initial: string }).initial,
    continuation: (pair as { continuation: string }).continuation,
  };
}

/**
 * Registry of completion handler factories by type
 */
const HANDLER_REGISTRY = new Map<string, HandlerFactory>();

/**
 * Register a handler factory for a completion type
 */
function registerHandler(type: string, factory: HandlerFactory): void {
  HANDLER_REGISTRY.set(type, factory);
}

// Register standard handlers

// poll:state - Complete when external resource reaches target state
registerHandler(
  "poll:state",
  (args, promptResolver, definition, _agentDir, stepIds) => {
    const issueNumber = args.issue as number | undefined;
    if (issueNumber === undefined || issueNumber === null) {
      throw acVerdict001PollStateRequiresIssue();
    }

    const repo = args.repository as string | undefined;
    const stateChecker = new GitHubStateChecker(repo);
    const rawGithubConfig = definition.runner.integrations?.github;

    // When enabled is explicitly false, suppress all GitHub operations
    const githubEnabled = rawGithubConfig?.enabled !== false;
    const githubConfig = githubEnabled ? rawGithubConfig : undefined;

    const issueConfig: IssueContractConfig = {
      issueNumber,
      repo,
      closureAction: (githubConfig?.defaultClosureAction as
        | "close"
        | "label-only"
        | "label-and-close"
        | undefined) ?? "close",
    };
    const issueHandler = new IssueVerdictHandler(issueConfig, stateChecker);

    const adapterConfig: ExternalStateAdapterConfig = {
      issueNumber,
      repo,
      maxIterations: definition.runner.verdict.config.maxIterations,
      github: githubConfig as ExternalStateAdapterConfig["github"],
    };
    const adapter = new ExternalStateVerdictAdapter(
      issueHandler,
      adapterConfig,
      stepIds,
    );
    adapter.setPromptResolver(promptResolver);
    return adapter;
  },
);

// count:iteration - Complete after N iterations
registerHandler(
  "count:iteration",
  (_args, promptResolver, definition, _agentDir, stepIds) => {
    const iterateHandler = new IterationBudgetVerdictHandler(
      definition.runner.verdict.config.maxIterations ??
        AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS,
      stepIds,
    );
    iterateHandler.setPromptResolver(promptResolver);
    return iterateHandler;
  },
);

// detect:keyword - Complete when LLM outputs specific keyword
registerHandler(
  "detect:keyword",
  (_args, promptResolver, definition, _agentDir, stepIds) => {
    const manualHandler = new KeywordSignalVerdictHandler(
      definition.runner.verdict.config.verdictKeyword ?? "TASK_COMPLETE",
      stepIds,
    );
    manualHandler.setPromptResolver(promptResolver);
    return manualHandler;
  },
);

// count:check - Complete after N status checks
registerHandler(
  "count:check",
  (_args, promptResolver, definition, _agentDir, stepIds) => {
    const checkHandler = new CheckBudgetVerdictHandler(
      definition.runner.verdict.config.maxChecks ?? 10,
      stepIds,
    );
    checkHandler.setPromptResolver(promptResolver);
    return checkHandler;
  },
);

// detect:structured - Complete when LLM outputs specific JSON signal
registerHandler(
  "detect:structured",
  (_args, promptResolver, definition, _agentDir, stepIds) => {
    if (!definition.runner.verdict.config.signalType) {
      throw acVerdict002DetectStructuredRequiresSignalType();
    }
    const signalHandler = new StructuredSignalVerdictHandler(
      definition.runner.verdict.config.signalType,
      definition.runner.verdict.config.requiredFields,
      stepIds,
    );
    signalHandler.setPromptResolver(promptResolver);
    return signalHandler;
  },
);

// meta:composite - Combines multiple conditions
registerHandler(
  "meta:composite",
  (args, promptResolver, definition, agentDir, stepIds) => {
    const { config: verdictConfig } = definition.runner.verdict;
    if (!verdictConfig.conditions || !verdictConfig.operator) {
      throw acVerdict003CompositeRequiresConditionsAndOperator();
    }
    const compositeHandler = new CompositeVerdictHandler(
      verdictConfig.operator,
      verdictConfig.conditions,
      args,
      agentDir,
      definition,
      stepIds,
    );
    compositeHandler.setPromptResolver(promptResolver);
    return compositeHandler;
  },
);

// detect:graph - Complete when step state machine reaches terminal
registerHandler(
  "detect:graph",
  async (_args, promptResolver, definition, agentDir, _stepIds) => {
    const { config: verdictConfig } = definition.runner.verdict;

    // Load steps registry for step machine via the strict, validating loader.
    // The loader enforces the new ADT shape (SR-VALID-005) and other invariants;
    // those errors must propagate. Only the not-found case is remapped to
    // AC-VERDICT-011 to preserve the verdict-handler-specific guidance.
    const registryPath = verdictConfig.registryPath ??
      `${agentDir}/${PATHS.STEPS_REGISTRY}`;

    let registry;
    try {
      registry = await loadStepRegistry(definition.name, agentDir, {
        registryPath,
      });
    } catch (error) {
      // The loader wraps Deno.errors.NotFound as ConfigError(SR-LOAD-003).
      // Remap that to the verdict-specific AC-VERDICT-011 so users get the
      // detect:graph-aware fix message. Other ConfigErrors (SR-VALID-005,
      // SR-LOAD-001/002, SR-INTENT, etc.) propagate unchanged.
      if (error instanceof ConfigError && error.code === "SR-LOAD-003") {
        throw acVerdict011DetectGraphRequiresRegistry(registryPath);
      }
      throw error;
    }

    // Import dynamically to avoid circular dependency at module load time
    const { StepMachineVerdictHandler } = await import(
      "./step-machine.ts"
    );

    const stepMachineHandler = new StepMachineVerdictHandler(
      registry,
      verdictConfig.entryStep,
    );
    stepMachineHandler.setPromptResolver(promptResolver);
    return stepMachineHandler;
  },
);

// meta:custom - Fully custom handler implementation
registerHandler(
  "meta:custom",
  async (_args, _promptResolver, definition, agentDir, _stepIds) => {
    if (!definition.runner.verdict.config.handlerPath) {
      throw acVerdict004CustomRequiresHandlerPath();
    }
    return await loadCustomHandler(
      definition,
      definition.runner.verdict.config.handlerPath,
      _args,
      agentDir,
    );
  },
);

// ============================================================================
// Registry-based Factory (handles all completion types)
// ============================================================================

/**
 * Create a completion handler based on agent definition using the registry.
 *
 * This is the main factory used by AgentRunner. It routes to the appropriate
 * handler based on verdictType in the agent definition.
 */
export async function createRegistryVerdictHandler(
  definition: AgentDefinition,
  args: Record<string, unknown>,
  agentDir: string,
): Promise<VerdictHandler> {
  const { type: verdictType } = definition.runner.verdict;

  // Create prompt resolver for handlers.
  //
  // Only the "registry file absent" case (SR-LOAD-003) degrades to an
  // empty registry. All other ConfigError codes — SR-VALID-005 (legacy
  // shape), SR-LOAD-001/002 (parse / agentId mismatch), SR-INTENT-*,
  // SR-VALID-* — and any non-ConfigError exception MUST propagate so
  // production fails loudly. Silent degrade was the T17/N5 anti-pattern.
  let registry;
  try {
    registry = await loadStepRegistry(definition.name, agentDir, {
      registryPath: join(agentDir, definition.runner.flow.prompts.registry),
    });
  } catch (error) {
    if (error instanceof ConfigError && error.code === "SR-LOAD-003") {
      registry = createEmptyRegistry(definition.name);
    } else {
      throw error;
    }
  }
  const promptResolver = new PromptResolver(registry, {
    workingDir: Deno.cwd(),
    configSuffix: registry.c1,
  });

  // Get factory from registry
  const factory = HANDLER_REGISTRY.get(verdictType);
  if (!factory) {
    throw acVerdict005UnknownCompletionType(verdictType);
  }

  // Resolve step IDs: registry must declare entryStepMapping[verdictType]
  // as { initial, continuation }. No derivation, no defaults.
  const stepIds = resolveStepIds(registry, verdictType);

  return await factory(args, promptResolver, definition, agentDir, stepIds);
}

/**
 * Load a custom completion handler from file
 */
async function loadCustomHandler(
  definition: AgentDefinition,
  handlerPath: string,
  args: Record<string, unknown>,
  agentDir: string,
): Promise<VerdictHandler> {
  const fullPath = `${agentDir}/${handlerPath}`;

  try {
    const module = await import(fullPath);

    if (typeof module.default !== "function") {
      throw acVerdict006CustomHandlerMustExportFactory(fullPath);
    }

    return module.default(definition, args);
  } catch (error) {
    if (
      error instanceof Error && error.message.includes("export default factory")
    ) {
      throw error;
    }
    throw acVerdict007FailedToLoadCustomHandler(
      fullPath,
      error instanceof Error ? error.message : String(error),
    );
  }
}
