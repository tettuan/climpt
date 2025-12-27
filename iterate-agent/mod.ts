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
 * import { parseCliArgs, loadConfig, createLogger } from "@aidevtool/climpt/iterate-agent";
 *
 * const options = parseCliArgs(["--issue", "123"]);
 * const config = await loadConfig();
 * const logger = await createLogger("./logs", "climpt");
 * ```
 *
 * @example Type-only imports
 * ```typescript
 * import type {
 *   AgentOptions,
 *   AgentConfig,
 *   IterateAgentConfig,
 *   LogEntry,
 * } from "@aidevtool/climpt/iterate-agent";
 * ```
 */

// Re-export types
export type {
  AgentConfig,
  AgentName,
  AgentOptions,
  CompletionCheckResult,
  CompletionType,
  GitHubIssue,
  GitHubProject,
  IterateAgentConfig,
  LogEntry,
  LogLevel,
  PermissionMode,
  PromptContext,
} from "./scripts/types.ts";

// Re-export CLI functions
export { displayHelp, parseCliArgs } from "./scripts/cli.ts";

// Re-export config functions
export {
  ensureLogDirectory,
  getAgentConfig,
  getGitHubToken,
  loadConfig,
  loadSystemPromptTemplate,
} from "./scripts/config.ts";

// Re-export logger
export { createLogger, Logger } from "./scripts/logger.ts";

// Re-export prompt builders
export {
  buildContinuationPrompt,
  buildInitialPrompt,
  buildSystemPrompt,
} from "./scripts/prompts.ts";

// Re-export GitHub integration functions
export {
  fetchIssueRequirements,
  fetchProjectRequirements,
  isIssueComplete,
  isProjectComplete,
} from "./scripts/github.ts";
