/**
 * Worktree Utility Module
 *
 * Git worktree operations for agent isolation.
 */

import { resolve } from "@std/path";
import type {
  WorktreeCLIOptions,
  WorktreeSetupConfig,
  WorktreeSetupResult,
} from "./types.ts";
import {
  checkoutBranch,
  deleteBranch,
  getCommitsAhead,
  getCurrentBranch,
  getRepoRoot,
  hasCommitsToMerge,
  isInsideWorktree as gitIsInsideWorktree,
  mergeBranch,
  runGit,
} from "./git-utils.ts";

// Re-export for backwards compatibility
export { getCurrentBranch, getRepoRoot } from "./git-utils.ts";

/**
 * Generate a timestamped branch name
 * @example "feature/docs-20260105-143022"
 */
export function generateBranchName(baseName: string): string {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15); // yyyymmdd-hhmmss
  return `${baseName}-${timestamp}`;
}

/**
 * Check if a worktree exists at the given path
 */
export async function worktreeExists(worktreePath: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(worktreePath);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

/**
 * List all worktrees in the repository
 */
export async function listWorktrees(cwd?: string): Promise<string[]> {
  const output = await runGit(["worktree", "list", "--porcelain"], cwd);
  const lines = output.split("\n");
  const worktrees: string[] = [];

  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      worktrees.push(line.substring(9));
    }
  }

  return worktrees;
}

/**
 * Create a new worktree
 */
export async function createWorktree(
  worktreePath: string,
  branchName: string,
  baseBranch: string,
  cwd?: string,
): Promise<void> {
  // Create a new branch at the worktree location
  await runGit(
    ["worktree", "add", "-b", branchName, worktreePath, baseBranch],
    cwd,
  );
}

/**
 * Remove a worktree
 */
export async function removeWorktree(
  worktreePath: string,
  cwd?: string,
): Promise<void> {
  await runGit(["worktree", "remove", worktreePath, "--force"], cwd);
}

/**
 * Setup a worktree for agent execution
 *
 * @param config - Worktree configuration
 * @param options - CLI options
 * @param cwd - Current working directory (optional)
 * @returns Setup result with worktree path and branch info
 */
export async function setupWorktree(
  config: WorktreeSetupConfig,
  options: WorktreeCLIOptions,
  cwd?: string,
): Promise<WorktreeSetupResult> {
  // Get current branch as base if not specified
  const baseBranch = options.baseBranch ?? await getCurrentBranch(cwd);

  // Determine branch name
  const branchName = options.branch ?? generateBranchName(baseBranch);

  // Get repository root to calculate worktree path
  const repoRoot = await getRepoRoot(cwd);

  // Calculate worktree path: <worktreeRoot>/<branchName>/
  // Sanitize branch name for filesystem (replace / with -)
  const safeBranchName = branchName.replace(/\//g, "-");
  const worktreePath = resolve(repoRoot, config.worktreeRoot, safeBranchName);

  // Check if worktree already exists
  const exists = await worktreeExists(worktreePath);

  if (!exists) {
    // Create new worktree
    await createWorktree(worktreePath, branchName, baseBranch, cwd);
  }

  return {
    worktreePath,
    branchName,
    baseBranch,
    created: !exists,
  };
}

/**
 * Cleanup worktree after agent completion
 *
 * @param worktreePath - Path to the worktree to remove
 * @param cwd - Original working directory
 */
export async function cleanupWorktree(
  worktreePath: string,
  cwd?: string,
): Promise<void> {
  const exists = await worktreeExists(worktreePath);
  if (exists) {
    await removeWorktree(worktreePath, cwd);
  }
}

/**
 * Check if the current directory is inside a worktree
 */
export async function isInsideWorktree(cwd?: string): Promise<boolean> {
  return await gitIsInsideWorktree(cwd);
}

/**
 * Result of merging a worktree branch
 */
export interface MergeWorktreeResult {
  /** Whether the merge was successful */
  merged: boolean;
  /** Number of commits that were merged */
  commitsMerged: number;
  /** Whether the branch was deleted after merge */
  branchDeleted: boolean;
  /** Reason/description of what happened */
  reason: string;
}

/**
 * Merge worktree branch into parent branch
 *
 * This function:
 * 1. Checks if there are commits to merge
 * 2. Checks out the parent branch in the main repository
 * 3. Merges the worktree branch
 * 4. Deletes the worktree branch after successful merge
 *
 * @param worktreeBranch - The branch created for the worktree
 * @param parentBranch - The base branch to merge into
 * @param parentCwd - Working directory of the main repository (not worktree)
 * @returns Result of the merge operation
 */
export async function mergeWorktreeBranch(
  worktreeBranch: string,
  parentBranch: string,
  parentCwd: string,
): Promise<MergeWorktreeResult> {
  // Check if there are commits to merge
  const hasCommits = await hasCommitsToMerge(
    worktreeBranch,
    parentBranch,
    parentCwd,
  );

  if (!hasCommits) {
    // No commits to merge - just delete the branch
    const deleted = await deleteBranch(worktreeBranch, parentCwd, true);
    return {
      merged: false,
      commitsMerged: 0,
      branchDeleted: deleted,
      reason: "No commits to merge (worktree branch is same as parent)",
    };
  }

  // Count commits before merge
  const commitCount = await getCommitsAhead(
    worktreeBranch,
    parentBranch,
    parentCwd,
  );

  // Checkout parent branch
  const checkoutSuccess = await checkoutBranch(parentBranch, parentCwd);
  if (!checkoutSuccess) {
    return {
      merged: false,
      commitsMerged: 0,
      branchDeleted: false,
      reason: `Failed to checkout parent branch: ${parentBranch}`,
    };
  }

  // Merge worktree branch with merge commit
  const mergeResult = await mergeBranch(worktreeBranch, parentCwd, {
    noFf: true,
    message: `Merge branch '${worktreeBranch}' into ${parentBranch}`,
  });

  if (!mergeResult.success) {
    // Attempt to abort merge if it failed
    await runGit(["merge", "--abort"], parentCwd).catch(() => {
      // Ignore error - might not be in merge state
    });

    return {
      merged: false,
      commitsMerged: 0,
      branchDeleted: false,
      reason: `Merge failed: ${mergeResult.error}`,
    };
  }

  // Delete the worktree branch after successful merge
  const deleted = await deleteBranch(worktreeBranch, parentCwd, true);

  return {
    merged: true,
    commitsMerged: commitCount,
    branchDeleted: deleted,
    reason:
      `Successfully merged ${commitCount} commit(s) from ${worktreeBranch}`,
  };
}

/**
 * Get the main worktree path (original repository)
 */
export async function getMainWorktreePath(cwd?: string): Promise<string> {
  const worktrees = await listWorktrees(cwd);
  // The first worktree in the list is always the main one
  return worktrees[0] ?? "";
}
