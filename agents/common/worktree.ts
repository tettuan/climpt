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

/** Flag to force delete branch even if not fully merged */
const FORCE_DELETE = true;

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
    const deleted = await deleteBranch(worktreeBranch, parentCwd, FORCE_DELETE);
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
  const deleted = await deleteBranch(worktreeBranch, parentCwd, FORCE_DELETE);

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

// ============================================================================
// Finalize Worktree Branch
// ============================================================================

/**
 * Options for finalizing worktree branch
 */
export interface FinalizeOptions {
  /** Whether to automatically merge worktree branch to base (default: true) */
  autoMerge?: boolean;
  /** Whether to push after merge (default: false) */
  push?: boolean;
  /** Remote to push to (default: origin) */
  remote?: string;
  /** Whether to create a PR instead of direct merge (default: false) */
  createPr?: boolean;
  /** Target branch for PR (default: base branch) */
  prTarget?: string;
  /** Logger for observability */
  logger?: FinalizeLogger;
}

/**
 * Logger interface for finalize operations
 */
export interface FinalizeLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Result of finalizing worktree branch
 */
export interface FinalizationOutcome {
  /** Overall status */
  status: "success" | "partial" | "failed";
  /** Merge result */
  merge?: {
    success: boolean;
    commitsMerged: number;
    error?: string;
  };
  /** Push result */
  push?: {
    success: boolean;
    remote?: string;
    error?: string;
  };
  /** PR creation result */
  pr?: {
    success: boolean;
    url?: string;
    error?: string;
  };
  /** Whether worktree was cleaned up */
  cleanedUp: boolean;
  /** Pending actions for retry (on partial failure) */
  pendingActions?: string[];
  /** Overall reason/description */
  reason: string;
}

/**
 * Finalize worktree branch - the complete sequence for Flow success
 *
 * Sequence: merge -> push -> optional PR -> cleanup
 *
 * On success, cleans up worktree.
 * On failure, preserves worktree for recovery.
 *
 * @param worktreeResult - Setup result from setupWorktree
 * @param options - Finalize options
 * @param parentCwd - Working directory of main repository
 * @returns Finalization outcome
 */
export async function finalizeWorktreeBranch(
  worktreeResult: WorktreeSetupResult,
  options: FinalizeOptions,
  parentCwd: string,
): Promise<FinalizationOutcome> {
  const {
    autoMerge = true,
    push = false,
    remote = "origin",
    createPr = false,
    logger,
  } = options;

  const log = logger ?? {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const outcome: FinalizationOutcome = {
    status: "success",
    cleanedUp: false,
    reason: "",
  };

  const pendingActions: string[] = [];

  // Step 1: Merge worktree branch into base
  if (autoMerge) {
    log.info("[finalize.merge] Merging worktree branch", {
      branch: worktreeResult.branchName,
      base: worktreeResult.baseBranch,
    });

    try {
      const mergeResult = await mergeWorktreeBranch(
        worktreeResult.branchName,
        worktreeResult.baseBranch,
        parentCwd,
      );

      outcome.merge = {
        success: mergeResult.merged,
        commitsMerged: mergeResult.commitsMerged,
        error: mergeResult.merged ? undefined : mergeResult.reason,
      };

      if (mergeResult.merged) {
        log.info("[finalize.merge] Merge successful", {
          commits: mergeResult.commitsMerged,
        });
      } else if (mergeResult.commitsMerged === 0) {
        log.info("[finalize.merge] No commits to merge", {
          reason: mergeResult.reason,
        });
        outcome.merge.success = true; // No-op is still success
      } else {
        log.error("[finalize.merge] Merge failed", {
          reason: mergeResult.reason,
        });
        pendingActions.push("Resolve merge conflict and retry");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      outcome.merge = {
        success: false,
        commitsMerged: 0,
        error: errorMsg,
      };
      log.error("[finalize.merge] Merge exception", { error: errorMsg });
      pendingActions.push(`Fix merge error: ${errorMsg}`);
    }
  }

  // Step 2: Push to remote
  if (push && (!autoMerge || outcome.merge?.success)) {
    log.info("[finalize.push] Pushing to remote", {
      remote,
      branch: worktreeResult.baseBranch,
    });

    try {
      await runGit(["push", remote, worktreeResult.baseBranch], parentCwd);
      outcome.push = { success: true, remote };
      log.info("[finalize.push] Push successful", { remote });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      outcome.push = { success: false, remote, error: errorMsg };
      log.error("[finalize.push] Push failed", { error: errorMsg });
      pendingActions.push(`Push failed: ${errorMsg}`);
    }
  }

  // Step 3: Create PR (if requested and merge failed or skipped)
  if (createPr && !autoMerge) {
    const prTarget = options.prTarget ?? worktreeResult.baseBranch;
    log.info("[finalize.pr] Creating PR", {
      head: worktreeResult.branchName,
      base: prTarget,
    });

    try {
      // First push the branch
      await runGit(
        ["push", "-u", remote, worktreeResult.branchName],
        parentCwd,
      );

      // Create PR using gh CLI
      const prOutput = await new Deno.Command("gh", {
        args: [
          "pr",
          "create",
          "--head",
          worktreeResult.branchName,
          "--base",
          prTarget,
          "--fill",
        ],
        cwd: parentCwd,
        stdout: "piped",
        stderr: "piped",
      }).output();

      if (prOutput.success) {
        const prUrl = new TextDecoder().decode(prOutput.stdout).trim();
        outcome.pr = { success: true, url: prUrl };
        log.info("[finalize.pr] PR created", { url: prUrl });
      } else {
        const stderr = new TextDecoder().decode(prOutput.stderr);
        throw new Error(stderr);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      outcome.pr = { success: false, error: errorMsg };
      log.error("[finalize.pr] PR creation failed", { error: errorMsg });
      pendingActions.push(`Create PR manually: ${errorMsg}`);
    }
  }

  // Determine overall status
  const mergeOk = !autoMerge || outcome.merge?.success;
  const pushOk = !push || outcome.push?.success;
  const prOk = !createPr || outcome.pr?.success;

  if (mergeOk && pushOk && prOk) {
    outcome.status = "success";
    outcome.reason = "Finalization completed successfully";
  } else if (outcome.merge?.success || outcome.push?.success) {
    outcome.status = "partial";
    outcome.reason = "Finalization partially completed";
    outcome.pendingActions = pendingActions;
  } else {
    outcome.status = "failed";
    outcome.reason = "Finalization failed";
    outcome.pendingActions = pendingActions;
  }

  // Step 4: Cleanup worktree only on full success
  if (outcome.status === "success") {
    log.info("[finalize.cleanup] Cleaning up worktree", {
      path: worktreeResult.worktreePath,
    });

    try {
      await cleanupWorktree(worktreeResult.worktreePath, parentCwd);
      outcome.cleanedUp = true;
      log.info("[finalize.cleanup] Worktree removed");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.warn("[finalize.cleanup] Cleanup failed", { error: errorMsg });
      outcome.cleanedUp = false;
    }
  } else {
    log.warn("[finalize.cleanup] Skipping cleanup due to finalization status", {
      status: outcome.status,
    });
    outcome.cleanedUp = false;
  }

  return outcome;
}
