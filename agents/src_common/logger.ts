/**
 * Logger for agent execution
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { isRecord, isString } from "./type-guards.ts";

export interface LoggerOptions {
  agentName: string;
  directory: string;
  format: "jsonl" | "text";
}

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
}

export class Logger {
  private agentName: string;
  private directory: string;
  private format: "jsonl" | "text";
  private file?: Deno.FsFile;
  private filePath?: string;
  private currentToolContext?: string;

  private constructor(options: LoggerOptions) {
    this.agentName = options.agentName;
    this.directory = options.directory;
    this.format = options.format;
  }

  static async create(options: LoggerOptions): Promise<Logger> {
    const logger = new Logger(options);
    await logger.initialize();
    return logger;
  }

  private async initialize(): Promise<void> {
    await ensureDir(this.directory);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const extension = this.format === "jsonl" ? "jsonl" : "log";
    this.filePath = join(
      this.directory,
      `${this.agentName}-${timestamp}.${extension}`,
    );

    this.file = await Deno.open(this.filePath, {
      write: true,
      create: true,
      append: true,
    });
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  setToolContext(toolName: string): void {
    this.currentToolContext = toolName;
  }

  clearToolContext(): void {
    this.currentToolContext = undefined;
  }

  private log(
    level: LogEntry["level"],
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(data && { data }),
    };

    // Console output
    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]`;
    const consoleMessage = data
      ? `${prefix} ${message} ${JSON.stringify(data)}`
      : `${prefix} ${message}`;

    switch (level) {
      case "debug":
        // deno-lint-ignore no-console
        console.debug(consoleMessage);
        break;
      case "info":
        // deno-lint-ignore no-console
        console.log(consoleMessage);
        break;
      case "warn":
        // deno-lint-ignore no-console
        console.warn(consoleMessage);
        break;
      case "error":
        // deno-lint-ignore no-console
        console.error(consoleMessage);
        break;
    }

    // File output
    this.writeToFile(entry);
  }

  private writeToFile(entry: LogEntry): void {
    if (!this.file) return;

    let line: string;

    if (this.format === "jsonl") {
      line = JSON.stringify(entry) + "\n";
    } else {
      const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
      line = entry.data
        ? `${prefix} ${entry.message} ${JSON.stringify(entry.data)}\n`
        : `${prefix} ${entry.message}\n`;
    }

    const encoder = new TextEncoder();
    this.file.writeSync(encoder.encode(line));
  }

  logSdkMessage(message: unknown): void {
    if (typeof message !== "object" || message === null) {
      this.debug("SDK message", { message });
      return;
    }

    const msg = message as Record<string, unknown>;
    const type = msg.type as string;

    switch (type) {
      case "assistant": {
        const content = this.extractTextContent(msg.message);
        if (content.length > 0) {
          this.debug("Assistant response", {
            content: content.substring(0, 200),
          });
        } else if (this.currentToolContext) {
          this.debug("Assistant streaming (tool)", {
            tool: this.currentToolContext,
          });
        }
        // Empty content without tool context is skipped
        break;
      }
      case "tool_use":
        this.setToolContext(msg.tool_name as string);
        this.debug("Tool use", { tool: msg.tool_name });
        break;
      case "tool_result":
        this.debug("Tool result", { success: true });
        this.clearToolContext();
        break;
      case "error":
        this.error("SDK error", { error: msg.error });
        break;
      case "result": {
        const resultData: Record<string, unknown> = {
          sessionId: msg.session_id,
        };
        if (msg.structured_output !== undefined) {
          resultData.structuredOutput = msg.structured_output;
        }
        this.debug("SDK result", resultData);
        break;
      }
      case "user": {
        const userContent = this.extractTextContent(msg.message);
        if (userContent.length > 0) {
          this.debug("User prompt", {
            content: userContent.substring(0, 500),
          });
        }
        break;
      }
      default:
        this.debug(`SDK message: ${type}`, { raw: msg });
    }
  }

  private extractTextContent(message: unknown): string {
    if (typeof message === "string") {
      return message;
    }
    if (isRecord(message)) {
      if (isString(message.content)) {
        return message.content;
      }
      if (Array.isArray(message.content)) {
        return message.content
          .filter((c): c is Record<string, unknown> =>
            isRecord(c) && c.type === "text"
          )
          .map((c) => isString(c.text) ? c.text : "")
          .join("\n");
      }
    }
    return JSON.stringify(message);
  }

  async close(): Promise<void> {
    if (this.file) {
      await this.file.close();
      this.file = undefined;
    }
  }

  getLogPath(): string | undefined {
    return this.filePath;
  }
}
