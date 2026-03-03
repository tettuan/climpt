/**
 * Format Check Extractors
 *
 * Extracts format error information from deno fmt --check output.
 */

/**
 * Parses files needing formatting from deno fmt --check output
 */
export function parseFormatOutput(stdout: string): string[] {
  const files: string[] = [];

  // deno fmt --check outputs files that need formatting
  // Format: "file.ts"
  const lines = stdout.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and summary lines
    if (
      !trimmed || trimmed.startsWith("Checked") || trimmed.startsWith("error")
    ) {
      continue;
    }
    // File paths typically end with .ts, .tsx, .js, .jsx, .json, .md
    if (
      trimmed.endsWith(".ts") ||
      trimmed.endsWith(".tsx") ||
      trimmed.endsWith(".js") ||
      trimmed.endsWith(".jsx") ||
      trimmed.endsWith(".json") ||
      trimmed.endsWith(".md")
    ) {
      files.push(trimmed);
    }
  }

  return files;
}

/**
 * Generates format diff (simple version)
 *
 * Note: The actual diff is not included in deno fmt --check output,
 * so only returns the file list. Run diff separately if needed.
 */
export function generateDiff(stdout: string): string {
  const files = parseFormatOutput(stdout);

  if (files.length === 0) {
    return "No formatting issues found.";
  }

  return `Files needing format:\n${files.map((f) => `  - ${f}`).join("\n")}`;
}

/**
 * Generates format error summary
 */
export function formatErrorSummary(
  stdout: string,
  _stderr: string,
): string {
  const files = parseFormatOutput(stdout);
  const count = files.length;

  if (count === 0) {
    return "All files are properly formatted.";
  }

  return `${count} file${count > 1 ? "s" : ""} need${
    count > 1 ? "" : "s"
  } formatting:\n${files.slice(0, 5).map((f) => `  - ${f}`).join("\n")}${
    count > 5 ? `\n  ... and ${count - 5} more` : ""
  }`;
}
