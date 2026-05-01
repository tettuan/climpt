/**
 * Flow Errors - Errors related to step flow, schema resolution, and routing
 *
 * These errors occur during step flow execution:
 * - Schema resolution failures
 * - Step ID mismatches
 * - Step routing failures
 * - Gate interpretation failures
 * - Workflow routing failures
 * - Schema pointer/identifier errors
 */

import { ClimptError, type ExecutionErrorMarker } from "./base.ts";

/**
 * Schema resolution failed
 *
 * This error indicates that a JSON Pointer in outputSchemaRef could not be
 * resolved. The Flow loop should halt immediately - schema failures are fatal
 * because StepGate cannot interpret intents without structured output.
 */
export class AgentSchemaResolutionError extends ClimptError
  implements ExecutionErrorMarker {
  readonly code = "FAILED_SCHEMA_RESOLUTION";
  readonly recoverable = false;
  readonly executionFailure = true;
  readonly stepId: string;
  readonly schemaRef: string;
  readonly consecutiveFailures: number;

  constructor(
    message: string,
    options: {
      stepId: string;
      schemaRef: string;
      consecutiveFailures: number;
      cause?: Error;
      iteration?: number;
    },
  ) {
    super(message, { cause: options.cause, iteration: options.iteration });
    this.stepId = options.stepId;
    this.schemaRef = options.schemaRef;
    this.consecutiveFailures = options.consecutiveFailures;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      stepId: this.stepId,
      schemaRef: this.schemaRef,
      consecutiveFailures: this.consecutiveFailures,
    };
  }
}

/**
 * Step ID mismatch error
 *
 * This error indicates that the structuredOutput.stepId returned by the LLM
 * does not match the expected currentStepId. This is a configuration error
 * that should be fixed immediately - the schema may be missing a "const"
 * constraint or the LLM is returning the wrong step name.
 */
export class AgentStepIdMismatchError extends ClimptError
  implements ExecutionErrorMarker {
  readonly code = "AGENT_STEP_ID_MISMATCH";
  readonly recoverable = false;
  readonly executionFailure = true;
  readonly expectedStepId: string;
  readonly actualStepId: string;

  constructor(
    message: string,
    options: {
      expectedStepId: string;
      actualStepId: string;
      cause?: Error;
      iteration?: number;
    },
  ) {
    super(message, { cause: options.cause, iteration: options.iteration });
    this.expectedStepId = options.expectedStepId;
    this.actualStepId = options.actualStepId;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      expectedStepId: this.expectedStepId,
      actualStepId: this.actualStepId,
    };
  }
}

/**
 * Step routing failed
 *
 * This error indicates that StepGate could not determine an intent from the
 * structured output. This is a fatal error - all Flow steps must produce
 * structured output with a valid intent for routing to occur.
 *
 * @see agents/docs/design/08_step_flow_design.md Section 6
 */
export class AgentStepRoutingError extends ClimptError
  implements ExecutionErrorMarker {
  readonly code = "FAILED_STEP_ROUTING";
  readonly recoverable = false;
  readonly executionFailure = true;
  readonly stepId: string;

  constructor(
    message: string,
    options: {
      stepId: string;
      cause?: Error;
      iteration?: number;
    },
  ) {
    super(message, { cause: options.cause, iteration: options.iteration });
    this.stepId = options.stepId;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      stepId: this.stepId,
    };
  }
}

/**
 * Error thrown when gate interpretation fails.
 *
 * This error is thrown by StepGateInterpreter when it cannot determine
 * intent from the structured output. Now extends ClimptError.
 */
export class GateInterpretationError extends ClimptError
  implements ExecutionErrorMarker {
  readonly code = "GATE_INTERPRETATION_ERROR";
  readonly recoverable = false;
  readonly executionFailure = true;
  readonly stepId: string;
  readonly extractedValue?: unknown;

  constructor(
    message: string,
    stepId: string,
    extractedValue?: unknown,
    cause?: Error,
  ) {
    super(message, { cause });
    this.stepId = stepId;
    this.extractedValue = extractedValue;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      stepId: this.stepId,
      extractedValue: this.extractedValue,
    };
  }
}

/**
 * Error thrown when routing fails.
 *
 * This error is thrown by WorkflowRouter when step routing fails.
 * Now extends ClimptError.
 */
export class RoutingError extends ClimptError implements ExecutionErrorMarker {
  readonly code = "ROUTING_ERROR";
  readonly recoverable = false;
  readonly executionFailure = true;
  readonly stepId: string;
  readonly intent: string;

