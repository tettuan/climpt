/**
 * Climpt MCP Server - Prompt Execution Logger
 *
 * プロンプト実行ログをJSONL形式で出力
 * - セッション単位でファイル作成
 * - 自動ローテーション（最大100ファイル）
 */

import { join } from "@std/path";

/**
 * Log entry for prompt execution
 */
export interface PromptExecutionLog {
  timestamp: string;
  level: "info";
  message: "Climpt prompt executed";
  metadata: {
    type: "climpt_prompt_used";
    c1: string;
    c2: string;
    c3: string;
    promptPath: string;
  };
}

/**
 * JSONL Logger for prompt execution tracking
 */
export class PromptLogger {
  private file: Deno.FsFile | null = null;
  private logPath: string = "";
  private logDir: string;
  private maxFiles: number;

  /**
   * Create a new PromptLogger instance
   *
   * @param logDir - Directory to store log files (relative to cwd)
   * @param maxFiles - Maximum number of log files to keep
   */
  constructor(
    logDir: string = "tmp/logs/agents/climpt",
    maxFiles: number = 100,
  ) {
    this.logDir = logDir;
    this.maxFiles = maxFiles;
  }

  /**
   * Initialize the logger (create directory, open file)
   */
  async initialize(): Promise<void> {
    // Ensure log directory exists
    await Deno.mkdir(this.logDir, { recursive: true });

    // Rotate old log files if needed
    await this.rotateLogFiles();

    // Generate log file path with ISO timestamp
    const timestamp = new Date().toISOString().replace(/:/g, "-").replace(
      /\./g,
      "-",
    );
    this.logPath = join(this.logDir, `session-${timestamp}.jsonl`);

    // Open log file for writing
    this.file = await Deno.open(this.logPath, {
      write: true,
      create: true,
      append: true,
    });
  }

  /**
   * Write a prompt execution log entry
   *
   * @param params - Execution parameters (agent, c1, c2, c3)
   */
  async writeExecutionLog(params: {
    agent: string;
    c1: string;
    c2: string;
    c3: string;
  }): Promise<void> {
    if (!this.file) {
      // Lazy initialization if not already initialized
      await this.initialize();
    }

    const { agent, c1, c2, c3 } = params;

    // Build promptPath: agent/{agent}/prompts/{c1}/{c2}/{c3}/f_default.md
    const promptPath = `agent/${agent}/prompts/${c1}/${c2}/${c3}/f_default.md`;

    const entry: PromptExecutionLog = {
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Climpt prompt executed",
      metadata: {
        type: "climpt_prompt_used",
        c1,
        c2,
        c3,
        promptPath,
      },
    };

    const line = JSON.stringify(entry) + "\n";
    const encoder = new TextEncoder();
    await this.file!.write(encoder.encode(line));
  }

  /**
   * Close the log file
   */
  close(): void {
    if (this.file) {
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

// Singleton instance for MCP server
let promptLoggerInstance: PromptLogger | null = null;

/**
 * Get or create the singleton PromptLogger instance
 */
export async function getPromptLogger(): Promise<PromptLogger> {
  if (!promptLoggerInstance) {
    promptLoggerInstance = new PromptLogger();
    await promptLoggerInstance.initialize();
  }
  return promptLoggerInstance;
}
