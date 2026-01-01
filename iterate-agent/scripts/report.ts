/**
 * Iterate Agent - Report Generation
 *
 * Parses JSONL logs and SDK results to generate execution reports.
 */

import type { Logger } from "./logger.ts";
import type {
  ExecutionReport,
  LogEntry,
  ModelUsageStats,
  SDKResultStats,
} from "./types.ts";

/**
 * Parse a JSONL log file into log entries
 *
 * @param filePath - Path to the JSONL log file
 * @returns Array of parsed log entries
 */
export async function parseLogFile(filePath: string): Promise<LogEntry[]> {
  const content = await Deno.readTextFile(filePath);
  const lines = content.trim().split("\n").filter((line) => line.length > 0);

  return lines.map((line) => JSON.parse(line) as LogEntry);
}

/**
 * Count tool usage from log entries
 *
 * Extracts tool_use blocks from debug messages containing rawMessage.
 *
 * @param entries - Log entries to analyze
 * @returns Tool usage counts
 */
function countToolUsage(entries: LogEntry[]): Record<string, number> {
  const toolCounts: Record<string, number> = {};

  for (const entry of entries) {
    if (entry.level === "debug" && entry.metadata?.rawMessage) {
      try {
        const raw = JSON.parse(entry.metadata.rawMessage as string);
        if (raw.message?.role === "assistant" && raw.message?.content) {
          const content = Array.isArray(raw.message.content)
            ? raw.message.content
            : [];
          for (const block of content) {
            if (block.type === "tool_use" && block.name) {
              toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return toolCounts;
}

/**
 * Count GitHub issue updates from log entries
 *
 * Detects gh issue commands in Bash tool uses.
 *
 * @param entries - Log entries to analyze
 * @returns Number of issue updates
 */
function countIssueUpdates(entries: LogEntry[]): number {
  const issuePatterns = [
    /gh\s+issue\s+(close|edit|comment|reopen|create)/i,
  ];

  let count = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry.level === "debug" && entry.metadata?.rawMessage) {
      const raw = entry.metadata.rawMessage as string;
      for (const pattern of issuePatterns) {
        const match = raw.match(pattern);
        if (match) {
          // Deduplicate by matching the full command
          const key = match[0];
          if (!seen.has(key)) {
            seen.add(key);
            count++;
          }
        }
      }
    }
  }

  return count;
}

/**
 * Count GitHub project updates from log entries
 *
 * Detects gh project commands in Bash tool uses.
 *
 * @param entries - Log entries to analyze
 * @returns Number of project updates
 */
function countProjectUpdates(entries: LogEntry[]): number {
  const projectPatterns = [
    /gh\s+project\s+item-(add|edit|delete)/i,
    /gh\s+project\s+field-(create|delete)/i,
  ];

  let count = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry.level === "debug" && entry.metadata?.rawMessage) {
      const raw = entry.metadata.rawMessage as string;
      for (const pattern of projectPatterns) {
        const match = raw.match(pattern);
        if (match) {
          const key = match[0];
          if (!seen.has(key)) {
            seen.add(key);
            count++;
          }
        }
      }
    }
  }

  return count;
}

/**
 * Extract the last assistant response as summary
 *
 * @param entries - Log entries to analyze
 * @returns Last assistant response text
 */
function extractSummary(entries: LogEntry[]): string {
  const assistantEntries = entries.filter((e) => e.level === "assistant");
  if (assistantEntries.length === 0) {
    return "(No assistant response)";
  }

  const lastEntry = assistantEntries[assistantEntries.length - 1];
  return lastEntry.message || "(Empty response)";
}

/**
 * Aggregate SDK result stats from multiple iterations
 *
 * @param results - Array of SDK result stats
 * @returns Aggregated stats
 */
function aggregateSDKResults(
  results: SDKResultStats[],
): Omit<SDKResultStats, "modelUsage"> & { modelUsage: ModelUsageStats[] } {
  let totalDurationMs = 0;
  let totalDurationApiMs = 0;
  let totalNumTurns = 0;
  let totalCostUsd = 0;

  const modelTotals: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cost: number;
    }
  > = {};

  for (const result of results) {
    totalDurationMs += result.durationMs;
    totalDurationApiMs += result.durationApiMs;
    totalNumTurns += result.numTurns;
    totalCostUsd += result.totalCostUsd;

    for (const [modelName, usage] of Object.entries(result.modelUsage)) {
      if (!modelTotals[modelName]) {
        modelTotals[modelName] = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cost: 0,
        };
      }
      modelTotals[modelName].inputTokens += usage.inputTokens;
      modelTotals[modelName].outputTokens += usage.outputTokens;
      modelTotals[modelName].cacheReadInputTokens +=
        usage.cacheReadInputTokens ?? 0;
      modelTotals[modelName].cost += usage.cost ?? 0;
    }
  }

  const modelUsage: ModelUsageStats[] = Object.entries(modelTotals).map((
    [modelName, stats],
  ) => ({
    modelName,
    ...stats,
  }));

  return {
    durationMs: totalDurationMs,
    durationApiMs: totalDurationApiMs,
    numTurns: totalNumTurns,
    totalCostUsd,
    modelUsage,
  };
}

/**
 * Generate an execution report from log entries and SDK results
 *
 * @param logFilePath - Path to the JSONL log file
 * @param sdkResults - Array of SDK result stats from each iteration
 * @param iterations - Number of iterations completed
 * @param completionReason - Reason for completion
 * @returns Execution report
 */
