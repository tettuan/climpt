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
 * Marker for the `ExecutionError` category (design 16 §C, lines 173-184):
 * Run-time SO/Verdict failures whose retry budget exhausted. Tagged
 * subclasses are the legitimate egress for the orchestrator F4 catch →
 * `IssueCloseFailedEvent` channel-D translation
 * (`agents/orchestrator/orchestrator.ts` dispatch catch).
 *
 * `ConfigurationError` (`ConfigError`, `BootValidationFailed`) MUST NOT
 * carry this marker — those are Boot-time rejects (design 16 §C lines
 * 175-177: "Boot 段階で reject ... AgentRuntime は起動しない"). Letting
 * them flow into the F4 channel-D egress would mis-route a Boot reject
 * into a runtime compensation comment.
 *
 * `ConnectionError` (transport / external I/O) is also outside this
 * marker (Transport owns its own retry; failures bubble up via Channel
 * publishers per design 30 §B).
 *
 * Tagged subclasses (canonical list, kept in sync with
 * `agents/shared/errors/flow-errors.ts` + `runner-errors.ts`):
 *   - AgentAdaptationChainExhaustedError (chain self-route exhausted)
 *   - AgentSchemaResolutionError (SO schema reference unresolvable)
 *   - AgentStepIdMismatchError (routed step id not in registry)
 *   - AgentStepRoutingError (transition target unresolvable)
 *   - GateInterpretationError (intent extraction failure)
 *   - RoutingError (legacy routing failure)
 *   - SchemaPointerError / SchemaCircularReferenceError /
 *     MalformedSchemaIdentifierError (schema-side run-time errors)
 *   - AgentMaxIterationsError (Flow loop iteration cap)
 *   - AgentValidationAbortError (postLLMConditions abort or maxAttempts)
 *
 * Discrimination: catchers test `isExecutionError(err)` rather than
 * `instanceof ClimptError && !err.recoverable`.
 */
export interface ExecutionErrorMarker {
  readonly executionFailure: true;
}

/**
 * Type guard for `ExecutionErrorMarker`. The orchestrator F4 catch uses
 * this to discriminate ExecutionError-class errors from ConfigurationError
 * / ConnectionError / non-ClimptError throws (which must escape so
 * BatchRunner's generic catch records `skipped[]` with a stack trace).
 */
export function isExecutionError(
  error: unknown,
): error is ClimptError & ExecutionErrorMarker {
  return (
    error instanceof ClimptError &&
    (error as unknown as { executionFailure?: unknown }).executionFailure ===
      true
  );
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
