/**
 * Prompt Logger - Resolution Logging for Prompt Externalization
 *
 * Logs prompt resolution events to help with debugging and auditing.
 * Integrates with the existing Logger infrastructure.
 *
 * Supports multiple logger backends:
 * - common/logger.ts Logger (async write() method)
 * - src_common/logger.ts Logger (sync info/debug/warn/error methods)
 */

import type { Logger } from "./logger.ts";
// Support both resolver implementations
import type { PromptResolutionResult as CommonPromptResolutionResult } from "./prompt-resolver.ts";
import type { PromptResolutionResult as PromptsPromptResolutionResult } from "../prompts/resolver.ts";

/**
 * Unified prompt resolution result type that supports both resolvers.
 * - common/prompt-resolver.ts uses source: "user" | "fallback"
 * - prompts/resolver.ts uses source: "file" | "climpt" | "fallback"
 */
export type PromptResolutionResult =
  | CommonPromptResolutionResult
  | PromptsPromptResolutionResult;

/**
 * Minimal logger interface for PromptLogger.
 * Both common/logger.ts and src_common/logger.ts can satisfy this interface.
 */
export interface PromptLoggerBackend {
  /** Write method (async) - from common/logger.ts */
  write?(
    level: "info" | "debug" | "warn" | "error",
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  /** Sync log methods - from src_common/logger.ts */
  info?(message: string, data?: Record<string, unknown>): void;
  debug?(message: string, data?: Record<string, unknown>): void;
  warn?(message: string, data?: Record<string, unknown>): void;
  error?(message: string, data?: Record<string, unknown>): void;
}

/**
 * Prompt resolution log entry details
 */
export interface PromptResolutionLog {
  /** Step ID that was resolved */
  stepId: string;

  /**
   * Source of the resolved prompt:
   * - "user": User-provided prompt file (from common/prompt-resolver.ts)
   * - "file": Direct file read (from prompts/resolver.ts)
   * - "climpt": Resolved via Climpt CLI (from prompts/resolver.ts)
   * - "fallback": Built-in/embedded prompt
   */
  source: "user" | "file" | "climpt" | "fallback";

  /** Path to prompt file (e.g., "iterator/initial/issue/f_default.md") */
  promptPath?: string;

  /** Fallback key used (if source is "fallback") */
  fallbackKey?: string;

  /** Variables that were substituted (uv-* parameters) */
  variables?: Record<string, string>;

  /** Content length (for reference, not actual content for privacy) */
  contentLength: number;

  /** Resolution time in milliseconds */
  resolutionTimeMs?: number;

  /** Edition used for C3L path (e.g., "default", "empty") */
  edition?: string;

  /** Adaptation variant if used */
  adaptation?: string;

  /** Any warnings during resolution */
  warnings?: string[];
}

/**
 * Options for prompt resolution logging
 */
export interface PromptLoggerOptions {
  /** Log successful resolutions (default: true) */
  logSuccess?: boolean;

  /** Log resolution failures (default: true) */
  logFailures?: boolean;

  /** Log variable substitution details (default: false for privacy) */
  logVariables?: boolean;

  /** Log content preview (default: false for privacy) */
  logContentPreview?: boolean;

  /** Max preview length if logContentPreview is true (default: 100) */
  maxPreviewLength?: number;
}

/**
 * Prompt logger for tracking resolution events
 *
 * Usage:
 * ```typescript
 * const promptLogger = new PromptLogger(logger);
 * await promptLogger.logResolution(result);
 * ```
 */
export class PromptLogger {
  private options: Required<PromptLoggerOptions>;

  constructor(
    private readonly logger: PromptLoggerBackend | Logger,
    options: PromptLoggerOptions = {},
  ) {
    this.options = {
      logSuccess: options.logSuccess ?? true,
      logFailures: options.logFailures ?? true,
      logVariables: options.logVariables ?? false,
      logContentPreview: options.logContentPreview ?? false,
      maxPreviewLength: options.maxPreviewLength ?? 100,
    };
  }

  /**
   * Write to the logger backend, handling both async write() and sync log methods.
   */
  private async writeLog(
    level: "info" | "debug" | "warn" | "error",
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const backend = this.logger as PromptLoggerBackend;

    // Prefer async write() method if available (common/logger.ts)
    if (backend.write) {
      await backend.write(level, message, metadata);
      return;
    }

    // Fall back to sync log methods (src_common/logger.ts)
    switch (level) {
      case "info":
        backend.info?.(message, metadata);
        break;
      case "debug":
        backend.debug?.(message, metadata);
        break;
      case "warn":
        backend.warn?.(message, metadata);
        break;
      case "error":
        backend.error?.(message, metadata);
        break;
    }
  }

  /**
   * Log a successful prompt resolution
   *
   * @param result - Resolution result from PromptResolver
   * @param resolutionTimeMs - Optional resolution time in milliseconds
   */
  async logResolution(
    result: PromptResolutionResult,
    resolutionTimeMs?: number,
  ): Promise<void> {
    if (!this.options.logSuccess) return;

    const logEntry = this.buildLogEntry(result, resolutionTimeMs);

    // Map source to human-readable label
    const sourceLabels: Record<string, string> = {
      user: "user file",
      file: "file",
      climpt: "climpt",
      fallback: "fallback",
    };
    const sourceLabel = sourceLabels[result.source] ?? result.source;

    // Build log message with path info when available
    const pathInfo = result.promptPath ? ` [${result.promptPath}]` : "";

    await this.writeLog(
      "info",
      `Prompt resolved: ${result.stepId} (${sourceLabel})${pathInfo}`,
      {
        promptResolution: logEntry,
      },
    );
  }

