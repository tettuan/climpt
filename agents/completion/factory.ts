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

  switch (completionType) {
    case "issue":
      return new IssueCompletionHandler({
        issueNumber: args.issue as number,
        promptResolver,
      });

    case "project":
      return new ProjectCompletionHandler({
        projectNumber: args.project as number,
        promptResolver,
        labels: definition.github?.labels,
      });

    case "iterate":
      return new IterateCompletionHandler({
        maxIterations: completionConfig.maxIterations!,
        promptResolver,
      });

    case "manual":
      return new ManualCompletionHandler({
        completionKeyword: completionConfig.completionKeyword!,
        promptResolver,
      });

    case "custom":
      return await loadCustomHandler(
        definition,
        completionConfig.handlerPath!,
        args,
        agentDir,
      );

    default:
      throw new Error(`Unknown completion type: ${completionType}`);
  }
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
