/**
 * Git Status Extractors
 *
 * Extracts file information from git status --porcelain output.
 */

import type { SemanticParams } from "../types.ts";

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

/**
 * Builds semantic context from git status --porcelain output
 *
 * Classifies files by status and produces a human-readable summary,
 * severity, and suggested action for retry prompts.
 */
export function buildGitStatusSemantic(
  stdout: string,
  raw: Record<string, unknown>,
): SemanticParams {
  const changedFiles = parseChangedFiles(stdout);
  const untrackedFiles = parseUntrackedFiles(stdout);
  const stagedFiles = parseStagedFiles(stdout);

  const modifiedCount = changedFiles.length;
  const untrackedCount = untrackedFiles.length;

  const summaryParts: string[] = [];
  if (modifiedCount > 0) {
    summaryParts.push(
      `${modifiedCount} file${modifiedCount > 1 ? "s" : ""} modified`,
    );
  }
  if (untrackedCount > 0) {
    summaryParts.push(
      `${untrackedCount} file${untrackedCount > 1 ? "s" : ""} untracked`,
    );
  }
  const summary = summaryParts.length > 0
    ? summaryParts.join(", ")
    : "No changes detected";

  // Severity: error if tracked files are modified/staged, warning if only untracked
  const severity: SemanticParams["severity"] =
    modifiedCount > 0 || stagedFiles.length > 0 ? "error" : "warning";

  // relatedFiles: modified and staged files (not untracked build artifacts)
  const relatedFiles = Array.from(
    new Set([...changedFiles, ...stagedFiles]),
  );

  const suggestedAction = modifiedCount > 0
    ? "Stage and commit the modified files"
    : "Clean untracked files";

  return {
    raw,
    summary,
    severity,
    relatedFiles,
    suggestedAction,
  };
}
