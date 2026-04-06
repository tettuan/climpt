/**
 * Type Error Extractors
 *
 * Extracts type error information from deno check output.
 */

import type { SemanticParams } from "../types.ts";

/**
 * Type error information
 */
export interface TypeError {
  /** File name */
  file: string;
  /** Line number */
  line: number;
  /** Column number (if available) */
  column?: number;
  /** Error message */
  message: string;
}

/**
 * Parses type errors from deno check output
 */
export function parseTypeErrors(stderr: string): TypeError[] {
  const errors: TypeError[] = [];

  // Deno error format: error: TS1234 [ERROR]: message
  //   at file.ts:line:column
  const errorPattern =
    /error:\s+TS\d+\s+\[ERROR\]:\s+(.+)(?:\n\s+at\s+(.+?):(\d+):(\d+))?/g;
  let match;

  while ((match = errorPattern.exec(stderr)) !== null) {
    errors.push({
      message: match[1].trim(),
      file: match[2] || "unknown",
      line: match[3] ? parseInt(match[3], 10) : 0,
      column: match[4] ? parseInt(match[4], 10) : undefined,
    });
  }

  // Alternative simpler format: error: message at file.ts:line:column
  if (errors.length === 0) {
    const simplePattern = /error:\s+(.+?)\s+at\s+(.+?):(\d+):?(\d+)?/g;
    while ((match = simplePattern.exec(stderr)) !== null) {
      errors.push({
        message: match[1].trim(),
        file: match[2],
        line: parseInt(match[3], 10),
        column: match[4] ? parseInt(match[4], 10) : undefined,
      });
    }
  }

  // Fallback: extract any TS error numbers
  if (errors.length === 0) {
    const tsErrorPattern = /TS(\d+):\s*(.+?)(?:\n|$)/g;
    while ((match = tsErrorPattern.exec(stderr)) !== null) {
      errors.push({
        message: `TS${match[1]}: ${match[2].trim()}`,
        file: "unknown",
        line: 0,
      });
    }
  }

  return errors;
}

/**
 * Builds semantic context from type error output
 *
 * Counts errors, groups by file, identifies the most common error pattern,
 * and produces a human-readable summary for retry prompts.
 */
export function buildTypeErrorsSemantic(
  stderr: string,
  raw: Record<string, unknown>,
): SemanticParams {
  const errors = parseTypeErrors(stderr);
  const files = new Set<string>();
  const messageCounts = new Map<string, number>();

  for (const err of errors) {
    if (err.file && err.file !== "unknown") {
      files.add(err.file);
    }
    // Track message frequency to find most common pattern
    const count = messageCounts.get(err.message) ?? 0;
    messageCounts.set(err.message, count + 1);
  }

  const fileCount = files.size;
  const errorCount = errors.length;

  const summary = errorCount > 0
    ? `${errorCount} type error${
      errorCount !== 1 ? "s" : ""
    } in ${fileCount} file${fileCount !== 1 ? "s" : ""}`
    : "No type errors detected";

  // Most common error pattern as root cause
  let rootCause: string | undefined;
  if (messageCounts.size > 0) {
    let maxCount = 0;
    for (const [msg, count] of messageCounts) {
      if (count > maxCount) {
        maxCount = count;
        rootCause = msg;
      }
    }
  }

  return {
    raw,
    summary,
    severity: "error",
    relatedFiles: Array.from(files),
    rootCause,
    suggestedAction: "Fix type mismatches in the listed files",
  };
}

/**
 * Extracts file names from error output
 */
export function extractFiles(stdout: string, stderr: string): string[] {
  const output = stdout + "\n" + stderr;
  const files = new Set<string>();

  // File path pattern
  const filePattern = /\b([\w./-]+\.tsx?):(\d+)/g;
  let match;

  while ((match = filePattern.exec(output)) !== null) {
    // Exclude node_modules
    if (!match[1].includes("node_modules")) {
      files.add(match[1]);
    }
  }

  return Array.from(files);
}
