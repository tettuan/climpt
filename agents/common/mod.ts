/**
 * Common Agent Modules
 *
 * Shared types and utilities for all agent implementations.
 */

export * from "./types.ts";
export { createLogger, Logger, summarizeToolInput } from "./logger.ts";

// Git utilities (shared)
export {
  checkoutBranch as gitCheckoutBranch,
  commit as gitCommit,
  getCurrentBranch,
  getRepoRoot,
  GitCommandError,
  type GitCommandResult,
  hasUncommittedChanges as gitHasUncommittedChanges,
  isInsideWorktree as gitIsInsideWorktree,
  pushBranch as gitPushBranch,
  runGit,
  runGitSafe,
  stageAll,
} from "./git-utils.ts";

// Worktree utilities
export {
  cleanupWorktree,
  createWorktree,
  generateBranchName,
  getMainWorktreePath,
  isInsideWorktree,
  listWorktrees,
  removeWorktree,
  setupWorktree,
  worktreeExists,
} from "./worktree.ts";

// Merge utilities
export {
  abortMerge,
  checkoutBranch,
  createPullRequest,
  getCurrentBranch as getMergeBranch,
  hasUncommittedChanges,
  ITERATOR_MERGE_ORDER,
  mergeBranch,
  pushBranch,
  REVIEWER_MERGE_ORDER,
} from "./merge.ts";

// Step registry for prompt externalization
export type {
  PromptStepDefinition,
  RegistryLoaderOptions,
  StepDefinition, // @deprecated: use PromptStepDefinition
  StepRegistry,
} from "./step-registry.ts";
export {
  addStepDefinition,
  createEmptyRegistry,
  getStepDefinition,
  getStepIds,
  hasStep,
  loadStepRegistry,
  saveStepRegistry,
  serializeRegistry,
  validateStepRegistry,
} from "./step-registry.ts";

// Prompt resolver for external prompt resolution
export type {
  FallbackPromptProvider,
  PromptResolutionResult,
  PromptResolverOptions,
  PromptVariables,
} from "./prompt-resolver.ts";
export {
  createFallbackProvider,
  parseFrontmatter,
  PromptResolver,
  removeFrontmatter,
} from "./prompt-resolver.ts";

// Prompt logger for resolution logging
export type {
  PromptLoggerOptions,
  PromptResolutionLog,
} from "./prompt-logger.ts";
export {
  formatResolutionSummary,
  logPromptResolution,
  PromptLogger,
  timePromptResolution,
} from "./prompt-logger.ts";
