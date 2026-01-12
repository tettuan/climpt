/**
 * Test Output Extractors
 *
 * Extracts failed test information from deno test output.
 */

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
