/**
 * Review Agent Module
 *
 * Autonomous agent that verifies implementation against requirements
 * and creates issues for any identified gaps.
 *
 * @module
 *
 * @example Basic usage
 * ```typescript
 * import {
 *   parseCliArgs,
 *   loadConfig,
 *   createLogger,
 * } from "@aidevtool/climpt/review-agent";
 *
 * const options = parseCliArgs(["--project", "my-project", "--issue", "123"]);
 * const config = await loadConfig();
 * const logger = await createLogger("./logs", "reviewer");
 * ```
 *
 * @example Type-only imports
 * ```typescript
 * import type {
 *   ReviewOptions,
 *   ReviewAgentConfig,
 *   ReviewSummary,
 *   ReviewAction,
 *   LogEntry,
 * } from "@aidevtool/climpt/review-agent";
 * ```
 */

// Re-export types from types.ts
export type {
  AgentConfig,
  AgentName,
  ExecutionReport,
  GitHubIssue,
  IterationSummary,
  LogEntry,
  LogLevel,
  ParsedArgs,
  PermissionMode,
  RequirementItem,
  RequiredParam,
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
export { displayHelp, parseCliArgs } from "./scripts/cli.ts";

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
