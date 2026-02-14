/**
 * Completion handler factory
 *
 * Supports both new behavior-based type names and legacy aliases.
 * Legacy types are automatically resolved to their new equivalents.
 */

import type { AgentDefinition } from "../src_common/types.ts";
import { PromptResolverAdapter as PromptResolver } from "../prompts/resolver-adapter.ts";
import type { CompletionHandler } from "./types.ts";
import { IssueCompletionHandler, type IssueContractConfig } from "./issue.ts";
import { GitHubStateChecker } from "./external-state-checker.ts";
import {
  type ExternalStateAdapterConfig,
  ExternalStateCompletionAdapter,
} from "./external-state-adapter.ts";
import { IterateCompletionHandler } from "./iterate.ts";
import { ManualCompletionHandler } from "./manual.ts";
import { CheckBudgetCompletionHandler } from "./check-budget.ts";
import { StructuredSignalCompletionHandler } from "./structured-signal.ts";
import { CompositeCompletionHandler } from "./composite.ts";
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
) => CompletionHandler | Promise<CompletionHandler>;

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

// externalState (was: issue) - Complete when external resource reaches target state
registerHandler(
  "externalState",
  (args, promptResolver, definition) => {
    const issueNumber = args.issue as number | undefined;
    if (issueNumber === undefined || issueNumber === null) {
      throw new Error(
        "externalState completion type requires --issue parameter",
      );
    }

    const repo = args.repository as string | undefined;
    const stateChecker = new GitHubStateChecker(repo);
    const issueConfig: IssueContractConfig = {
      issueNumber,
      repo,
    };
    const issueHandler = new IssueCompletionHandler(issueConfig, stateChecker);

    const adapterConfig: ExternalStateAdapterConfig = {
      issueNumber,
      repo,
      github: definition.github as ExternalStateAdapterConfig["github"],
    };
    const adapter = new ExternalStateCompletionAdapter(
      issueHandler,
      adapterConfig,
    );
    adapter.setPromptResolver(promptResolver);
    return adapter;
  },
);

// iterationBudget (was: iterate) - Complete after N iterations
registerHandler("iterationBudget", (_args, promptResolver, definition) => {
  const iterateHandler = new IterateCompletionHandler(
    definition.behavior.completionConfig.maxIterations ??
      AGENT_LIMITS.COMPLETION_FALLBACK_MAX_ITERATIONS,
  );
  iterateHandler.setPromptResolver(promptResolver);
  return iterateHandler;
});

// keywordSignal (was: manual) - Complete when LLM outputs specific keyword
registerHandler("keywordSignal", (_args, promptResolver, definition) => {
  const manualHandler = new ManualCompletionHandler(
    definition.behavior.completionConfig.completionKeyword ?? "TASK_COMPLETE",
  );
  manualHandler.setPromptResolver(promptResolver);
  return manualHandler;
});

// checkBudget - Complete after N status checks
registerHandler("checkBudget", (_args, promptResolver, definition) => {
  const checkHandler = new CheckBudgetCompletionHandler(
    definition.behavior.completionConfig.maxChecks ?? 10,
  );
  checkHandler.setPromptResolver(promptResolver);
  return checkHandler;
});

// structuredSignal - Complete when LLM outputs specific JSON signal
registerHandler("structuredSignal", (_args, promptResolver, definition) => {
  if (!definition.behavior.completionConfig.signalType) {
    throw new Error(
      "structuredSignal completion type requires signalType in completionConfig",
    );
  }
  const signalHandler = new StructuredSignalCompletionHandler(
    definition.behavior.completionConfig.signalType,
    definition.behavior.completionConfig.requiredFields,
  );
  signalHandler.setPromptResolver(promptResolver);
  return signalHandler;
});

// composite - Combines multiple conditions
registerHandler("composite", (args, promptResolver, definition, agentDir) => {
  const { completionConfig } = definition.behavior;
  if (!completionConfig.conditions || !completionConfig.operator) {
    throw new Error(
      "composite completion type requires conditions and operator in completionConfig",
    );
  }
  const compositeHandler = new CompositeCompletionHandler(
    completionConfig.operator,
    completionConfig.conditions,
    args,
    agentDir,
    definition,
  );
  compositeHandler.setPromptResolver(promptResolver);
  return compositeHandler;
});

// stepMachine (was: stepFlow) - Complete when step state machine reaches terminal
registerHandler(
  "stepMachine",
  async (_args, promptResolver, definition, agentDir) => {
    const { completionConfig } = definition.behavior;

    // Load steps registry for step machine
    const registryPath = completionConfig.registryPath ??
      `${agentDir}/${PATHS.STEPS_REGISTRY}`;

    try {
      const content = await Deno.readTextFile(registryPath);
      const registry = JSON.parse(content);

      // Import dynamically to avoid circular dependency at module load time
      const { StepMachineCompletionHandler } = await import(
        "./step-machine.ts"
      );

      const stepMachineHandler = new StepMachineCompletionHandler(
        registry,
        completionConfig.entryStep,
      );
      stepMachineHandler.setPromptResolver(promptResolver);
      return stepMachineHandler;
    } catch (error) {
      // Fallback to iterate if registry not found
      if (error instanceof Deno.errors.NotFound) {
        // deno-lint-ignore no-console
        console.warn(
          `[stepMachine] Steps registry not found at ${registryPath}, falling back to iterate`,
        );
        const iterateHandler = new IterateCompletionHandler(
          completionConfig.maxIterations ??
            AGENT_LIMITS.COMPLETION_FALLBACK_MAX_ITERATIONS,
        );
        iterateHandler.setPromptResolver(promptResolver);
        return iterateHandler;
      }
      throw error;
    }
  },
);

// custom - Fully custom handler implementation
registerHandler(
  "custom",
  async (_args, _promptResolver, definition, agentDir) => {
    if (!definition.behavior.completionConfig.handlerPath) {
      throw new Error(
        "Custom completion type requires handlerPath in completionConfig",
      );
    }
    return await loadCustomHandler(
      definition,
      definition.behavior.completionConfig.handlerPath,
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
 * handler based on completionType in the agent definition.
 */
export async function createRegistryCompletionHandler(
  definition: AgentDefinition,
  args: Record<string, unknown>,
  agentDir: string,
): Promise<CompletionHandler> {
  const { completionType } = definition.behavior;

  // Create prompt resolver for handlers
  const promptResolver = await PromptResolver.create({
    agentName: definition.name,
    agentDir,
    registryPath: definition.prompts.registry,
    fallbackDir: definition.prompts.fallbackDir,
  });

  // Get factory from registry
  const factory = HANDLER_REGISTRY.get(completionType);
  if (!factory) {
    throw new Error(`Unknown completion type: ${completionType}`);
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
): Promise<CompletionHandler> {
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
