/**
 * Completion handler factory
 *
 * Supports both new behavior-based type names and legacy aliases.
 * Legacy types are automatically resolved to their new equivalents.
 */

import type { AgentDefinition } from "../src_common/types.ts";
import { PromptResolver } from "../prompts/resolver.ts";
import type { CompletionHandler, ContractCompletionHandler } from "./types.ts";
import {
  IssueCompletionHandler,
  type IssueContractConfig,
  IssueContractHandler,
} from "./issue.ts";
import {
  type ExternalStateChecker,
  GitHubStateChecker,
} from "./external-state-checker.ts";
import { IterateCompletionHandler } from "./iterate.ts";
import { ManualCompletionHandler } from "./manual.ts";
import { CheckBudgetCompletionHandler } from "./check-budget.ts";
import { StructuredSignalCompletionHandler } from "./structured-signal.ts";
import { CompositeCompletionHandler } from "./composite.ts";

/**
 * Type guard helpers for args validation
 */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/**
 * Validate and extract issue number from args
 */
function getIssueNumber(args: Record<string, unknown>): number {
  if (!isNumber(args.issue)) {
    throw new Error(`Invalid issue number: ${args.issue}`);
  }
  return args.issue;
}

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
registerHandler("externalState", () => {
  throw new Error(
    "externalState/issue completion type requires --issue parameter",
  );
});

// iterationBudget (was: iterate) - Complete after N iterations
registerHandler("iterationBudget", (_args, promptResolver, definition) => {
  const iterateHandler = new IterateCompletionHandler(
    definition.behavior.completionConfig.maxIterations ?? 100,
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
      `${agentDir}/steps_registry.json`;

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
          completionConfig.maxIterations ?? 100,
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

/**
 * Options for creating a completion handler
 */
export interface CompletionHandlerOptions {
  /** Issue number (for issue completion) */
  issue?: number;
  /** Repository for cross-repo issues */
  repository?: string;
  /** Max iterations (for iterate completion) */
  maxIterations?: number;
  /** Completion keyword (for manual completion) */
  completionKeyword?: string;
  /** Prompt resolver (optional) */
  promptResolver?: PromptResolver;
}

/**
 * Create a completion handler based on agent definition.
 *
 * @deprecated For new code, prefer createCompletionHandlerV2 which provides
 * contract-compliant handlers with separated external state management.
 */
export async function createCompletionHandler(
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

  // If --issue is provided, always use IssueCompletionHandler regardless of completionType
  if (args.issue !== undefined) {
    const issueHandler = new IssueCompletionHandler(
      getIssueNumber(args),
      isOptionalString(args.repository) ? args.repository : undefined,
    );
    issueHandler.setPromptResolver(promptResolver);
    return issueHandler;
  }

  // Get factory from registry
  const factory = HANDLER_REGISTRY.get(completionType);
  if (!factory) {
    throw new Error(`Unknown completion type: ${completionType}`);
  }

  return await factory(args, promptResolver, definition, agentDir);
}

/**
 * Create a completion handler from options (alternative factory)
 */
export function createCompletionHandlerFromOptions(
  options: CompletionHandlerOptions,
): CompletionHandler {
  let handler: CompletionHandler;

  if (options.issue !== undefined) {
    const issueHandler = new IssueCompletionHandler(
      options.issue,
      options.repository,
    );
    if (options.promptResolver) {
      issueHandler.setPromptResolver(options.promptResolver);
    }
    handler = issueHandler;
  } else if (options.maxIterations !== undefined) {
    const iterateHandler = new IterateCompletionHandler(options.maxIterations);
    if (options.promptResolver) {
      iterateHandler.setPromptResolver(options.promptResolver);
    }
    handler = iterateHandler;
  } else if (options.completionKeyword !== undefined) {
    const manualHandler = new ManualCompletionHandler(
      options.completionKeyword,
    );
    if (options.promptResolver) {
      manualHandler.setPromptResolver(options.promptResolver);
    }
    handler = manualHandler;
  } else {
    // Default to iterate with 100 iterations
    handler = new IterateCompletionHandler(100);
  }

  return handler;
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

// ============================================================================
// V2 Factory (Contract-compliant)
// ============================================================================

/**
 * Options for creating a contract-compliant completion handler.
 */
export interface CompletionHandlerV2Options {
  /** Issue configuration (for issue completion) */
  issue?: IssueContractConfig;
  /** External state checker (optional, defaults to GitHubStateChecker) */
  stateChecker?: ExternalStateChecker;
  /** Default repository for GitHub operations */
  defaultRepo?: string;
}

/**
 * Create a contract-compliant completion handler.
 *
 * Unlike createCompletionHandler, this factory:
 * - Returns handlers that have no side effects in check()
 * - Requires explicit external state management via refreshState()
 * - Uses dependency injection for external state checkers
 *
 * Currently supports:
 * - Issue completion (IssueContractHandler)
 *
 * @example
 * ```typescript
 * // Create issue completion handler
 * const handler = createCompletionHandlerV2({
 *   issue: { issueNumber: 123, repo: "owner/repo" },
 * });
 *
 * // In the loop layer
 * await handler.refreshState?.();
 * const result = handler.check({ iteration: 1 });
 * ```
 */
export function createCompletionHandlerV2(
  options: CompletionHandlerV2Options,
): ContractCompletionHandler {
  if (options.issue) {
    const stateChecker = options.stateChecker ??
      new GitHubStateChecker(options.defaultRepo);

    return new IssueContractHandler(options.issue, stateChecker);
  }

  throw new Error(
    "createCompletionHandlerV2: No valid completion type specified. " +
      "Currently supported: issue",
  );
}

/**
 * Registry for custom completion handlers
 */
const customHandlers = new Map<
  string,
  (
    definition: AgentDefinition,
    args: Record<string, unknown>,
  ) => CompletionHandler
>();

/**
 * Register a custom completion handler factory
 */
export function registerCompletionHandler(
  type: string,
  factory: (
    definition: AgentDefinition,
    args: Record<string, unknown>,
  ) => CompletionHandler,
): void {
  customHandlers.set(type, factory);
}

/**
 * Get a registered custom handler factory
 */
export function getRegisteredHandler(
  type: string,
):
  | ((
    definition: AgentDefinition,
    args: Record<string, unknown>,
  ) => CompletionHandler)
  | undefined {
  return customHandlers.get(type);
}
