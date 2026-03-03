/**
 * Git Status Extractors
 *
 * Extracts file information from git status --porcelain output.
 */

/**
 * Parses changed files from git status --porcelain output
 */
export function parseChangedFiles(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => {
      const status = line.substring(0, 2);
      // Extract changed files (M, A, D, R, C), exclude untracked (??)
      return status[0] !== "?" && status[1] !== "?";
    })
    .map((line) => line.substring(3).trim());
}

/**
 * Parses untracked files from git status --porcelain output
 */
export function parseUntrackedFiles(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => line.startsWith("??"))
    .map((line) => line.substring(3).trim());
}

/**
 * Parses staged files from git status output
 */
export function parseStagedFiles(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => {
      const status = line.substring(0, 2);
      // Files with changes in the index
      return status[0] !== " " && status[0] !== "?";
    })
    .map((line) => line.substring(3).trim());
}

/**
 * Parses unstaged files from git status output
 */
export function parseUnstagedFiles(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => {
      const status = line.substring(0, 2);
      // Files with changes in the working tree
      return status[1] !== " " && status[1] !== "?";
    })
    .map((line) => line.substring(3).trim());
}
