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
  AgentName,
  PermissionMode,
  LogLevel,
  CompletionType,
  AgentOptions,
  AgentConfig,
  IterateAgentConfig,
  LogEntry,
  GitHubIssue,
  GitHubProject,
  CompletionCheckResult,
  PromptContext,
} from "./scripts/types.ts";

// Re-export CLI functions
export { parseCliArgs, displayHelp } from "./scripts/cli.ts";

// Re-export config functions
export {
  loadConfig,
  getAgentConfig,
  loadSystemPromptTemplate,
  getGitHubToken,
  ensureLogDirectory,
} from "./scripts/config.ts";

// Re-export logger
export { Logger, createLogger } from "./scripts/logger.ts";

// Re-export prompt builders
export {
  buildSystemPrompt,
  buildInitialPrompt,
  buildContinuationPrompt,
} from "./scripts/prompts.ts";

// Re-export GitHub integration functions
export {
  fetchIssueRequirements,
  fetchProjectRequirements,
  isIssueComplete,
  isProjectComplete,
} from "./scripts/github.ts";
