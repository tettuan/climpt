/**
 * Git Clean Validator
 *
 * Validates that the working directory has no uncommitted changes.
 * This ensures agents commit their work before closing issues.
 */

import type { Validator, ValidatorContext, ValidatorResult } from "../types.ts";

/**
 * Git clean validator - checks for uncommitted changes
 */
export const gitCleanValidator: Validator = {
  id: "git-clean",
  name: "Git Clean Validator",
  description: "Ensures no uncommitted changes exist in the working directory",

  async validate(ctx: ValidatorContext): Promise<ValidatorResult> {
    try {
      // Run git status --porcelain to get list of changed files
      const command = new Deno.Command("git", {
        args: ["status", "--porcelain"],
        cwd: ctx.workingDir,
        stdout: "piped",
        stderr: "piped",
      });

      const result = await command.output();

      if (!result.success) {
        const stderr = new TextDecoder().decode(result.stderr);
        return {
          valid: false,
          error: `Failed to check git status: ${stderr}`,
        };
      }

      const stdout = new TextDecoder().decode(result.stdout);
      const changedFiles = stdout
        .split("\n")
        .filter((line) => line.trim().length > 0);

      if (changedFiles.length === 0) {
        ctx.logger.info("[git-clean] Working directory is clean");
        return { valid: true };
      }

      // Parse git status output to categorize changes
      const categorized = categorizeChanges(changedFiles);

      ctx.logger.warn("[git-clean] Uncommitted changes detected", {
        fileCount: changedFiles.length,
        staged: categorized.staged.length,
        unstaged: categorized.unstaged.length,
        untracked: categorized.untracked.length,
      });

      return {
        valid: false,
        error: buildErrorMessage(changedFiles.length),
        details: changedFiles,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(
        error,
      );
      return {
        valid: false,
        error: `Git status check failed: ${errorMessage}`,
      };
    }
  },
};

/**
 * Build a helpful error message for uncommitted changes
 */
function buildErrorMessage(fileCount: number): string {
  const fileText = fileCount === 1 ? "1 file" : `${fileCount} files`;
  return `Uncommitted changes detected (${fileText}). Please commit all changes before closing the issue.`;
}

/**
 * Categorize git status output into staged, unstaged, and untracked
 */
function categorizeChanges(lines: string[]): {
  staged: string[];
  unstaged: string[];
  untracked: string[];
} {
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    if (line.length < 2) continue;

    const indexStatus = line[0];
    const worktreeStatus = line[1];

    // XY format: X=index, Y=worktree
    // ' '=unmodified, M=modified, A=added, D=deleted, R=renamed, C=copied, U=updated, ?=untracked
    if (indexStatus === "?" && worktreeStatus === "?") {
      untracked.push(line);
    } else if (indexStatus !== " " && indexStatus !== "?") {
      staged.push(line);
    } else if (worktreeStatus !== " " && worktreeStatus !== "?") {
      unstaged.push(line);
    }
  }

  return { staged, unstaged, untracked };
}
