/**
 * Type Error Extractors
 *
 * Extracts type error information from deno check output.
 */

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
    /error:\s+TS\d+\s+\[ERROR\]:\s+(.+?)(?:\n\s+at\s+(.+?):(\d+):(\d+))?/g;
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
