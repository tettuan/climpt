/**
 * Review Agent Module
 *
 * Autonomous agent that verifies implementation against requirements
 * and creates issues for any identified gaps.
 * Uses the unified AgentRunner architecture with Claude Agent SDK.
 *
 * @module
 *
 * @example Basic usage with AgentRunner (recommended)
 * ```typescript
 * import { createReviewerRunner } from "@aidevtool/climpt/agents/reviewer";
 *
 * const runner = await createReviewerRunner();
 * const result = await runner.run({
 *   args: { project: 25, requirementsLabel: "docs", reviewLabel: "review" },
 *   plugins: ["/path/to/plugin"],
 * });
 * ```
 *
 * @example Direct CLI usage
 * ```bash
 * deno run -A jsr:@aidevtool/climpt/agents/reviewer --project 25
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

// Re-export reviewer-specific types
export type {
  AgentConfig,
  AgentName,
  ExecutionReport,
  GitHubIssue,
  IterationSummary as ReviewerIterationSummary,
  LogEntry,
  LogLevel,
  ParsedArgs,
  PermissionMode,
  RequiredParam,
  RequirementItem,
  ReviewAction,
  ReviewActionParseResult,
  ReviewActionType,
  ReviewAgentConfig,
  ReviewOptions,
  ReviewStatus,
  ReviewSummary,
  TraceabilityId,
} from "./scripts/types.ts";

// Re-export CLI functions
export { displayHelp, parseCliArgs, toRunnerOptions } from "./scripts/cli.ts";

// Re-export config functions
export {
  buildSystemPrompt,
  ensureLogDirectory,
  getAgentConfig,
  initializeConfig,
  loadConfig,
} from "./scripts/config.ts";

// Re-export logger
export { createLogger, Logger } from "./scripts/logger.ts";

// Re-export GitHub integration functions
export {
  addIssueComment,
  createGapIssue,
  executeReviewAction,
  fetchIssue,
  fetchProjectIssues,
  fetchProjectIssuesByLabel,
  fetchRequirementDoc,
  fetchRequirementsIssues,
  fetchReviewTargetIssues,
  getCurrentRepo,
  isIssueClosed,
  parseReviewActions,
  parseTraceabilityIds,
} from "./scripts/github.ts";

export type { ProjectItem } from "./scripts/github.ts";

// Re-export plugin resolver functions
export {
  resolvePluginPaths,
  resolvePluginPathsSafe,
} from "./scripts/plugin-resolver.ts";

export type { SdkPluginConfig } from "./scripts/plugin-resolver.ts";

// Re-export completion handler
export { DefaultReviewCompletionHandler } from "./scripts/completion/default.ts";

// Import for factory function
import { AgentRunner, type RunnerOptions } from "../runner/mod.ts";
import { loadAgentDefinition } from "../runner/loader.ts";

/**
 * Create a reviewer agent runner with default configuration
 *
 * This is the recommended way to create a reviewer agent instance
 * using the new unified architecture.
 *
 * @param cwd - Working directory (defaults to Deno.cwd())
 * @returns Configured AgentRunner instance
 */
export async function createReviewerRunner(
  cwd: string = Deno.cwd(),
): Promise<AgentRunner> {
  const definition = await loadAgentDefinition("reviewer", cwd);
  return new AgentRunner(definition);
}

/**
 * Run the reviewer agent with the given options
 *
 * Convenience function that creates a runner and executes it.
 *
 * @param options - Runner options including args and plugins
 * @returns Agent execution result
 */
export async function runReviewer(options: RunnerOptions) {
  const runner = await createReviewerRunner(options.cwd);
  return runner.run(options);
}
