/**
 * Iterate Agent - JSONL Logger
 *
 * Handles logging to JSONL format with automatic rotation.
 */

import { join } from "jsr:@std/path@^1";
import type { AgentName, LogEntry, LogLevel } from "./types.ts";

/**
 * JSONL Logger for iterate-agent
 */
export class Logger {
  private file: Deno.FsFile | null = null;
  private logPath: string;
  private maxFiles: number;
  private logDir: string;
  private stepCounter: number = 0;

  /**
   * Create a new Logger instance
   *
   * @param logDir - Directory to store log files
   * @param agentName - MCP agent name (used in directory path)
   * @param maxFiles - Maximum number of log files to keep
   */
  constructor(logDir: string, _agentName: AgentName, maxFiles: number = 100) {
    this.logDir = logDir;
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
      metadata,
    };

    const line = JSON.stringify(entry) + "\n";
    const encoder = new TextEncoder();
    await this.file.write(encoder.encode(line));
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
      for (let i = 0; i < filesToDelete; i++) {
        const filePath = join(this.logDir, files[i].name);
        try {
          await Deno.remove(filePath);
        } catch (error) {
          console.warn(`Failed to delete old log file ${filePath}:`, error);
        }
      }
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
 * @param agentName - MCP agent name
 * @param maxFiles - Maximum log files to keep
 * @returns Initialized logger instance
 */
export async function createLogger(
  logDir: string,
  agentName: AgentName,
  maxFiles: number = 100,
): Promise<Logger> {
  const logger = new Logger(logDir, agentName, maxFiles);
  await logger.initialize();
  return logger;
}
