/**
 * AgentError Hierarchy - Structured errors for AgentRunner
 *
 * Hierarchy:
 * - AgentError (abstract base)
 *   - AgentNotInitializedError (runner not initialized)
 *   - AgentQueryError (SDK query failed)
 *   - AgentCompletionError (completion check failed)
 *   - AgentActionError (action execution failed)
 *   - AgentTimeoutError (operation timeout)
 *   - AgentMaxIterationsError (max iterations exceeded)
 */

/**
 * Base class for all agent errors
 */
export abstract class AgentError extends Error {
  /**
   * Error code for programmatic handling
   */
  abstract readonly code: string;

  /**
   * Whether this error allows recovery (e.g., retry)
   */
  abstract readonly recoverable: boolean;

  /**
   * Iteration number when error occurred (if applicable)
   */
  readonly iteration?: number;

  constructor(
    message: string,
    options?: { cause?: Error; iteration?: number },
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.iteration = options?.iteration;
  }

  /**
   * Get a structured representation for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      iteration: this.iteration,
      cause: this.cause instanceof Error ? this.cause.message : undefined,
    };
  }
}

/**
 * Runner accessed before initialization
 */
export class AgentNotInitializedError extends AgentError {
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
export class AgentQueryError extends AgentError {
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
 * Completion check failed
 */
export class AgentCompletionError extends AgentError {
  readonly code = "AGENT_COMPLETION_ERROR";
  readonly recoverable = true;

  constructor(
    message: string,
    options?: { cause?: Error; iteration?: number },
  ) {
    super(message, options);
  }
}

/**
 * Action execution failed
 */
export class AgentActionError extends AgentError {
  readonly code = "AGENT_ACTION_ERROR";
  readonly recoverable = true;

  /**
   * The action that failed
   */
  readonly actionType?: string;

  constructor(
    message: string,
    options?: { cause?: Error; iteration?: number; actionType?: string },
  ) {
    super(message, options);
    this.actionType = options?.actionType;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      actionType: this.actionType,
    };
  }
}

/**
 * Operation timed out
 */
export class AgentTimeoutError extends AgentError {
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
 * Maximum iterations reached without completion
 */
export class AgentMaxIterationsError extends AgentError {
  readonly code = "AGENT_MAX_ITERATIONS";
  readonly recoverable = false;

  /**
   * The maximum iterations limit
   */
  readonly maxIterations: number;

  constructor(maxIterations: number, iteration?: number) {
    super(
      `Maximum iterations (${maxIterations}) reached without completion`,
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
 * Type guard for AgentError
 */
export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError;
}

/**
 * Normalize any error to AgentError
 */
export function normalizeToAgentError(
  error: unknown,
  options?: { iteration?: number },
): AgentError {
  if (error instanceof AgentError) {
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

// Import types for new error classes
// Note: These are imported here to avoid circular dependencies
// and because the base errors.ts should remain independent

/**
 * SDK Error Category (duplicated to avoid circular import)
 * Full definition in error-classifier.ts
 */
export type SdkErrorCategoryType =
  | "environment"
  | "network"
  | "api"
  | "input"
  | "internal"
  | "unknown";

/**
 * Environment information (duplicated to avoid circular import)
 * Full definition in environment-checker.ts
 */
export interface EnvironmentInfoType {
  insideClaudeCode: boolean;
  sandboxed: boolean;
  nestLevel: number;
  warnings: string[];
}

/**
 * Environment constraint error (e.g., double sandbox)
 *
 * This error indicates the execution environment does not support
 * SDK operations. It is not recoverable without changing the
 * execution context.
 */
export class AgentEnvironmentError extends AgentError {
  readonly code = "AGENT_ENVIRONMENT_ERROR";
  readonly recoverable = false;
  readonly category: SdkErrorCategoryType;
  readonly guidance: string;
  readonly environment: EnvironmentInfoType;

  constructor(
    message: string,
    options: {
      category: SdkErrorCategoryType;
      guidance: string;
      environment: EnvironmentInfoType;
      cause?: Error;
      iteration?: number;
    },
  ) {
    super(message, { cause: options.cause, iteration: options.iteration });
    this.category = options.category;
    this.guidance = options.guidance;
    this.environment = options.environment;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      category: this.category,
      guidance: this.guidance,
      environment: this.environment,
    };
  }
}

/**
 * Retryable query error with additional context
 *
 * This error indicates a query failure that may be recovered
 * by retrying after a delay.
 */
export class AgentRetryableQueryError extends AgentError {
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