  /**
   * Log a failed prompt resolution
   *
   * @param stepId - Step ID that failed to resolve
   * @param error - Error that occurred
   * @param context - Additional context
   */
  async logResolutionFailure(
    stepId: string,
    error: Error,
    context?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.options.logFailures) return;

    await this.writeLog("error", `Prompt resolution failed: ${stepId}`, {
      promptResolution: {
        stepId,
        error: {
          name: error.name,
          message: error.message,
        },
        ...context,
      },
    });
  }

  /**
   * Log a resolution warning
   *
   * @param stepId - Step ID
   * @param warning - Warning message
   * @param context - Additional context
   */
  async logWarning(
    stepId: string,
    warning: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    await this.writeLog("debug", `Prompt warning: ${stepId} - ${warning}`, {
      promptResolution: {
        stepId,
        warning,
        ...context,
      },
    });
  }

  /**
   * Log when falling back from user file to embedded prompt
   *
   * @param stepId - Step ID
   * @param userPath - User file path that was tried
   * @param fallbackKey - Fallback key being used
   */
  async logFallback(
    stepId: string,
    userPath: string,
    fallbackKey: string,
  ): Promise<void> {
    await this.writeLog(
      "debug",
      `Prompt fallback: ${stepId} (user file not found)`,
      {
        promptResolution: {
          stepId,
          attemptedUserPath: userPath,
          fallbackKey,
        },
      },
    );
  }

  /**
   * Build a log entry from resolution result
   */
  private buildLogEntry(
    result: PromptResolutionResult,
    resolutionTimeMs?: number,
  ): PromptResolutionLog {
    const entry: PromptResolutionLog = {
      stepId: result.stepId,
      source: result.source as PromptResolutionLog["source"],
      contentLength: result.content.length,
    };

    if (result.promptPath) {
      entry.promptPath = result.promptPath;
    }

    if (resolutionTimeMs !== undefined) {
      entry.resolutionTimeMs = resolutionTimeMs;
    }

    if (this.options.logVariables && result.substitutedVariables) {
      entry.variables = result.substitutedVariables;
    }

    // Include edition and adaptation if available (from prompts/resolver.ts)
    const extendedResult = result as PromptsPromptResolutionResult;
    if (extendedResult.edition) {
      entry.edition = extendedResult.edition;
    }
    if (extendedResult.adaptation) {
      entry.adaptation = extendedResult.adaptation;
    }

    return entry;
  }
}

/**
 * Log prompt resolution directly (standalone function)
 *
 * Use this when you don't need the full PromptLogger class.
 *
 * @param logger - Logger instance
 * @param result - Resolution result
 * @param options - Logging options
 */
export async function logPromptResolution(
  logger: Logger,
  result: PromptResolutionResult,
  options: { resolutionTimeMs?: number; logVariables?: boolean } = {},
): Promise<void> {
  // Map source to human-readable label
  const sourceLabels: Record<string, string> = {
    user: "user file",
    file: "file",
    climpt: "climpt",
    fallback: "fallback",
  };
  const sourceLabel = sourceLabels[result.source] ?? result.source;
  const pathInfo = result.promptPath ? ` [${result.promptPath}]` : "";

  // Include edition and adaptation if available
  const extendedResult = result as PromptsPromptResolutionResult;

  const metadata: Record<string, unknown> = {
    promptResolution: {
      stepId: result.stepId,
      source: result.source,
      contentLength: result.content.length,
      promptPath: result.promptPath,
      resolutionTimeMs: options.resolutionTimeMs,
      ...(extendedResult.edition ? { edition: extendedResult.edition } : {}),
      ...(extendedResult.adaptation
        ? { adaptation: extendedResult.adaptation }
        : {}),
      ...(options.logVariables && result.substitutedVariables
        ? { variables: result.substitutedVariables }
        : {}),
    },
  };

  await logger.write(
    "info",
    `Prompt resolved: ${result.stepId} (${sourceLabel})${pathInfo}`,
    metadata,
  );
}

/**
 * Create a timing wrapper for prompt resolution
 *
 * Usage:
 * ```typescript
 * const { result, timeMs } = await timePromptResolution(async () => {
 *   return resolver.resolve("initial.issue", variables);
 * });
 * ```
 *
 * @param resolveFn - Resolution function to time
 * @returns Result and timing
 */
export async function timePromptResolution<T>(
  resolveFn: () => Promise<T>,
): Promise<{ result: T; timeMs: number }> {
  const startTime = performance.now();
  const result = await resolveFn();
  const timeMs = performance.now() - startTime;
  return { result, timeMs };
}

/**
 * Format resolution result for human-readable output
 *
 * @param result - Resolution result
 * @returns Formatted string
 */
export function formatResolutionSummary(
  result: PromptResolutionResult,
): string {
  const parts: string[] = [];

  parts.push(`Step: ${result.stepId}`);
  parts.push(`Source: ${result.source}`);

  if (result.promptPath) {
    parts.push(`Path: ${result.promptPath}`);
  }

  parts.push(`Length: ${result.content.length} chars`);

  if (result.substitutedVariables) {
    const varCount = Object.keys(result.substitutedVariables).length;
    parts.push(`Variables: ${varCount}`);
  }

  return parts.join(" | ");
}
