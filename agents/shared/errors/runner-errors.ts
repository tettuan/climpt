/**
 * Runner Errors - Errors related to query execution, verdict, and timeouts
 *
 * These errors occur during the agent runner lifecycle:
 * - Query execution failures
 * - Verdict check failures
 * - Operation timeouts
 * - Max iterations exceeded
 * - Runner not initialized
 * - Retryable query failures
 */

import { ClimptError, type ExecutionErrorMarker } from "./base.ts";

/**
 * Runner accessed before initialization
 */
export class AgentNotInitializedError extends ClimptError {
  readonly code = "AGENT_NOT_INITIALIZED";
  readonly recoverable = false;

  constructor(options?: { message?: string; cause?: Error }) {
    super(
      options?.message ?? "AgentRunner must be initialized before use",
      { cause: options?.cause },
    );
  }
}

/**
 * SDK query execution failed
 */
export class AgentQueryError extends ClimptError {
  readonly code = "AGENT_QUERY_ERROR";
  readonly recoverable = true;

  constructor(
    message: string,
    options?: { cause?: Error; iteration?: number },
  ) {
    super(message, options);
  }
}

/**
 * Verdict check failed
 */
export class AgentVerdictError extends ClimptError {
  readonly code = "AGENT_VERDICT_ERROR";
  readonly recoverable = true;

  constructor(
    message: string,
    options?: { cause?: Error; iteration?: number },
  ) {
    super(message, options);
  }
}

/**
 * Operation timed out
 */
export class AgentTimeoutError extends ClimptError {
  readonly code = "AGENT_TIMEOUT";
  readonly recoverable = true;

  /**
   * Timeout duration in milliseconds
   */
  readonly timeoutMs: number;

  constructor(
    message: string,
    timeoutMs: number,
    options?: { cause?: Error; iteration?: number },
  ) {
    super(message, options);
    this.timeoutMs = timeoutMs;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      timeoutMs: this.timeoutMs,
    };
  }
}

/**
 * Maximum iterations reached without finishing
 */
export class AgentMaxIterationsError extends ClimptError
  implements ExecutionErrorMarker {
  readonly code = "AGENT_MAX_ITERATIONS";
  readonly recoverable = false;
  readonly executionFailure = true;

  /**
   * The maximum iterations limit
   */
  readonly maxIterations: number;

  constructor(maxIterations: number, iteration?: number) {
    super(
      `Maximum iterations (${maxIterations}) reached without finishing`,
      { iteration },
    );
    this.maxIterations = maxIterations;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      maxIterations: this.maxIterations,
    };
  }
}

/**
 * SDK Error Category type
 */
export type SdkErrorCategoryType =
  | "environment"
  | "network"
  | "api"
  | "input"
  | "internal"
  | "unknown";

/**
 * Retryable query error with additional context
 *
 * This error indicates a query failure that may be recovered
 * by retrying after a delay.
 */
export class AgentRetryableQueryError extends ClimptError {
  readonly code = "AGENT_RETRYABLE_QUERY_ERROR";
  readonly recoverable = true;
  readonly category: SdkErrorCategoryType;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      category: SdkErrorCategoryType;
      retryAfterMs?: number;
      cause?: Error;
      iteration?: number;
    },
  ) {
    super(message, { cause: options.cause, iteration: options.iteration });
    this.category = options.category;
    this.retryAfterMs = options.retryAfterMs;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      category: this.category,
      retryAfterMs: this.retryAfterMs,
    };
  }
}

/**
 * Validation aborted (unrecoverable failure or maxAttempts exceeded)
 */
export class AgentValidationAbortError extends ClimptError
  implements ExecutionErrorMarker {
  readonly code = "AGENT_VALIDATION_ABORT";
  readonly recoverable = false;
  readonly executionFailure = true;

  /**
   * Step ID where validation was aborted
   */
  readonly stepId?: string;

  constructor(
    message: string,
    options?: { cause?: Error; iteration?: number; stepId?: string },
  ) {
    super(message, options);
    this.stepId = options?.stepId;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      stepId: this.stepId,
    };
  }
}

/**
 * Normalize any error to a ClimptError (AgentQueryError as default)
 */
export function normalizeToAgentError(
  error: unknown,
  options?: { iteration?: number },
): ClimptError {
  if (error instanceof ClimptError) {
    return error;
  }
  if (error instanceof Error) {
    return new AgentQueryError(error.message, {
      cause: error,
      iteration: options?.iteration,
    });
  }
  return new AgentQueryError(String(error), {
    iteration: options?.iteration,
  });
}
