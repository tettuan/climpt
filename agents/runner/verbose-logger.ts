/**
 * Verbose Logger for Agent SDK I/O
 *
 * Captures detailed request/response data for debugging and analysis.
 * Saves each entry as individual files in time-series order.
 *
 * Directory structure:
 *   tmp/logs/{agent}/verbose-{timestamp}/
 *     001_iteration_start.json
 *     002_prompt.md
 *     003_system_prompt.md
 *     004_sdk_request.json
 *     005_sdk_message_001.json
 *     ...
 *     050_sdk_result.json
 *     index.jsonl  (metadata index)
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";

/**
 * Entry types for verbose logging
 */
export type VerboseEntryType =
  | "sdk_request" // Full SDK query options
  | "prompt" // User prompt sent to SDK
  | "system_prompt" // System prompt configuration
  | "sdk_message" // Raw SDK message received
  | "sdk_result" // Final SDK result
  | "iteration_start" // Iteration boundary marker
  | "iteration_end"; // Iteration boundary marker

/**
 * Index entry for metadata tracking
 */
export interface IndexEntry {
  /** Entry sequence number */
  seq: number;
  /** ISO timestamp */
  timestamp: string;
  /** Entry type */
  type: VerboseEntryType;
  /** File name */
  filename: string;
  /** Iteration number (if applicable) */
  iteration?: number;
  /** Step ID (if applicable) */
  stepId?: string;
  /** Brief summary for quick reference */
  summary?: string;
}

/**
 * Verbose Logger for detailed SDK I/O capture
 *
 * Saves each log entry as an individual file for easy analysis.
 */
export class VerboseLogger {
  private logDir: string = "";
  private indexFile: Deno.FsFile | null = null;
  private seq: number = 0;
  private sdkMessageCount: number = 0;
  private currentIteration: number = 0;
  private currentStepId: string | undefined;

  /**
   * Initialize the verbose logger
   *
   * @param baseLogDir - Base directory for logs (e.g., tmp/logs/iterator)
   * @param agentName - Agent name for directory naming
   */
  async initialize(baseLogDir: string, agentName: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logDir = join(baseLogDir, `verbose-${agentName}-${timestamp}`);

    await ensureDir(this.logDir);

    // Open index file
    const indexPath = join(this.logDir, "index.jsonl");
    this.indexFile = await Deno.open(indexPath, {
      write: true,
      create: true,
      truncate: true,
    });

    await this.writeEntry("iteration_start", {
      message: "Verbose logging started",
      logDir: this.logDir,
    });
  }

  /**
   * Set current iteration context
   */
  setIteration(iteration: number, stepId?: string): void {
    this.currentIteration = iteration;
    this.currentStepId = stepId;
    this.sdkMessageCount = 0; // Reset message counter per iteration
  }

  /**
   * Log iteration start marker
   */
  async logIterationStart(iteration: number, stepId?: string): Promise<void> {
    this.setIteration(iteration, stepId);
    await this.writeEntry(
      "iteration_start",
      {
        iteration,
        stepId,
        timestamp: new Date().toISOString(),
      },
      `Iteration ${iteration} - Step: ${stepId}`,
    );
  }

  /**
   * Log iteration end marker
   */
  async logIterationEnd(
    iteration: number,
    summary: { toolsUsed: string[]; errors: string[] },
  ): Promise<void> {
    await this.writeEntry(
      "iteration_end",
      {
        iteration,
        toolsUsed: summary.toolsUsed,
        errorCount: summary.errors.length,
        errors: summary.errors.length > 0 ? summary.errors : undefined,
      },
      `Tools: ${summary.toolsUsed.length}, Errors: ${summary.errors.length}`,
    );
  }

  /**
   * Log the full SDK request options
   */
  async logSdkRequest(options: Record<string, unknown>): Promise<void> {
    // Create a sanitized copy
    const sanitized = { ...options };

    // Exclude non-serializable callbacks
    if ("canUseTool" in sanitized) {
      sanitized.canUseTool = "[Function]";
    }

    await this.writeEntry(
      "sdk_request",
      sanitized,
      `Tools: ${(sanitized.allowedTools as string[] | undefined)?.length ?? 0}`,
    );
  }

