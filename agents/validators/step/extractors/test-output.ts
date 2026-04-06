/**
 * Test Output Extractors
 *
 * Extracts failed test information from deno test output.
 */

import type { SemanticParams } from "../types.ts";

/**
 * Failed test information
 */
export interface FailedTest {
  /** Test name */
  name: string;
  /** File name (if available) */
  file?: string;
  /** Error message */
  error: string;
}

/**
 * Parses failed tests from Deno test output
 */
export function parseTestOutput(
  stdout: string,
  stderr: string,
): FailedTest[] {
  const failedTests: FailedTest[] = [];
  const output = stdout + "\n" + stderr;

  // Deno test output format: "FAILED | test name"
  const failedPattern = /FAILED\s*\|\s*(.+)/g;
  let match;

  while ((match = failedPattern.exec(output)) !== null) {
    const testName = match[1].trim();
    failedTests.push({
      name: testName,
      error: extractErrorForTest(output, testName),
    });
  }

  // Alternative format: "file.ts ... FAILED"
  const fileFailedPattern = /(\S+\.tsx?)\s+\.\.\.\s+FAILED/g;
  while ((match = fileFailedPattern.exec(output)) !== null) {
    const file = match[1];
    // Check if already added
    if (!failedTests.some((t) => t.file === file)) {
      failedTests.push({
        name: file,
        file: file,
        error: extractErrorForTest(output, file),
      });
    }
  }

  // Deno assertion error format
  const assertionPattern = /AssertionError:\s*(.+?)(?:\n|$)/g;
  if (failedTests.length === 0) {
    while ((match = assertionPattern.exec(output)) !== null) {
      failedTests.push({
        name: "AssertionError",
        error: match[1].trim(),
      });
    }
  }

  return failedTests;
}

/**
 * Extracts error message for a specific test
 */
function extractErrorForTest(output: string, testIdentifier: string): string {
  const lines = output.split("\n");
  const testIndex = lines.findIndex((l) => l.includes(testIdentifier));

  if (testIndex === -1) {
    return "Unknown error";
  }

  // Get error message from the next few lines
  const errorLines: string[] = [];
  for (let i = testIndex + 1; i < Math.min(testIndex + 10, lines.length); i++) {
    const line = lines[i];
    // Stop when next test result starts
    if (
      line.includes("---") || line.includes("ok |") || line.includes("FAILED |")
    ) {
      break;
    }
    if (line.trim()) {
      errorLines.push(line.trim());
    }
  }

  return errorLines.join("\n") || "Unknown error";
}

/**
 * Builds semantic context from test output
 *
 * Counts failures, extracts test file paths, and identifies the first
 * failure message as the root cause for retry prompts.
 */
export function buildTestOutputSemantic(
  stdout: string,
  stderr: string,
  raw: Record<string, unknown>,
): SemanticParams {
  const failedTests = parseTestOutput(stdout, stderr);
  const output = stdout + "\n" + stderr;

  // Count total tests from Deno summary line: "N passed | M failed"
  const summaryMatch = output.match(
    /(\d+)\s+passed.*?(\d+)\s+failed/,
  );
  const totalPassed = summaryMatch ? parseInt(summaryMatch[1], 10) : 0;
  const totalFailed = failedTests.length > 0
    ? failedTests.length
    : (summaryMatch ? parseInt(summaryMatch[2], 10) : 0);
  const totalTests = totalPassed + totalFailed;

  const summary = totalTests > 0
    ? `${totalFailed} test${
      totalFailed !== 1 ? "s" : ""
    } failed out of ${totalTests}`
    : `${failedTests.length} test${failedTests.length !== 1 ? "s" : ""} failed`;

  // Extract unique file paths from failed tests
  const relatedFiles: string[] = [];
  const seen = new Set<string>();
  for (const test of failedTests) {
    const file = test.file ?? test.name;
    if (file && !seen.has(file)) {
      seen.add(file);
      relatedFiles.push(file);
    }
  }

  // First failure's error as root cause
  const rootCause = failedTests.length > 0 ? failedTests[0].error : undefined;

  return {
    raw,
    summary,
    severity: "error",
    relatedFiles,
    rootCause,
    suggestedAction: "Fix the failing test assertions",
  };
}

/**
 * Gets the full error output from test output
 */
export function getTestErrorOutput(
  stdout: string,
  stderr: string,
): string {
  // Errors are primarily output to stderr
  if (stderr.trim()) {
    return stderr.trim();
  }
  // If not, extract error portion from stdout
  const lines = stdout.split("\n");
  const failureIndex = lines.findIndex((l) =>
    l.includes("FAILED") || l.includes("error:")
  );
  if (failureIndex !== -1) {
    return lines.slice(failureIndex).join("\n").trim();
  }
  return stdout.trim();
}
