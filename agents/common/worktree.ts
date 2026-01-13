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
  getCurrentBranch,
  getRepoRoot,
  isInsideWorktree as gitIsInsideWorktree,
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
 * Get the main worktree path (original repository)
 */
export async function getMainWorktreePath(cwd?: string): Promise<string> {
  const worktrees = await listWorktrees(cwd);
  // The first worktree in the list is always the main one
  return worktrees[0] ?? "";
}
