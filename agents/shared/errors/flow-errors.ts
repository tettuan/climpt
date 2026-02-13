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

import { ClimptError } from "./base.ts";

/**
 * Schema resolution failed
 *
 * This error indicates that a JSON Pointer in outputSchemaRef could not be
 * resolved. The Flow loop should halt immediately - schema failures are fatal
 * because StepGate cannot interpret intents without structured output.
 */
export class AgentSchemaResolutionError extends ClimptError {
  readonly code = "FAILED_SCHEMA_RESOLUTION";
  readonly recoverable = false;
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
export class AgentStepIdMismatchError extends ClimptError {
  readonly code = "AGENT_STEP_ID_MISMATCH";
  readonly recoverable = false;
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
export class AgentStepRoutingError extends ClimptError {
  readonly code = "FAILED_STEP_ROUTING";
  readonly recoverable = false;
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
export class GateInterpretationError extends ClimptError {
  readonly code = "GATE_INTERPRETATION_ERROR";
  readonly recoverable = false;
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
export class RoutingError extends ClimptError {
  readonly code = "ROUTING_ERROR";
  readonly recoverable = false;
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
export class SchemaPointerError extends ClimptError {
  readonly code = "SCHEMA_POINTER_ERROR";
  readonly recoverable = false;
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
 * Error thrown when a schema identifier is malformed.
 * Examples: "##/definitions/foo" (double hash), "//" (empty path segment)
 */
export class MalformedSchemaIdentifierError extends ClimptError {
  readonly code = "MALFORMED_SCHEMA_IDENTIFIER";
  readonly recoverable = false;
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
