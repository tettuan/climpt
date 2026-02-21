/**
 * Climpt MCP Server - Prompt Execution Logger
 *
 * Output prompt execution logs in JSONL format
 * - Create file per session
 * - Automatic rotation (max 100 files)
 */

import { join } from "@std/path";
import { logger } from "../utils/logger.ts";

/**
 * C3L coordinates for prompt identification
 */
export interface C3LCoordinates {
  /** Domain (c1) - e.g., "climpt-git", "climpt-code", "climpt-test" */
  c1: string;
  /** Action (c2) - e.g., "create", "review", "fix" */
  c2: string;
  /** Target (c3) - e.g., "issue", "branch", "file" */
  c3: string;
}

/**
 * Execution context for prompt call
 */
export interface ExecutionContext {
  /** Agent name - e.g., "climpt", "iterator" */
  agent: string;
  /** Edition (layer type) - e.g., "default", "issue", "task" */
  edition?: string;
  /** Adaptation (prompt variation) */
  adaptation?: string;
  /** Command options passed */
  options?: string[];
  /** Input source - "stdin", "file", or file path */
  inputSource?: string;
  /** Output destination */
  outputDestination?: string;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Exit code if available */
  exitCode?: number;
  /** Error message if failed */
  errorMessage?: string;
  /** Execution duration in milliseconds */
  durationMs?: number;
}

/**
 * Log entry for prompt execution
 */
export interface PromptExecutionLog {
  timestamp: string;
  level: "info" | "error";
  message: string;
  metadata: {
    type: "climpt_prompt_call";
    /** C3L coordinates */
    c3l: C3LCoordinates;
    /** Full prompt path */
    promptPath: string;
    /** Execution context */
    context: ExecutionContext;
    /** Execution result (if completed) */
    result?: ExecutionResult;
    /** Invocation source */
    source: "cli" | "mcp";
  };
}

/**
 * JSONL Logger for prompt execution tracking
 */
export class PromptLogger {
  private file: Deno.FsFile | null = null;
  private logPath = "";
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
   * Write a prompt execution log entry (legacy format, kept for compatibility)
   *
   * @param params - Execution parameters (agent, c1, c2, c3)
   * @deprecated Use logPromptCall instead
   */
  async writeExecutionLog(params: {
    agent: string;
    c1: string;
    c2: string;
    c3: string;
  }): Promise<void> {
    await this.logPromptCall({
      c3l: { c1: params.c1, c2: params.c2, c3: params.c3 },
      context: { agent: params.agent },
      source: "mcp",
    });
  }

  /**
   * Log a prompt call with full context
   *
   * @param params - Full execution parameters
   */
  async logPromptCall(params: {
    c3l: C3LCoordinates;
    context: ExecutionContext;
    result?: ExecutionResult;
    source: "cli" | "mcp";
  }): Promise<void> {
    if (!this.file) {
      await this.initialize();
    }

    const { c3l, context, result, source } = params;
    const { c1, c2, c3 } = c3l;

    // Build promptPath based on edition
    const edition = context.edition || "default";
    const adaptation = context.adaptation ? `_${context.adaptation}` : "";
    const promptPath =
      `.agent/${context.agent}/prompts/${c1}/${c2}/${c3}/f_${edition}${adaptation}.md`;

    const entry: PromptExecutionLog = {
      timestamp: new Date().toISOString(),
      level: result?.success === false ? "error" : "info",
      message: result
        ? (result.success ? "Climpt prompt completed" : "Climpt prompt failed")
        : "Climpt prompt called",
      metadata: {
        type: "climpt_prompt_call",
        c3l: { c1, c2, c3 },
        promptPath,
        context,
        result,
        source,
      },
    };

    const line = JSON.stringify(entry) + "\n";
    const encoder = new TextEncoder();
    if (this.file) {
      await this.file.write(encoder.encode(line));
    }
  }

  /**
   * Create an execution tracker for measuring duration
   *
   * @param c3l - C3L coordinates
   * @param context - Execution context
   * @param source - Invocation source
   * @returns Object with complete() method to finalize the log
   */
  startExecution(
    c3l: C3LCoordinates,
    context: ExecutionContext,
    source: "cli" | "mcp",
  ): {
    complete: (result: Omit<ExecutionResult, "durationMs">) => Promise<void>;
  } {
    const startTime = Date.now();

    return {
      complete: async (result: Omit<ExecutionResult, "durationMs">) => {
        const durationMs = Date.now() - startTime;
        await this.logPromptCall({
          c3l,
          context,
          result: { ...result, durationMs },
          source,
        });
      },
    };
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
      // Collect all jsonl file names first
      const jsonlFiles: string[] = [];
      for await (const entry of Deno.readDir(this.logDir)) {
        if (entry.isFile && entry.name.endsWith(".jsonl")) {
          jsonlFiles.push(entry.name);
        }
      }

      // Stat all files in parallel
      const statResults = await Promise.all(
        jsonlFiles.map(async (name) => {
          const filePath = join(this.logDir, name);
          const stat = await Deno.stat(filePath);
          return { name, mtime: stat.mtime };
        }),
      );
      files.push(...statResults);
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
          logger.warn(`Failed to delete old log file ${filePath}:`, error);
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

/**
 * Parse CLI arguments to extract C3L coordinates and context
 *
 * @param args - CLI arguments
 * @param configPrefix - Config prefix (agent name)
 * @returns Parsed C3L coordinates and context, or null if not a prompt call
 */
export function parseCliArgsForLogging(
  args: string[],
  configPrefix?: string,
): { c3l: C3LCoordinates; context: ExecutionContext } | null {
  // Filter out option arguments to get positional args
  const positionalArgs = args.filter((arg) => !arg.startsWith("-"));

  let c1: string;
  let c2: string;
  let c3: string;

  if (configPrefix) {
    // With configPrefix (e.g., "git"): c1 = "climpt-git", positional = [c2, c3]
    if (positionalArgs.length < 2) return null;
    c1 = `climpt-${configPrefix}`;
    c2 = positionalArgs[0];
    c3 = positionalArgs[1];
  } else {
    // Without configPrefix: positional = [domain, c2, c3]
    if (positionalArgs.length < 3) return null;
    c1 = `climpt-${positionalArgs[0]}`;
    c2 = positionalArgs[1];
    c3 = positionalArgs[2];
  }

  const agent = "climpt";

  // Parse options
  const options: string[] = [];
  let edition: string | undefined;
  let adaptation: string | undefined;
  let inputSource: string | undefined;
  let outputDestination: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("-e=") || arg.startsWith("--edition=")) {
      edition = arg.split("=")[1];
    } else if (arg.startsWith("-a=") || arg.startsWith("--adaptation=")) {
      adaptation = arg.split("=")[1];
    } else if (arg.startsWith("-f=") || arg.startsWith("--from=")) {
      inputSource = arg.split("=")[1];
    } else if (arg.startsWith("-o=") || arg.startsWith("--destination=")) {
      outputDestination = arg.split("=")[1];
    } else if (arg.startsWith("-") || arg.startsWith("--")) {
      options.push(arg);
    }
  }

  // Check for stdin input
  if (!inputSource && !Deno.stdin.isTerminal()) {
    inputSource = "stdin";
  }

  return {
    c3l: { c1, c2, c3 },
    context: {
      agent,
      edition,
      adaptation,
      options: options.length > 0 ? options : undefined,
      inputSource,
      outputDestination,
    },
  };
}
