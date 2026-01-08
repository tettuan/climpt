/**
 * Iterate Agent Module
 *
 * Autonomous agent that executes development cycles through iterations.
 * Uses the unified AgentRunner architecture with Claude Agent SDK.
 *
 * @module
 *
 * @example Basic usage with AgentRunner (recommended)
 * ```typescript
 * import { createIteratorRunner } from "@aidevtool/climpt/agents/iterator";
 *
 * const runner = await createIteratorRunner();
 * const result = await runner.run({
 *   args: { issue: 123 },
 *   plugins: ["/path/to/plugin"],
 * });
 * ```
 *
 * @example Direct CLI usage
 * ```bash
 * deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123
 * deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5
 * ```
 */

// Re-export types from the common architecture
export type {
  AgentDefinition,
  AgentResult,
  IterationSummary,
} from "../src_common/types.ts";

// Re-export runner components
export { AgentRunner, type RunnerOptions } from "../runner/mod.ts";
export {
  type CompletionCriteria,
  type CompletionHandler,
  createCompletionHandler,
} from "../completion/mod.ts";

// Re-export iterator-specific types
export type {
  AgentConfig,
  AgentName,
  AgentOptions,
  CompletionCheckResult,
  GitHubIssue,
  GitHubProject,
  IterateAgentConfig,
  LogEntry,
  LogLevel,
  ParsedArgs,
  PermissionMode,
  PromptContext,
  UvVariables,
} from "./scripts/types.ts";

// Re-export existing completion handler types and factory
export {
  createCompletionHandler as createIteratorCompletionHandler,
  formatIterationSummary,
  IssueCompletionHandler,
  IterateCompletionHandler,
  ProjectCompletionHandler,
} from "./scripts/completion/mod.ts";

export type {
  CompletionCriteria as IteratorCompletionCriteria,
  CompletionHandler as IteratorCompletionHandler,
  CompletionType,
} from "./scripts/completion/mod.ts";

// Re-export message handler functions
export {
  captureIterationData,
  isSkillInvocation,
  logSDKMessage,
} from "./scripts/message-handler.ts";

// Re-export CLI functions
export { displayHelp, parseCliArgs, toRunnerOptions } from "./scripts/cli.ts";

// Re-export config functions
export {
  ensureLogDirectory,
  getAgentConfig,
  loadConfig,
  loadSystemPromptViaC3L,
} from "./scripts/config.ts";

export type { CompletionMode } from "./scripts/config.ts";

// Re-export logger
export { createLogger, Logger } from "./scripts/logger.ts";

// Re-export GitHub integration functions
export {
  fetchIssueRequirements,
  fetchProjectRequirements,
  isIssueComplete,
  isProjectComplete,
} from "./scripts/github.ts";

// Import for factory function
import { AgentRunner, type RunnerOptions } from "../runner/mod.ts";
import { loadAgentDefinition } from "../runner/loader.ts";

/**
 * Create an iterator agent runner with default configuration
 *
 * This is the recommended way to create an iterator agent instance
 * using the new unified architecture.
 *
 * @param cwd - Working directory (defaults to Deno.cwd())
 * @returns Configured AgentRunner instance
 */
export async function createIteratorRunner(
  cwd: string = Deno.cwd(),
): Promise<AgentRunner> {
  const definition = await loadAgentDefinition("iterator", cwd);
  return new AgentRunner(definition);
}

/**
 * Run the iterator agent with the given options
 *
 * Convenience function that creates a runner and executes it.
 *
 * @param options - Runner options including args and plugins
 * @returns Agent execution result
 */
export async function runIterator(options: RunnerOptions) {
  const runner = await createIteratorRunner(options.cwd);
  return runner.run(options);
}
