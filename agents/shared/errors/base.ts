/**
 * ClimptError - Abstract base class for all Climpt errors
 *
 * Provides a unified error interface with:
 * - `code`: programmatic error code
 * - `recoverable`: whether retry/recovery is possible
 * - `iteration`: optional iteration context
 * - `toJSON()`: structured representation for logging
 *
 * All domain-specific errors extend this class.
 */

/**
 * Abstract base class for all Climpt errors.
 *
 * Replaces the previous `AgentError` as the root of the error hierarchy.
 * `AgentError` is re-exported as an alias for backward compatibility.
 */
export abstract class ClimptError extends Error {
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
 * Type guard for ClimptError
 */
export function isClimptError(error: unknown): error is ClimptError {
  return error instanceof ClimptError;
}

/**
 * @deprecated Use ClimptError instead. This alias exists for backward compatibility.
 */
export const AgentError = ClimptError;
/**
 * @deprecated Use ClimptError type instead.
 */
export type AgentError = ClimptError;

/**
 * @deprecated Use isClimptError instead.
 */
export const isAgentError = isClimptError;