export async function generateReport(
  logFilePath: string,
  sdkResults: SDKResultStats[],
  iterations: number,
  completionReason: string,
): Promise<ExecutionReport> {
  const entries = await parseLogFile(logFilePath);
  const aggregated = aggregateSDKResults(sdkResults);

  return {
    totalEntries: entries.length,
    errorCount: entries.filter((e) => e.level === "error").length,
    issuesUpdated: countIssueUpdates(entries),
    projectsUpdated: countProjectUpdates(entries),
    toolsUsed: countToolUsage(entries),
    durationMs: aggregated.durationMs,
    durationApiMs: aggregated.durationApiMs,
    numTurns: aggregated.numTurns,
    iterations,
    totalCostUsd: aggregated.totalCostUsd,
    modelUsage: aggregated.modelUsage,
    summary: extractSummary(entries),
    completionReason,
  };
}

/**
 * Format duration in human-readable format
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string like "328秒 (~5.5分)"
 */
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  const minutes = (seconds / 60).toFixed(1);
  return `${seconds}秒 (~${minutes}分)`;
}

/**
 * Format number with commas for readability
 *
 * @param num - Number to format
 * @returns Formatted string with commas
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Print the execution report to console
 *
 * @param report - Execution report to print
 */
export function printReport(report: ExecutionReport): void {
  const line = "━".repeat(52);

  console.log("");
  console.log("📊 Execution Report");
  console.log(line);
  console.log("");

  // Performance section
  console.log("⏱️  Performance");
  console.log("  | 指標           | 値             |");
  console.log("  |----------------|----------------|");
  console.log(
    `  | 総実行時間     | ${formatDuration(report.durationMs).padEnd(14)} |`,
  );
  console.log(
    `  | API時間        | ${formatDuration(report.durationApiMs).padEnd(14)} |`,
  );
  console.log(`  | ターン数       | ${String(report.numTurns).padEnd(14)} |`);
  console.log(
    `  | イテレーション | ${String(report.iterations).padEnd(14)} |`,
  );
  console.log(
    `  | 総コスト       | $${report.totalCostUsd.toFixed(2)} USD`.padEnd(19) +
      "|",
  );
  console.log("");

  // Token usage section
  if (report.modelUsage.length > 0) {
    console.log("📈 Token Usage");
    console.log(
      "  | モデル           | Input  | Output | キャッシュ読込 | コスト |",
    );
    console.log(
      "  |------------------|--------|--------|----------------|--------|",
    );
    for (const model of report.modelUsage) {
      const name = model.modelName.padEnd(16);
      const input = formatNumber(model.inputTokens).padStart(6);
      const output = formatNumber(model.outputTokens).padStart(6);
      const cache = formatNumber(model.cacheReadInputTokens).padStart(14);
      const cost = `$${model.cost.toFixed(2)}`.padStart(6);
      console.log(`  | ${name} | ${input} | ${output} | ${cache} | ${cost} |`);
    }
    console.log("");
  }

  // Activity section
  console.log("📋 Activity");
  console.log("  | 指標           | 値  |");
  console.log("  |----------------|-----|");
  console.log(
    `  | ログエントリ   | ${String(report.totalEntries).padEnd(4)}|`,
  );
  console.log(`  | エラー         | ${String(report.errorCount).padEnd(4)}|`);
  console.log(
    `  | Issue更新      | ${String(report.issuesUpdated).padEnd(4)}|`,
  );
  console.log(
    `  | Project更新    | ${String(report.projectsUpdated).padEnd(4)}|`,
  );
  const completionIcon = report.completionReason === "criteria_met"
    ? "✅"
    : "⏹️";
  console.log(
    `  | 完了理由       | ${completionIcon} ${report.completionReason} |`,
  );
  console.log("");

  // Tools used section
  if (Object.keys(report.toolsUsed).length > 0) {
    console.log("🛠️  Tools Used");
    const sortedTools = Object.entries(report.toolsUsed)
      .sort((a, b) => b[1] - a[1]);
    for (const [tool, count] of sortedTools) {
      console.log(`  - ${tool}: ${count}`);
    }
    console.log("");
  }

  // Summary section
  console.log("📄 Summary");
  const summaryLines = report.summary.split("\n").slice(0, 10);
  for (const line of summaryLines) {
    console.log(`  ${line}`);
  }
  if (report.summary.split("\n").length > 10) {
    console.log("  ...(truncated)");
  }
  console.log("");
  console.log(line);
}

/**
 * Log the execution report
 *
 * @param logger - Logger instance
 * @param report - Execution report to log
 */
export async function logReport(
  logger: Logger,
  report: ExecutionReport,
): Promise<void> {
  await logger.write("result", "Execution report generated", {
    report: {
      totalEntries: report.totalEntries,
      errorCount: report.errorCount,
      issuesUpdated: report.issuesUpdated,
      projectsUpdated: report.projectsUpdated,
      toolsUsed: report.toolsUsed,
      durationMs: report.durationMs,
      durationApiMs: report.durationApiMs,
      numTurns: report.numTurns,
      iterations: report.iterations,
      totalCostUsd: report.totalCostUsd,
      modelUsage: report.modelUsage,
      completionReason: report.completionReason,
      // Summary is logged separately to avoid bloating the log
      summaryLength: report.summary.length,
    },
  });
}
