/**
 * Completion handler factory
 */

import type { AgentDefinition } from "../src_common/types.ts";
import { PromptResolver } from "../prompts/resolver.ts";
import type { CompletionHandler } from "./types.ts";
import { IssueCompletionHandler } from "./issue.ts";
import { ProjectCompletionHandler } from "./project.ts";
import { IterateCompletionHandler } from "./iterate.ts";
import { ManualCompletionHandler } from "./manual.ts";

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
 */
export async function createCompletionHandler(
  definition: AgentDefinition,
  args: Record<string, unknown>,
  agentDir: string,
): Promise<CompletionHandler> {
  const { completionType, completionConfig } = definition.behavior;

  // Create prompt resolver for handlers
  const promptResolver = await PromptResolver.create({
    agentName: definition.name,
    agentDir,
    registryPath: definition.prompts.registry,
    fallbackDir: definition.prompts.fallbackDir,
  });

  let handler: CompletionHandler;

  // If --issue is provided, always use IssueCompletionHandler regardless of completionType
  if (args.issue !== undefined) {
    const issueHandler = new IssueCompletionHandler(
      args.issue as number,
      args.repository as string | undefined,
    );
    issueHandler.setPromptResolver(promptResolver);
    return issueHandler;
  }

  switch (completionType) {
    case "issue": {
      const issueHandler = new IssueCompletionHandler(
        args.issue as number,
        args.repository as string | undefined,
      );
      issueHandler.setPromptResolver(promptResolver);
      handler = issueHandler;
      break;
    }

    case "project": {
      const projectHandler = new ProjectCompletionHandler(
        args.project as number,
        args.label as string | undefined,
        args.includeCompleted as boolean | undefined,
        args.projectOwner as string | undefined,
      );
      projectHandler.setPromptResolver(promptResolver);
      handler = projectHandler;
      break;
    }

    case "iterate": {
      const iterateHandler = new IterateCompletionHandler(
        completionConfig.maxIterations ?? 100,
      );
      iterateHandler.setPromptResolver(promptResolver);
      handler = iterateHandler;
      break;
    }

    case "manual": {
      const manualHandler = new ManualCompletionHandler(
        completionConfig.completionKeyword ?? "TASK_COMPLETE",
      );
      manualHandler.setPromptResolver(promptResolver);
      handler = manualHandler;
      break;
    }

    case "custom":
      handler = await loadCustomHandler(
        definition,
        completionConfig.handlerPath!,
        args,
        agentDir,
      );
      break;

    default:
      throw new Error(`Unknown completion type: ${completionType}`);
  }

  return handler;
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
      options.includeCompleted,
      options.projectOwner,
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