  constructor(
    message: string,
    stepId: string,
    intent: string,
    cause?: Error,
  ) {
    super(message, { cause });
    this.stepId = stepId;
    this.intent = intent;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      stepId: this.stepId,
      intent: this.intent,
    };
  }
}

/**
 * Error thrown when a JSON Pointer path cannot be resolved in a schema.
 * This is a fatal error that should halt the Flow loop.
 */
export class SchemaPointerError extends ClimptError
  implements ExecutionErrorMarker {
  readonly code = "SCHEMA_POINTER_ERROR";
  readonly recoverable = false;
  readonly executionFailure = true;
  readonly pointer: string;
  readonly file: string;

  constructor(pointer: string, file: string) {
    super(
      `No schema pointer "${pointer}" found in ${file}. ` +
        `Ensure the pointer uses JSON Pointer format (e.g., "#/definitions/stepId") ` +
        `and that the referenced definition exists in the schema file.`,
    );
    this.pointer = pointer;
    this.file = file;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      pointer: this.pointer,
      file: this.file,
    };
  }
}

/**
 * Circular $ref detected in schema resolution.
 *
 * This error indicates that following $ref pointers leads back to an
 * already-visited definition, creating an infinite loop. The schema file
 * must be corrected — silently returning an empty object would produce
 * an invalid schema that passes StepGate without proper validation.
 */
export class SchemaCircularReferenceError extends ClimptError
  implements ExecutionErrorMarker {
  readonly code = "SCHEMA_CIRCULAR_REFERENCE";
  readonly recoverable = false;
  readonly executionFailure = true;
  readonly refKey: string;
  readonly visitedPath: string[];

  constructor(
    refKey: string,
    visitedPath: string[],
  ) {
    super(
      `Circular $ref detected: "${refKey}" was already visited. ` +
        `Resolution path: ${visitedPath.join(" → ")} → ${refKey}. ` +
        `Fix the schema file to remove the circular reference.`,
    );
    this.refKey = refKey;
    this.visitedPath = visitedPath;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      refKey: this.refKey,
      visitedPath: this.visitedPath,
    };
  }
}

/**
 * Error thrown when a step's `adaptationChain` is exhausted.
 *
 * Per design doc `tmp/audit-precheck-kind-loop/framework-design/01-self-route-termination.md`
 * §2.4, this is the framework's structural guarantee that self-route
 * (`intent === "repeat"`) terminates. When the `AdaptationCursor` reaches
 * `chain.length`, the runner throws this error so the orchestrator can
 * transition the issue phase to `blocked` via the `IssueCloseFailedEvent`
 * path (design 16 §C, ExecutionError category).
 *
 * This is parallel to `AgentValidationAbortError` (validation-chain channel
 * exhaustion) — both are runtime-execution errors rooted at `ClimptError`,
 * but trigger entries differ (validator-driven vs LLM-driven `intent=repeat`).
 */
export class AgentAdaptationChainExhaustedError extends ClimptError
  implements ExecutionErrorMarker {
  readonly code = "AGENT_ADAPTATION_CHAIN_EXHAUSTED";
  readonly recoverable = false;
  readonly executionFailure = true;

  constructor(
    public readonly stepId: string,
    public readonly chainLength: number,
    public readonly lastAdaptation: string,
    options?: { cause?: Error; iteration?: number },
  ) {
    super(
      `Step "${stepId}" exhausted adaptation chain (length ${chainLength}, last: "${lastAdaptation}"). Self-route limit reached.`,
      options,
    );
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      stepId: this.stepId,
      chainLength: this.chainLength,
      lastAdaptation: this.lastAdaptation,
    };
  }
}

/**
 * Error thrown when a schema identifier is malformed.
 * Examples: "##/definitions/foo" (double hash), "//" (empty path segment)
 */
export class MalformedSchemaIdentifierError extends ClimptError
  implements ExecutionErrorMarker {
  readonly code = "MALFORMED_SCHEMA_IDENTIFIER";
  readonly recoverable = false;
  readonly executionFailure = true;
  readonly identifier: string;

  constructor(identifier: string, reason: string) {
    super(
      `Malformed schema identifier "${identifier}": ${reason}. ` +
        `Use standard JSON Pointer format (e.g., "#/definitions/stepId").`,
    );
    this.identifier = identifier;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      identifier: this.identifier,
    };
  }
}
