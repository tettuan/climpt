/**
 * Agents Module
 *
 * Autonomous agents for development tasks using Claude Agent SDK.
 */

// Common types and utilities (existing)
export * from "./common/mod.ts";

// New agent framework exports (excluding conflicting names)
// Use src_mod.ts for direct imports of the new framework
export {
  // Actions
  type ActionContext,
  ActionDetector,
  ActionExecutor,
  type ActionHandler,
  agentExists,
  // Runner
  AgentRunner,
  BaseActionHandler,
  BaseCompletionHandler,
  // Completion
  type CompletionCriteria,
  type CompletionHandler,
  createCompletionHandler,
  type ExecutorOptions,
  FileActionHandler,
  generateAgentHelp,
  getAgentDir,
  getRegisteredHandler,
  GitHubCommentHandler,
  type GitHubContext,
  GitHubIssueHandler,
  // Init and CLI
  initAgent,
  IssueCompletionHandler,
  type IssueHandlerOptions,
  IterateCompletionHandler,
  type IterateHandlerOptions,
  listAgents,
  loadAgentDefinition,
  LogActionHandler,
  ManualCompletionHandler,
  type ManualHandlerOptions,
  parseCliArgs,
  type ParsedCliArgs,
  ProjectCompletionHandler,
  type ProjectHandlerOptions,
  registerCompletionHandler,
  run,
  type RunnerOptions,
  validateAgentDefinition,
} from "./src_mod.ts";

// Agent-specific exports are available via:
// - ./agents/iterator (iterate agent)
// - ./agents/reviewer (review agent)

// Re-export factory functions for convenience
export { createIteratorRunner, runIterator } from "./iterator/mod.ts";
export { createReviewerRunner, runReviewer } from "./reviewer/mod.ts";
