/**
 * Merge Utility Module
 *
 * Branch merge operations for agent integration.
 */

import type { MergeResult, MergeStrategy } from "./types.ts";

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
 * Execute a git command and return the result
 */
async function runGit(
  args: string[],
  cwd?: string,
): Promise<{ success: boolean; output: string; error: string }> {
  const command = new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  return {
    success: code === 0,
    output: new TextDecoder().decode(stdout).trim(),
    error: new TextDecoder().decode(stderr).trim(),
  };
}

/**
 * Get the list of conflicting files
 */
async function getConflictFiles(cwd?: string): Promise<string[]> {
  const result = await runGit(["diff", "--name-only", "--diff-filter=U"], cwd);
  if (!result.success || !result.output) {
    return [];
  }
  return result.output.split("\n").filter((f) => f.length > 0);
}

/**
 * Abort an ongoing merge
 */
export async function abortMerge(cwd?: string): Promise<void> {
  await runGit(["merge", "--abort"], cwd);
}

/**
 * Checkout a branch
 */
export async function checkoutBranch(
  branchName: string,
  cwd?: string,
): Promise<boolean> {
  const result = await runGit(["checkout", branchName], cwd);
  return result.success;
}

/**
 * Attempt a fast-forward merge
 */
async function tryFastForward(
  sourceBranch: string,
  cwd?: string,
): Promise<MergeResult> {
  const result = await runGit(["merge", "--ff-only", sourceBranch], cwd);

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
  const squashResult = await runGit(["merge", "--squash", sourceBranch], cwd);

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
  const commitResult = await runGit(
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
  const result = await runGit(
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

  // Try each strategy in order
  for (const strategy of strategies) {
    let result: MergeResult;

    switch (strategy) {
      case "fast-forward":
        result = await tryFastForward(sourceBranch, cwd);
        break;
      case "squash":
        result = await trySquash(sourceBranch, cwd);
        break;
      case "merge-commit":
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
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(cwd?: string): Promise<boolean> {
  const result = await runGit(["status", "--porcelain"], cwd);
  return result.output.length > 0;
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(cwd?: string): Promise<string> {
  const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return result.output;
}

/**
 * Push the current branch to remote
 */
export async function pushBranch(
  branchName: string,
  cwd?: string,
): Promise<boolean> {
  const result = await runGit(["push", "-u", "origin", branchName], cwd);
  return result.success;
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
