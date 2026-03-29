/**
 * Logger Interface - Shared logging contract
 *
 * Extracted from agents/src_common/logger.ts to provide a clean
 * interface that consumers can depend on without importing the
 * full Logger implementation.
 */

/**
 * Standard log entry structure
 */
export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Logger interface for agent execution logging.
 *
 * Consumers should import this interface for type annotations.
 * The concrete implementation is in agents/src_common/logger.ts.
 */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  logSdkMessage(message: unknown): void;
  setToolContext(toolName: string): void;
  clearToolContext(): void;
  close(): Promise<void>;
  getLogPath(): string | undefined;
}
