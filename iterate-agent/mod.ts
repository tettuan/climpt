/**
 * Iterate Agent Module
 *
 * Autonomous agent that executes development cycles through iterations.
 * Uses Claude Agent SDK to work on GitHub Issues, Projects, or run for a set number of iterations.
 *
 * @module
 *
 * @example Basic usage
 * ```typescript
 * import {
 *   parseCliArgs,
 *   loadConfig,
 *   createLogger,
 *   createCompletionHandler,
 * } from "@aidevtool/climpt/iterate-agent";
 *
 * const options = parseCliArgs(["--issue", "123"]);
 * const config = await loadConfig();
 * const handler = createCompletionHandler(options);
 * const logger = await createLogger("./logs", "climpt");
 * ```
 *
 * @example Type-only imports
 * ```typescript
 * import type {
 *   AgentOptions,
 *   AgentConfig,
 *   IterateAgentConfig,
 *   CompletionHandler,
 *   LogEntry,
 * } from "@aidevtool/climpt/iterate-agent";
 * ```
 */

// Re-export types from types.ts
export type {
  AgentConfig,
  AgentName,
  AgentOptions,
  CompletionCheckResult,
  GitHubIssue,
  GitHubProject,
  IterateAgentConfig,
  IterationSummary,
  LogEntry,
  LogLevel,
  ParsedArgs,
  PermissionMode,
  PromptContext,
  UvVariables,
} from "./scripts/types.ts";

// Re-export completion handler types and factory
export {
  createCompletionHandler,
  formatIterationSummary,
  IssueCompletionHandler,
  IterateCompletionHandler,
  ProjectCompletionHandler,
} from "./scripts/completion/mod.ts";

export type {
  CompletionCriteria,
  CompletionHandler,
  CompletionType,
} from "./scripts/completion/mod.ts";

// Re-export message handler functions
export {
  captureIterationData,
  isSkillInvocation,
  logSDKMessage,
} from "./scripts/message-handler.ts";

// Re-export CLI functions
export { displayHelp, parseCliArgs } from "./scripts/cli.ts";

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
