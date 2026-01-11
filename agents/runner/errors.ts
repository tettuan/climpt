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
