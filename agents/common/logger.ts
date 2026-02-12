/**
 * Common Agent Logger
 *
 * JSONL logger with automatic rotation, shared by all agents.
 */

import { join } from "@std/path";
import type {
  AgentName,
  LogEntry,
  LogLevel,
  ToolResultInfo,
  ToolUseInfo,
} from "./types.ts";
import { TRUNCATION } from "../shared/constants.ts";

/**
 * JSONL Logger for agents
 */
export class Logger {
  private file: Deno.FsFile | null = null;
  private logPath: string;
  private maxFiles: number;
  private logDir: string;
  private stepCounter = 0;
  private correlationId?: string;

  /**
   * Create a new Logger instance
   *
   * @param logDir - Directory to store log files
   * @param _agentName - Agent name (used in directory path)
   * @param correlationId - Optional correlation ID for tracing
   * @param maxFiles - Maximum number of log files to keep
   */
  constructor(
    logDir: string,
    _agentName: AgentName,
    correlationId?: string,
    maxFiles = 100,
  ) {
    this.logDir = logDir;
    this.correlationId = correlationId;
    this.maxFiles = maxFiles;

    // Generate log file path with ISO timestamp
    const timestamp = new Date().toISOString().replace(/:/g, "-").replace(
      /\./g,
      "-",
    );
    this.logPath = join(logDir, `session-${timestamp}.jsonl`);
  }

  /**
   * Initialize the logger (open file, rotate old files)
   */
  async initialize(): Promise<void> {
    // Ensure log directory exists
    await Deno.mkdir(this.logDir, { recursive: true });

    // Rotate old log files if needed
    await this.rotateLogFiles();

    // Open log file for writing
    this.file = await Deno.open(this.logPath, {
      write: true,
      create: true,
      append: true,
    });

    // Write initial log entry
    await this.write("info", "Logger initialized", {
      logPath: this.logPath,
      maxFiles: this.maxFiles,
    });
  }

  /**
   * Write a log entry
   *
   * @param level - Log level
   * @param message - Log message
   * @param metadata - Optional metadata
   */
  async write(
    level: LogLevel,
    message: string,
    metadata?: LogEntry["metadata"],
  ): Promise<void> {
    if (!this.file) {
      throw new Error("Logger not initialized. Call initialize() first.");
    }

    // Increment step counter (starts at 0, first log will be step 1)
    this.stepCounter++;

    const entry: LogEntry = {
      step: this.stepCounter,
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId: this.correlationId,
      metadata,
    };

    const line = JSON.stringify(entry) + "\n";
    const encoder = new TextEncoder();
    await this.file.write(encoder.encode(line));
  }

  /**
   * Log a tool use event
   *
   * @param toolUse - Tool use information
   */
  async logToolUse(toolUse: ToolUseInfo): Promise<void> {
    await this.write("tool_use", `Tool invoked: ${toolUse.toolName}`, {
      toolUse,
    });
  }

  /**
   * Log a tool result event
   *
   * @param toolResult - Tool result information
   */
  async logToolResult(toolResult: ToolResultInfo): Promise<void> {
    const status = toolResult.success ? "completed" : "failed";
    await this.write("tool_result", `Tool ${status}`, {
      toolResult,
    });
  }

  /**
   * Close the log file
   */
  async close(): Promise<void> {
    if (this.file) {
      await this.write("info", "Logger closing");
      this.file.close();
      this.file = null;
    }
  }

  /**
   * Rotate log files (delete oldest if count exceeds maxFiles)
   */
  private async rotateLogFiles(): Promise<void> {
    const files: Array<{ name: string; mtime: Date | null }> = [];

    // List all .jsonl files in log directory
    try {
      for await (const entry of Deno.readDir(this.logDir)) {
        if (entry.isFile && entry.name.endsWith(".jsonl")) {
          const filePath = join(this.logDir, entry.name);
          const stat = await Deno.stat(filePath);
          files.push({
            name: entry.name,
            mtime: stat.mtime,
          });
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // Directory doesn't exist yet, no rotation needed
        return;
      }
      throw error;
    }

    // Sort by modification time (oldest first)
    files.sort((a, b) => {
      if (!a.mtime || !b.mtime) return 0;
      return a.mtime.getTime() - b.mtime.getTime();
    });

    // Delete oldest files if count exceeds maxFiles
    const filesToDelete = files.length - this.maxFiles + 1; // +1 for new file
    if (filesToDelete > 0) {
      const deletePromises = files.slice(0, filesToDelete).map(async (file) => {
        const filePath = join(this.logDir, file.name);
        try {
          await Deno.remove(filePath);
        } catch (error) {
          // deno-lint-ignore no-console
          console.warn(`Failed to delete old log file ${filePath}:`, error);
        }
      });
      await Promise.all(deletePromises);
    }
  }

  /**
   * Get the current log file path
   */
  getLogPath(): string {
    return this.logPath;
  }
}

/**
 * Create and initialize a logger
 *
 * @param logDir - Log directory
 * @param agentName - Agent name
 * @param correlationId - Optional correlation ID for tracing
 * @param maxFiles - Maximum log files to keep
 * @returns Initialized logger instance
 */
export async function createLogger(
  logDir: string,
  agentName: AgentName,
  correlationId?: string,
  maxFiles = 100,
): Promise<Logger> {
  const logger = new Logger(logDir, agentName, correlationId, maxFiles);
  await logger.initialize();
  return logger;
}

/**
 * Summarize tool input for logging (privacy-aware)
 *
 * @param toolName - Name of the tool
 * @param input - Tool input object
 * @returns Summarized string
 */
export function summarizeToolInput(
  toolName: string,
  input?: Record<string, unknown>,
): string {
  if (!input) return "";

  switch (toolName) {
    case "Read":
      return `file_path: ${input.file_path}`;
    case "Write":
      return `file_path: ${input.file_path}, content: ${
        String(input.content || "").length
      } chars`;
    case "Edit":
      return `file_path: ${input.file_path}`;
    case "Bash":
      return `command: ${
        String(input.command || "").substring(0, TRUNCATION.BASH_COMMAND)
      }...`;
    case "Glob":
      return `pattern: ${input.pattern}`;
    case "Grep":
      return `pattern: ${input.pattern}, path: ${input.path || "."}`;
    case "Skill":
      return `skill: ${input.skill}${
        input.args ? `, args: ${input.args}` : ""
      }`;
    case "Task":
      return `subagent: ${input.subagent_type}, desc: ${input.description}`;
    default:
      return JSON.stringify(input).substring(0, TRUNCATION.JSON_SUMMARY);
  }
}