  /**
   * Log the user prompt (as markdown file)
   */
  async logPrompt(prompt: string): Promise<void> {
    await this.writeEntry(
      "prompt",
      prompt,
      `Length: ${prompt.length} chars`,
      undefined, // subSeq
      true, // isMarkdown
    );
  }

  /**
   * Log the system prompt configuration (as markdown file)
   */
  async logSystemPrompt(
    systemPrompt: string | Record<string, unknown>,
  ): Promise<void> {
    let content: string;
    let summary: string;

    if (typeof systemPrompt === "string") {
      content = systemPrompt;
      summary = `String, Length: ${systemPrompt.length}`;
    } else {
      // Preset configuration - extract append content for markdown
      const preset = systemPrompt as {
        type?: string;
        preset?: string;
        append?: string;
      };

      if (preset.append) {
        content =
          `<!-- Preset: ${preset.type}/${preset.preset} -->\n\n${preset.append}`;
        summary =
          `Preset: ${preset.preset}, Append: ${preset.append.length} chars`;
      } else {
        content = JSON.stringify(systemPrompt, null, 2);
        summary = `Preset: ${preset.preset}`;
      }
    }

    await this.writeEntry("system_prompt", content, summary, undefined, true); // isMarkdown
  }

  /**
   * Log a raw SDK message
   */
  async logSdkMessage(message: unknown): Promise<void> {
    this.sdkMessageCount++;

    const msgType = (message as { type?: string })?.type ?? "unknown";
    await this.writeEntry(
      "sdk_message",
      message,
      `Type: ${msgType}`,
      this.sdkMessageCount,
      false,
    );
  }

  /**
   * Log the final SDK result
   */
  async logSdkResult(result: {
    sessionId?: string;
    structuredOutput?: unknown;
    assistantResponses: string[];
    toolsUsed: string[];
    errors: string[];
  }): Promise<void> {
    await this.writeEntry(
      "sdk_result",
      result,
      `Tools: ${result.toolsUsed.length}, Responses: ${result.assistantResponses.length}`,
    );
  }

  /**
   * Write an entry to individual file and index
   */
  private async writeEntry(
    type: VerboseEntryType,
    data: unknown,
    summary?: string,
    subSeq?: number,
    isMarkdown: boolean = false,
  ): Promise<void> {
    this.seq++;

    // Generate filename
    const seqStr = String(this.seq).padStart(3, "0");
    const subSeqStr = subSeq !== undefined
      ? `_${String(subSeq).padStart(3, "0")}`
      : "";
    const ext = isMarkdown ? "md" : "json";
    const filename = `${seqStr}_${type}${subSeqStr}.${ext}`;

    // Write content file
    const filePath = join(this.logDir, filename);
    let content: string;

    if (isMarkdown) {
      content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    } else {
      content = JSON.stringify(data, null, 2);
    }

    await Deno.writeTextFile(filePath, content);

    // Write index entry
    if (this.indexFile) {
      const indexEntry: IndexEntry = {
        seq: this.seq,
        timestamp: new Date().toISOString(),
        type,
        filename,
        ...(this.currentIteration > 0 && { iteration: this.currentIteration }),
        ...(this.currentStepId && { stepId: this.currentStepId }),
        ...(summary && { summary }),
      };

      const line = JSON.stringify(indexEntry) + "\n";
      await this.indexFile.write(new TextEncoder().encode(line));
    }
  }

  /**
   * Close the logger
   */
  async close(): Promise<void> {
    if (this.indexFile) {
      // Write final entry
      await this.writeEntry("iteration_end", {
        message: "Verbose logging ended",
        totalEntries: this.seq,
      });

      this.indexFile.close();
      this.indexFile = null;
    }
  }

  /**
   * Get the log directory path
   */
  getLogPath(): string {
    return this.logDir;
  }
}

/**
 * Create and initialize a verbose logger
 */
export async function createVerboseLogger(
  logDir: string,
  agentName: string,
): Promise<VerboseLogger> {
  const logger = new VerboseLogger();
  await logger.initialize(logDir, agentName);
  return logger;
}
