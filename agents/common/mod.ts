/**
 * Common Agent Modules
 *
 * Shared types and utilities for all agent implementations.
 */

export * from "./types.ts";
export { createLogger, Logger, summarizeToolInput } from "./logger.ts";

// Worktree utilities
export {
  cleanupWorktree,
  createWorktree,
  generateBranchName,
  getCurrentBranch,
  getMainWorktreePath,
  getRepoRoot,
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
