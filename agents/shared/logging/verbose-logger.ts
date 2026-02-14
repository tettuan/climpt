/**
 * VerboseLogger - Detailed SDK I/O capture using FilePerEntryWriter
 *
 * Wraps AgentLogger with FilePerEntryWriter strategy for
 * 1-entry-per-file logging with index tracking.
 *
 * This is a thin wrapper that delegates to AgentLogger + FilePerEntryWriter,
 * preserving the original VerboseLogger API.
 */

import { AgentLogger } from "./agent-logger.ts";
import { FilePerEntryWriter, type LogEntry } from "./log-writer.ts";

/**
 * Entry types for verbose logging
 */
export type VerboseEntryType =
  | "sdk_request"
  | "prompt"
  | "system_prompt"
  | "sdk_message"
  | "sdk_result"
  | "iteration_start"
  | "iteration_end";

/**
 * Index entry for metadata tracking
 */
export interface IndexEntry {
  seq: number;
  timestamp: string;
  type: VerboseEntryType;
  filename: string;
  iteration?: number;
  stepId?: string;
  summary?: string;
}

/**
 * VerboseLogger using AgentLogger + FilePerEntryWriter
 */
export class VerboseLogger {
  private agentLogger: AgentLogger | null = null;
  private writer: FilePerEntryWriter | null = null;
  private sdkMessageCount = 0;
  private currentIteration = 0;
  private currentStepId: string | undefined;

  async initialize(baseLogDir: string, agentName: string): Promise<void> {
    const { join } = await import("@std/path");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logDir = join(baseLogDir, `verbose-${agentName}-${timestamp}`);

    this.writer = new FilePerEntryWriter(logDir);
    await this.writer.initialize();
    this.agentLogger = new AgentLogger(this.writer);

    await this.writeVerboseEntry("iteration_start", {
      message: "Verbose logging started",
      logDir,
    });
  }

  setIteration(iteration: number, stepId?: string): void {
    this.currentIteration = iteration;
    this.currentStepId = stepId;
    this.sdkMessageCount = 0;
  }

  async logIterationStart(iteration: number, stepId?: string): Promise<void> {
    this.setIteration(iteration, stepId);
    await this.writeVerboseEntry(
      "iteration_start",
      { iteration, stepId, timestamp: new Date().toISOString() },
      `Iteration ${iteration} - Step: ${stepId}`,
    );
  }

  async logIterationEnd(
    iteration: number,
    summary: { toolsUsed: string[]; errors: string[] },
  ): Promise<void> {
    await this.writeVerboseEntry(
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

  async logSdkRequest(options: Record<string, unknown>): Promise<void> {
    const sanitized = { ...options };
    if ("canUseTool" in sanitized) {
      sanitized.canUseTool = "[Function]";
    }
    await this.writeVerboseEntry(
      "sdk_request",
      sanitized,
      `Tools: ${(sanitized.allowedTools as string[] | undefined)?.length ?? 0}`,
    );
  }

  async logPrompt(prompt: string): Promise<void> {
    const IS_MARKDOWN = true;
    await this.writeVerboseEntry(
      "prompt",
      prompt,
      `Length: ${prompt.length} chars`,
      undefined,
      IS_MARKDOWN,
    );
  }

  async logSystemPrompt(
    systemPrompt: string | Record<string, unknown>,
  ): Promise<void> {
    let content: string;
    let summary: string;

    if (typeof systemPrompt === "string") {
      content = systemPrompt;
      summary = `String, Length: ${systemPrompt.length}`;
    } else {
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

    const IS_MARKDOWN = true;
    await this.writeVerboseEntry(
      "system_prompt",
      content,
      summary,
      undefined,
      IS_MARKDOWN,
    );
  }

  async logSdkMessage(message: unknown): Promise<void> {
    this.sdkMessageCount++;
    const msgType = (message as { type?: string })?.type ?? "unknown";
    await this.writeVerboseEntry(
      "sdk_message",
      message,
      `Type: ${msgType}`,
      this.sdkMessageCount,
    );
  }

  async logSdkResult(result: {
    sessionId?: string;
    structuredOutput?: unknown;
    assistantResponses: string[];
    toolsUsed: string[];
    errors: string[];
    totalCostUsd?: number;
    numTurns?: number;
    durationMs?: number;
  }): Promise<void> {
    const parts = [
      `Tools: ${result.toolsUsed.length}`,
      `Responses: ${result.assistantResponses.length}`,
    ];
    if (result.totalCostUsd !== undefined) {
      parts.push(`Cost: $${result.totalCostUsd.toFixed(4)}`);
    }
    if (result.numTurns !== undefined) {
      parts.push(`Turns: ${result.numTurns}`);
    }
    if (result.durationMs !== undefined) {
      parts.push(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
    }
    await this.writeVerboseEntry("sdk_result", result, parts.join(", "));
  }

  async close(): Promise<void> {
    if (this.agentLogger && this.writer) {
      await this.writeVerboseEntry("iteration_end", {
        message: "Verbose logging ended",
        totalEntries: this.writer.getSeq(),
      });
      await this.agentLogger.close();
      this.agentLogger = null;
      this.writer = null;
    }
  }

  getLogPath(): string {
    return this.writer?.getLogPath() ?? "";
  }

  /**
   * Write an entry using the FilePerEntryWriter via AgentLogger.
   * Passes verbose-specific metadata through entry.metadata.
   */
  private async writeVerboseEntry(
    type: VerboseEntryType,
    data: unknown,
    summary?: string,
    subSeq?: number,
    isMarkdown = false,
  ): Promise<void> {
    if (!this.agentLogger) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "verbose",
      message: type,
      metadata: {
        _entryType: type,
        _data: data,
        _summary: summary,
        _subSeq: subSeq,
        _isMarkdown: isMarkdown,
        _iteration: this.currentIteration,
        _stepId: this.currentStepId,
      },
    };
    if (this.writer) {
      await this.writer.write(entry);
    }
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
