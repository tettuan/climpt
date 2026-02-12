/**
 * Merge Utility Module
 *
 * Branch merge operations for agent integration.
 */

import type { MergeResult, MergeStrategy } from "./types.ts";
import { checkoutBranch, runGitSafe } from "./git-utils.ts";

// Re-export git utilities from canonical source (git-utils.ts)
export {
  checkoutBranch,
  getCurrentBranch,
  hasUncommittedChanges,
  pushBranch,
} from "./git-utils.ts";

/**
 * Merge strategy order for Iterator agent
 * Iterator tends to have many changes, so squash is preferred
 */
export const ITERATOR_MERGE_ORDER: MergeStrategy[] = [
  "squash",
  "fast-forward",
  "merge-commit",
];

/**
 * Merge strategy order for Reviewer agent
 * Reviewer tends to have few changes, so fast-forward is preferred
 */
export const REVIEWER_MERGE_ORDER: MergeStrategy[] = [
  "fast-forward",
  "squash",
  "merge-commit",
];

/**
 * Get the list of conflicting files
 */
async function getConflictFiles(cwd?: string): Promise<string[]> {
  const result = await runGitSafe(
    ["diff", "--name-only", "--diff-filter=U"],
    cwd,
  );
  if (!result.success || !result.output) {
    return [];
  }
  return result.output.split("\n").filter((f) => f.length > 0);
}

/**
 * Abort an ongoing merge
 */
export async function abortMerge(cwd?: string): Promise<void> {
  await runGitSafe(["merge", "--abort"], cwd);
}

/**
 * Attempt a fast-forward merge
 */
async function tryFastForward(
  sourceBranch: string,
  cwd?: string,
): Promise<MergeResult> {
  const result = await runGitSafe(["merge", "--ff-only", sourceBranch], cwd);

  if (result.success) {
    return { success: true, strategy: "fast-forward" };
  }

  return {
    success: false,
    strategy: "fast-forward",
    error: result.error,
  };
}

/**
 * Attempt a squash merge
 */
async function trySquash(
  sourceBranch: string,
  cwd?: string,
): Promise<MergeResult> {
  // Squash merge
  const squashResult = await runGitSafe(
    ["merge", "--squash", sourceBranch],
    cwd,
  );

  if (!squashResult.success) {
    // Check for conflicts
    const conflictFiles = await getConflictFiles(cwd);
    if (conflictFiles.length > 0) {
      await abortMerge(cwd);
      return {
        success: false,
        strategy: "squash",
        error: "Merge conflict",
        conflictFiles,
      };
    }
    return {
      success: false,
      strategy: "squash",
      error: squashResult.error,
    };
  }

  // Commit the squashed changes
  const commitResult = await runGitSafe(
    ["commit", "-m", `Squash merge branch '${sourceBranch}'`],
    cwd,
  );

  if (!commitResult.success) {
    // No changes to commit (already up to date)
    if (commitResult.error.includes("nothing to commit")) {
      return { success: true, strategy: "squash" };
    }
    return {
      success: false,
      strategy: "squash",
      error: commitResult.error,
    };
  }

  return { success: true, strategy: "squash" };
}

/**
 * Attempt a standard merge commit
 */
async function tryMergeCommit(
  sourceBranch: string,
  cwd?: string,
): Promise<MergeResult> {
  const result = await runGitSafe(
    ["merge", "--no-ff", "-m", `Merge branch '${sourceBranch}'`, sourceBranch],
    cwd,
  );

  if (result.success) {
    return { success: true, strategy: "merge-commit" };
  }

  // Check for conflicts
  const conflictFiles = await getConflictFiles(cwd);
  if (conflictFiles.length > 0) {
    await abortMerge(cwd);
    return {
      success: false,
      strategy: "merge-commit",
      error: "Merge conflict",
      conflictFiles,
    };
  }

  return {
    success: false,
    strategy: "merge-commit",
    error: result.error,
  };
}

/**
 * Merge a source branch into the target branch using the specified strategies
 *
 * Tries each strategy in order until one succeeds.
 *
 * @param sourceBranch - Branch to merge from
 * @param targetBranch - Branch to merge into (current branch should be this)
 * @param strategies - Ordered list of strategies to try
 * @param cwd - Working directory
 * @returns Merge result with the strategy used
 */
export async function mergeBranch(
  sourceBranch: string,
  targetBranch: string,
  strategies: MergeStrategy[],
  cwd?: string,
): Promise<MergeResult> {
  // Ensure we're on the target branch
  const checkoutSuccess = await checkoutBranch(targetBranch, cwd);
  if (!checkoutSuccess) {
    return {
      success: false,
      strategy: strategies[0],
      error: `Failed to checkout target branch: ${targetBranch}`,
    };
  }

  // Sequential execution required: try strategies one at a time until success
  for (const strategy of strategies) {
    let result: MergeResult;

    switch (strategy) {
      case "fast-forward":
        // deno-lint-ignore no-await-in-loop
        result = await tryFastForward(sourceBranch, cwd);
        break;
      case "squash":
        // deno-lint-ignore no-await-in-loop
        result = await trySquash(sourceBranch, cwd);
        break;
      case "merge-commit":
        // deno-lint-ignore no-await-in-loop
        result = await tryMergeCommit(sourceBranch, cwd);
        break;
    }

    if (result.success) {
      return result;
    }

    // If there's a conflict, return immediately with conflict info
    if (result.conflictFiles && result.conflictFiles.length > 0) {
      return result;
    }

    // Otherwise, try the next strategy
  }

  // All strategies failed
  return {
    success: false,
    strategy: strategies[strategies.length - 1],
    error: "All merge strategies failed",
  };
}

/**
 * Auto-commit all changes with the given message
 *
 * This is used to ensure worktree changes are preserved before cleanup.
 *
 * @param message - Commit message
 * @param cwd - Working directory
 * @returns true if commit succeeded, false otherwise
 */
export async function autoCommitChanges(
  message: string,
  cwd?: string,
): Promise<{ success: boolean; error?: string }> {
  // Stage all changes (including untracked)
  const addResult = await runGitSafe(["add", "-A"], cwd);
  if (!addResult.success) {
    return { success: false, error: addResult.error };
  }

  // Commit
  const commitResult = await runGitSafe(["commit", "-m", message], cwd);
  if (!commitResult.success) {
    // "nothing to commit" is not an error
    if (commitResult.error.includes("nothing to commit")) {
      return { success: true };
    }
    return { success: false, error: commitResult.error };
  }

  return { success: true };
}

/**
 * Create a pull request using gh CLI
 *
 * @param title - PR title
 * @param body - PR body
 * @param baseBranch - Base branch for the PR
 * @param cwd - Working directory
 * @returns PR URL if successful, undefined otherwise
 */
export async function createPullRequest(
  title: string,
  body: string,
  baseBranch: string,
  cwd?: string,
): Promise<string | undefined> {
  const command = new Deno.Command("gh", {
    args: [
      "pr",
      "create",
      "--title",
      title,
      "--body",
      body,
      "--base",
      baseBranch,
    ],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout } = await command.output();

  if (code === 0) {
    return new TextDecoder().decode(stdout).trim();
  }

  return undefined;
}
