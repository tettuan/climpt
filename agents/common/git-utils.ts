/**
 * Git Utilities Module
 *
 * Shared git operations used across agent modules.
 * Consolidates common patterns from worktree.ts and merge.ts.
 */

/**
 * Result of a git command execution (safe variant)
 */
export interface GitCommandResult {
  success: boolean;
  output: string;
  error: string;
  exitCode: number;
}

/**
 * Git command error - canonical source: shared/errors/git-errors.ts
 */
import { GitCommandError } from "../shared/errors/git-errors.ts";
export { GitCommandError };

/**
 * Run git command and return result object (safe, no throw)
 *
 * Use this when you need to handle both success and failure cases.
 */
export async function runGitSafe(
  args: string[],
  cwd?: string,
): Promise<GitCommandResult> {
  const command = new Deno.Command("git", {
    args,
    cwd: cwd ?? Deno.cwd(),
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  return {
    success: code === 0,
    output: new TextDecoder().decode(stdout).trim(),
    error: new TextDecoder().decode(stderr).trim(),
    exitCode: code,
  };
}

/**
 * Run git command and throw on failure
 *
 * Use this when failure should stop execution.
 */
export async function runGit(args: string[], cwd?: string): Promise<string> {
  const result = await runGitSafe(args, cwd);

  if (!result.success) {
    throw new GitCommandError(args, result.error, result.exitCode);
  }

  return result.output;
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(cwd?: string): Promise<string> {
  return await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

/**
 * Get the repository root directory
 */
export async function getRepoRoot(cwd?: string): Promise<string> {
  return await runGit(["rev-parse", "--show-toplevel"], cwd);
}

/**
 * Check if there are uncommitted changes (staged or unstaged)
 */
export async function hasUncommittedChanges(cwd?: string): Promise<boolean> {
  const result = await runGitSafe(["status", "--porcelain"], cwd);
  return result.output.length > 0;
}

/**
 * Check if the current directory is inside a git worktree
 */
export async function isInsideWorktree(cwd?: string): Promise<boolean> {
  const result = await runGitSafe(
    ["rev-parse", "--is-inside-work-tree"],
    cwd,
  );
  return result.success && result.output === "true";
}

/**
 * Stage all changes (including untracked files)
 */
export async function stageAll(cwd?: string): Promise<void> {
  await runGit(["add", "-A"], cwd);
}

/**
 * Create a commit with the given message
 *
 * @returns true if commit succeeded, false if nothing to commit
 */
export async function commit(
  message: string,
  cwd?: string,
): Promise<{ success: boolean; nothingToCommit: boolean }> {
  const result = await runGitSafe(["commit", "-m", message], cwd);

  if (!result.success) {
    if (result.error.includes("nothing to commit")) {
      return { success: true, nothingToCommit: true };
    }
    throw new GitCommandError(["commit", "-m", message], result.error);
  }

  return { success: true, nothingToCommit: false };
}

/**
 * Checkout a branch
 */
export async function checkoutBranch(
  branchName: string,
  cwd?: string,
): Promise<boolean> {
  const result = await runGitSafe(["checkout", branchName], cwd);
  return result.success;
}

/**
 * Push a branch to remote
 */
export async function pushBranch(
  branchName: string,
  cwd?: string,
  options?: { setUpstream?: boolean },
): Promise<boolean> {
  const args = ["push"];
  if (options?.setUpstream) {
    args.push("-u", "origin", branchName);
  } else {
    args.push("origin", branchName);
  }

  const result = await runGitSafe(args, cwd);
  return result.success;
}

/**
 * Get the number of commits in branch that are not in baseBranch
 *
 * @returns Number of commits ahead, or -1 if error
 */
export async function getCommitsAhead(
  branch: string,
  baseBranch: string,
  cwd?: string,
): Promise<number> {
  const result = await runGitSafe(
    ["rev-list", "--count", `${baseBranch}..${branch}`],
    cwd,
  );

  if (!result.success) {
    return -1;
  }

  return parseInt(result.output, 10);
}

/**
 * Check if branch has commits that are not in baseBranch
 */
export async function hasCommitsToMerge(
  branch: string,
  baseBranch: string,
  cwd?: string,
): Promise<boolean> {
  const count = await getCommitsAhead(branch, baseBranch, cwd);
  return count > 0;
}

/**
 * Merge a branch into the current branch
 *
 * @param branchName - Branch to merge
 * @param cwd - Working directory
 * @param options - Merge options
 * @returns Result with success status and merge details
 */
export async function mergeBranch(
  branchName: string,
  cwd?: string,
  options?: { noFf?: boolean; message?: string },
): Promise<GitCommandResult> {
  const args = ["merge"];

  if (options?.noFf) {
    args.push("--no-ff");
  }

  if (options?.message) {
    args.push("-m", options.message);
  }

  args.push(branchName);

  return await runGitSafe(args, cwd);
}

/**
 * Delete a local branch
 *
 * @param branchName - Branch to delete
 * @param cwd - Working directory
 * @param force - Force delete even if not merged
 * @returns true if deleted, false otherwise
 */
export async function deleteBranch(
  branchName: string,
  cwd?: string,
  force = false,
): Promise<boolean> {
  const flag = force ? "-D" : "-d";
  const result = await runGitSafe(["branch", flag, branchName], cwd);
  return result.success;
}
