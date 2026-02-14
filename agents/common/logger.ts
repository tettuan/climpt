/**
 * Common Agent Logger
 *
 * JSONL logger with automatic rotation, shared by all agents.
 * Now backed by shared AgentLogger + JsonlWriter + rotateLogFiles.
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
import { AgentLogger } from "../shared/logging/agent-logger.ts";
import { JsonlWriter } from "../shared/logging/log-writer.ts";
import { rotateLogFiles } from "../shared/logging/log-rotation.ts";

/**
 * JSONL Logger for agents
 *
 * Thin wrapper around AgentLogger + JsonlWriter, preserving the original API.
 */
export class Logger {
  private agentLogger: AgentLogger | null = null;
  private writer: JsonlWriter;
  private logPath: string;
  private maxFiles: number;
  private logDir: string;
  private correlationId?: string;

  constructor(
    logDir: string,
    _agentName: AgentName,
    correlationId?: string,
    maxFiles = 100,
  ) {
    this.logDir = logDir;
    this.correlationId = correlationId;
    this.maxFiles = maxFiles;

    const timestamp = new Date().toISOString().replace(/:/g, "-").replace(
      /\./g,
      "-",
    );
    this.logPath = join(logDir, `session-${timestamp}.jsonl`);
    this.writer = new JsonlWriter(this.logPath);
  }

  async initialize(): Promise<void> {
    await Deno.mkdir(this.logDir, { recursive: true });
    await rotateLogFiles(this.logDir, this.maxFiles);
    await this.writer.initialize();
    this.agentLogger = new AgentLogger(this.writer, this.correlationId);

    await this.write("info", "Logger initialized", {
      logPath: this.logPath,
      maxFiles: this.maxFiles,
    });
  }

  async write(
    level: LogLevel,
    message: string,
    metadata?: LogEntry["metadata"],
  ): Promise<void> {
    if (!this.agentLogger) {
      throw new Error("Logger not initialized. Call initialize() first.");
    }
    await this.agentLogger.write(level, message, metadata);
  }

  async logToolUse(toolUse: ToolUseInfo): Promise<void> {
    await this.write("tool_use", `Tool invoked: ${toolUse.toolName}`, {
      toolUse,
    });
  }

  async logToolResult(toolResult: ToolResultInfo): Promise<void> {
    const status = toolResult.success ? "completed" : "failed";
    await this.write("tool_result", `Tool ${status}`, {
      toolResult,
    });
  }

  async close(): Promise<void> {
    if (this.agentLogger) {
      await this.write("info", "Logger closing");
      await this.agentLogger.close();
      this.agentLogger = null;
    }
  }

  getLogPath(): string {
    return this.logPath;
  }
}

/**
 * Create and initialize a logger
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
