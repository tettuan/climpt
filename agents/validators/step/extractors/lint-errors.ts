/**
 * Lint Error Extractors
 *
 * Extracts lint error information from deno lint output.
 */

/**
 * Lint error information
 */
export interface LintError {
  /** File name */
  file: string;
  /** Line number */
  line: number;
  /** Column number (if available) */
  column?: number;
  /** Rule name */
  rule: string;
  /** Error message */
  message: string;
}

/**
 * Parses lint errors from deno lint output
 */
export function parseLintErrors(
  stdout: string,
  stderr: string,
): LintError[] {
  const errors: LintError[] = [];
  const output = stdout + "\n" + stderr;

  // Deno lint format: (rule-name) message
  //   at file.ts:line:column
  const lintPattern = /\(([a-z-]+)\)\s+(.+?)(?:\n\s+at\s+(.+?):(\d+):(\d+))?/g;
  let match;

  while ((match = lintPattern.exec(output)) !== null) {
    errors.push({
      rule: match[1],
      message: match[2].trim(),
      file: match[3] || "unknown",
      line: match[4] ? parseInt(match[4], 10) : 0,
      column: match[5] ? parseInt(match[5], 10) : undefined,
    });
  }

  // Alternative format: file:line:column - rule: message
  if (errors.length === 0) {
    const altPattern = /(.+?):(\d+):(\d+)\s+-\s+(\S+):\s+(.+)/g;
    while ((match = altPattern.exec(output)) !== null) {
      errors.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        rule: match[4],
        message: match[5].trim(),
      });
    }
  }

  // Simple format: error[rule]: message at file.ts:line
  if (errors.length === 0) {
    const simplePattern = /error\[([^\]]+)\]:\s+(.+?)\s+at\s+(.+?):(\d+)/g;
    while ((match = simplePattern.exec(output)) !== null) {
      errors.push({
        rule: match[1],
        message: match[2].trim(),
        file: match[3],
        line: parseInt(match[4], 10),
      });
    }
  }

  return errors;
}

/**
 * Extracts file list from lint errors
 */
export function extractLintFiles(
  stdout: string,
  stderr: string,
): string[] {
  const errors = parseLintErrors(stdout, stderr);
  const files = new Set<string>();

  for (const error of errors) {
    if (error.file && error.file !== "unknown") {
      files.add(error.file);
    }
  }

  return Array.from(files);
}
