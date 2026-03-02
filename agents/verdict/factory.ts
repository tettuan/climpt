/**
 * Verdict handler factory
 *
 * Supports both new behavior-based type names and legacy aliases.
 * Legacy types are automatically resolved to their new equivalents.
 */

import type { AgentDefinition } from "../src_common/types.ts";
import { PromptResolverAdapter as PromptResolver } from "../prompts/resolver-adapter.ts";
import type { VerdictHandler } from "./types.ts";
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

/**
 * Factory function type for creating completion handlers
 */
type HandlerFactory = (
  args: Record<string, unknown>,
  promptResolver: PromptResolver,
  definition: AgentDefinition,
  agentDir: string,
) => VerdictHandler | Promise<VerdictHandler>;

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
  (args, promptResolver, definition) => {
    const issueNumber = args.issue as number | undefined;
    if (issueNumber === undefined || issueNumber === null) {
      throw new Error(
        "poll:state completion type requires --issue parameter. " +
          'Ensure agent.json declares issue in "parameters": ' +
          '{ "issue": { "type": "number", "required": true, "cli": "--issue" } }',
      );
    }

    const repo = args.repository as string | undefined;
    const stateChecker = new GitHubStateChecker(repo);
    const githubConfig = definition.runner.integrations?.github as
      | { defaultClosureAction?: string; labels?: Record<string, unknown> }
      | undefined;
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
      github: githubConfig as ExternalStateAdapterConfig["github"],
    };
    const adapter = new ExternalStateVerdictAdapter(
      issueHandler,
      adapterConfig,
    );
    adapter.setPromptResolver(promptResolver);
    return adapter;
  },
);

// count:iteration - Complete after N iterations
registerHandler("count:iteration", (_args, promptResolver, definition) => {
  const iterateHandler = new IterationBudgetVerdictHandler(
    definition.runner.verdict.config.maxIterations ??
      AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS,
  );
  iterateHandler.setPromptResolver(promptResolver);
  return iterateHandler;
});

// detect:keyword - Complete when LLM outputs specific keyword
registerHandler("detect:keyword", (_args, promptResolver, definition) => {
  const manualHandler = new KeywordSignalVerdictHandler(
    definition.runner.verdict.config.verdictKeyword ?? "TASK_COMPLETE",
  );
  manualHandler.setPromptResolver(promptResolver);
  return manualHandler;
});

// count:check - Complete after N status checks
registerHandler("count:check", (_args, promptResolver, definition) => {
  const checkHandler = new CheckBudgetVerdictHandler(
    definition.runner.verdict.config.maxChecks ?? 10,
  );
  checkHandler.setPromptResolver(promptResolver);
  return checkHandler;
});

// detect:structured - Complete when LLM outputs specific JSON signal
registerHandler("detect:structured", (_args, promptResolver, definition) => {
  if (!definition.runner.verdict.config.signalType) {
    throw new Error(
      "detect:structured completion type requires signalType in verdictConfig",
    );
  }
  const signalHandler = new StructuredSignalVerdictHandler(
    definition.runner.verdict.config.signalType,
    definition.runner.verdict.config.requiredFields,
  );
  signalHandler.setPromptResolver(promptResolver);
  return signalHandler;
});

// meta:composite - Combines multiple conditions
registerHandler(
  "meta:composite",
  (args, promptResolver, definition, agentDir) => {
    const { config: verdictConfig } = definition.runner.verdict;
    if (!verdictConfig.conditions || !verdictConfig.operator) {
      throw new Error(
        "composite completion type requires conditions and operator in verdictConfig",
      );
    }
    const compositeHandler = new CompositeVerdictHandler(
      verdictConfig.operator,
      verdictConfig.conditions,
      args,
      agentDir,
      definition,
    );
    compositeHandler.setPromptResolver(promptResolver);
    return compositeHandler;
  },
);

// detect:graph - Complete when step state machine reaches terminal
registerHandler(
  "detect:graph",
  async (_args, promptResolver, definition, agentDir) => {
    const { config: verdictConfig } = definition.runner.verdict;

    // Load steps registry for step machine
    const registryPath = verdictConfig.registryPath ??
      `${agentDir}/${PATHS.STEPS_REGISTRY}`;

    try {
      const content = await Deno.readTextFile(registryPath);
      const registry = JSON.parse(content);

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
    } catch (error) {
      // Fallback to iterate if registry not found
      if (error instanceof Deno.errors.NotFound) {
        // deno-lint-ignore no-console
        console.warn(
          `[detect:graph] Steps registry not found at ${registryPath}, falling back to iterate`,
        );
        const iterateHandler = new IterationBudgetVerdictHandler(
          verdictConfig.maxIterations ??
            AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS,
        );
        iterateHandler.setPromptResolver(promptResolver);
        return iterateHandler;
      }
      throw error;
    }
  },
);

// meta:custom - Fully custom handler implementation
registerHandler(
  "meta:custom",
  async (_args, _promptResolver, definition, agentDir) => {
    if (!definition.runner.verdict.config.handlerPath) {
      throw new Error(
        "Custom completion type requires handlerPath in verdictConfig",
      );
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

  // Create prompt resolver for handlers
  const promptResolver = await PromptResolver.create({
    agentName: definition.name,
    agentDir,
    registryPath: definition.runner.flow.prompts.registry,
    fallbackDir: definition.runner.flow.prompts.fallbackDir,
  });

  // Get factory from registry
  const factory = HANDLER_REGISTRY.get(verdictType);
  if (!factory) {
    throw new Error(`Unknown completion type: ${verdictType}`);
  }

  return await factory(args, promptResolver, definition, agentDir);
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
      throw new Error(
        `Custom handler must export default factory function: ${fullPath}`,
      );
    }

    return module.default(definition, args);
  } catch (error) {
    if (error instanceof Error && error.message.includes("export default")) {
      throw error;
    }
    throw new Error(
      `Failed to load custom completion handler from ${fullPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
