/**
 * AgentLogger - Unified logging API with pluggable LogWriter strategy
 *
 * Provides a common interface for all agent logging needs.
 * The actual persistence is delegated to a LogWriter implementation.
 */

import type { LogEntry, LogWriter } from "./log-writer.ts";

/**
 * Unified logger that delegates to a LogWriter strategy.
 *
 * This is the base class for both the common JSONL logger
 * and the src_common sync logger.
 */
export class AgentLogger {
  protected writer: LogWriter;
  protected stepCounter = 0;
  protected correlationId?: string;

  constructor(writer: LogWriter, correlationId?: string) {
    this.writer = writer;
    this.correlationId = correlationId;
  }

  /**
   * Write a log entry (async).
   * Compatible with common/logger.ts API.
   */
  async write(
    level: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.stepCounter++;
    const entry: LogEntry = {
      step: this.stepCounter,
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId: this.correlationId,
      metadata,
    };
    await this.writer.write(entry);
  }

  async close(): Promise<void> {
    await this.writer.close();
  }

  getLogPath(): string {
    return this.writer.getLogPath();
  }

  /** Get the current step count */
  getStepCount(): number {
    return this.stepCounter;
  }
}
