/**
 * Completion handler factory
 *
 * Supports both new behavior-based type names and legacy aliases.
 * Legacy types are automatically resolved to their new equivalents.
 */

import type { AgentDefinition } from "../src_common/types.ts";
import {
  isLegacyCompletionType,
  resolveCompletionType,
} from "../src_common/types.ts";
import { PromptResolver } from "../prompts/resolver.ts";
import type { CompletionHandler } from "./types.ts";
import { IssueCompletionHandler } from "./issue.ts";
import { ProjectCompletionHandler } from "./project.ts";
import { IterateCompletionHandler } from "./iterate.ts";
import { ManualCompletionHandler } from "./manual.ts";
import { FacilitatorCompletionHandler } from "./facilitator.ts";
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

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
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
 * Validate and extract project number from args
 */
function getProjectNumber(args: Record<string, unknown>): number {
  if (!isNumber(args.project)) {
    throw new Error(`Invalid project number: ${args.project}`);
  }
  return args.project;
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

// phaseCompletion (was: project) - Complete when workflow reaches terminal phase
registerHandler("phaseCompletion", (args, promptResolver) => {
  const projectHandler = new ProjectCompletionHandler(
    getProjectNumber(args),
    isOptionalString(args.label) ? args.label : undefined,
    isOptionalString(args.projectOwner) ? args.projectOwner : undefined,
    isOptionalBoolean(args.includeCompleted)
      ? args.includeCompleted
      : undefined,
  );
  projectHandler.setPromptResolver(promptResolver);
  return projectHandler;
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

// composite (was: facilitator) - Combines multiple conditions
registerHandler("composite", (args, promptResolver, definition, agentDir) => {
  const { completionConfig } = definition.behavior;
  // Check if using new composite config with conditions
  if (completionConfig.conditions && completionConfig.operator) {
    const compositeHandler = new CompositeCompletionHandler(
      completionConfig.operator,
      completionConfig.conditions,
      args,
      agentDir,
      definition,
    );
    compositeHandler.setPromptResolver(promptResolver);
    return compositeHandler;
  } else {
    // Legacy facilitator behavior - use FacilitatorCompletionHandler
    const facilitatorHandler = new FacilitatorCompletionHandler(
      getProjectNumber(args),
      isOptionalString(args.projectOwner) ? args.projectOwner : undefined,
    );
    facilitatorHandler.setPromptResolver(promptResolver);
    return facilitatorHandler;
  }
});

// stepMachine (was: stepFlow) - Complete when step state machine reaches terminal
registerHandler("stepMachine", (_args, promptResolver, definition) => {
  // stepMachine uses the step flow infrastructure
  // For now, default to iterate behavior until full step flow integration
  // TODO: Implement StepMachineCompletionHandler when step flow is fully integrated
  const iterateHandler = new IterateCompletionHandler(
    definition.behavior.completionConfig.maxIterations ?? 100,
  );
  iterateHandler.setPromptResolver(promptResolver);
  return iterateHandler;
});

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
  /** Project number (for project completion) */
  project?: number;
  /** Project owner (for project completion) */
  projectOwner?: string;
  /** Label filter (for project completion) */
  labelFilter?: string;
  /** Include completed items (for project completion) */
  includeCompleted?: boolean;
  /** Max iterations (for iterate completion) */
  maxIterations?: number;
  /** Completion keyword (for manual completion) */
  completionKeyword?: string;
  /** Prompt resolver (optional) */
  promptResolver?: PromptResolver;
}

/**
 * Create a completion handler based on agent definition
 *
 * Supports both new behavior-based type names and legacy aliases.
 * The factory resolves legacy names to their new equivalents automatically.
 */
export async function createCompletionHandler(
  definition: AgentDefinition,
  args: Record<string, unknown>,
  agentDir: string,
): Promise<CompletionHandler> {
  const { completionType } = definition.behavior;

  // Resolve legacy type names to new names
  const resolvedType = resolveCompletionType(completionType);

  // Warn about deprecated completion type names at runtime
  if (isLegacyCompletionType(completionType)) {
    // deno-lint-ignore no-console
    console.warn(
      `[Deprecated] CompletionType "${completionType}" is deprecated. ` +
        `Use "${resolvedType}" instead. ` +
        `This will be removed in a future version.`,
    );
  }

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
  const factory = HANDLER_REGISTRY.get(resolvedType);
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
  } else if (options.project !== undefined) {
    const projectHandler = new ProjectCompletionHandler(
      options.project,
      options.labelFilter,
      options.projectOwner,
      options.includeCompleted,
    );
    if (options.promptResolver) {
      projectHandler.setPromptResolver(options.promptResolver);
    }
    handler = projectHandler;
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
