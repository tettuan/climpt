/**
 * Orchestrator Logger
 *
 * File-based JSONL logger for orchestrator workflow execution.
 * Always writes to `tmp/logs/orchestrator/session-{timestamp}.jsonl`.
 * Console output is controlled by the `verbose` flag.
 *
 * Reuses shared logging infrastructure (JsonlWriter, rotateLogFiles).
 */

import { join } from "@std/path";
import {
  AgentLogger,
  JsonlWriter,
  rotateLogFiles,
} from "../shared/logging/mod.ts";

const LOG_DIR = "tmp/logs/orchestrator";
const MAX_FILES = 50;

export class OrchestratorLogger {
  #logger: AgentLogger;
  #verbose: boolean;

  private constructor(logger: AgentLogger, verbose: boolean) {
    this.#logger = logger;
    this.#verbose = verbose;
  }

  /** Create and initialize a new orchestrator logger session. */
  static async create(
    cwd: string,
    options?: { verbose?: boolean; correlationId?: string },
  ): Promise<OrchestratorLogger> {
    const logDir = join(cwd, LOG_DIR);
    await rotateLogFiles(logDir, MAX_FILES);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = join(logDir, `session-${timestamp}.jsonl`);

    const writer = new JsonlWriter(logPath);
    await writer.initialize();

    const logger = new AgentLogger(writer, options?.correlationId);
    return new OrchestratorLogger(logger, options?.verbose ?? false);
  }

  /** Log info-level event. Always writes to file; console only if verbose. */
  async info(
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (this.#verbose) {
      // deno-lint-ignore no-console
      console.log(`[orchestrator] ${message}`);
    }
    await this.#logger.write("info", message, metadata);
  }

  /** Log warn-level event. Always writes to file and console. */
  async warn(
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    // deno-lint-ignore no-console
    console.warn(`[orchestrator] ${message}`);
    await this.#logger.write("warn", message, metadata);
  }

  /** Log error-level event. Always writes to file and console. */
  async error(
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    // deno-lint-ignore no-console
    console.error(`[orchestrator] ${message}`);
    await this.#logger.write("error", message, metadata);
  }

  async close(): Promise<void> {
    await this.#logger.close();
  }

  getLogPath(): string {
    return this.#logger.getLogPath();
  }
}
