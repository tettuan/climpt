/**
 * StepGateInterpreter - Extracts routing information from structured output
 *
 * Interprets AI responses through the structured gate configuration
 * to determine intent, target, and handoff data for step transitions.
 */

import type {
  GateIntent,
  PromptStepDefinition,
  StructuredGate,
} from "../common/step-registry.ts";

/**
 * Result of interpreting structured output through a step gate.
 */
export interface GateInterpretation {
  /** Extracted intent (e.g., "next", "closing", "repeat") */
  intent: GateIntent;
  /** Target step ID if intent is "jump" */
  target?: string;
  /** Extracted handoff data for next step */
  handoff?: Record<string, unknown>;
  /** Whether this was a fallback interpretation */
  usedFallback: boolean;
  /** Reason for the interpretation */
  reason?: string;
}

/**
 * Error thrown when gate interpretation fails.
 */
export class GateInterpretationError extends Error {
  public readonly stepId: string;
  public readonly extractedValue?: unknown;
  override readonly cause?: Error;

  constructor(
    message: string,
    stepId: string,
    extractedValue?: unknown,
    cause?: Error,
  ) {
    super(message, { cause });
    this.name = "GateInterpretationError";
    this.stepId = stepId;
    this.extractedValue = extractedValue;
    this.cause = cause;
  }
}

/**
 * Mapping from common AI response action values to GateIntent.
 */
const ACTION_TO_INTENT: Record<string, GateIntent> = {
  // Standard mappings
  next: "next",
  repeat: "repeat",
  jump: "jump",
  closing: "closing",
  abort: "abort",
  escalate: "escalate",
  handoff: "handoff",
  // Common aliases from AI responses
  continue: "next",
  retry: "repeat",
  wait: "repeat",
  done: "closing",
  finished: "closing",
  pass: "next",
  fail: "repeat",
};

/**
 * Valid GateIntent values for validation.
 */
const VALID_INTENTS: Set<GateIntent> = new Set([
  "next",
  "repeat",
  "jump",
  "closing",
  "abort",
  "escalate",
  "handoff",
]);

/**
 * Extract value from object at dot-notation path.
 *
 * @param obj - Object to extract from
 * @param path - Dot-notation path (e.g., "next_action.action")
 * @returns Value at path or undefined
 *
 * @example
 * getValueAtPath({ a: { b: "c" } }, "a.b") // => "c"
 * getValueAtPath({ items: [1, 2] }, "items.0") // => 1
 */
export function getValueAtPath(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * StepGateInterpreter extracts routing information from structured output.
 *
 * Uses the step's structuredGate configuration to:
 * 1. Extract intent from the response at the configured intentField
 * 2. Map the extracted value to a valid GateIntent
 * 3. Validate against allowedIntents
 * 4. Extract target for jump intent
 * 5. Extract handoff data from configured paths
 */
export class StepGateInterpreter {
  /**
   * Interpret structured output based on step definition.
   *
   * @param structuredOutput - Output from Claude SDK query
   * @param stepDef - Step definition with structuredGate config
   * @returns Interpreted gate result
   * @throws GateInterpretationError if interpretation fails and no fallback
   */
  interpret(
    structuredOutput: Record<string, unknown>,
    stepDef: PromptStepDefinition,
  ): GateInterpretation {
    const gate = stepDef.structuredGate;

    // If no structured gate config, return default "next"
    if (!gate) {
      return {
        intent: "next",
        usedFallback: true,
        reason: "No structuredGate configuration",
      };
    }

    // Try to extract and interpret intent
    const intentResult = this.extractIntent(structuredOutput, gate, stepDef);

    // Extract target for jump intent
    let target: string | undefined;
    if (intentResult.intent === "jump" && gate.targetField) {
      const targetValue = getValueAtPath(structuredOutput, gate.targetField);
      if (typeof targetValue === "string") {
        target = targetValue;
      }
    }

    // Extract handoff data
    const handoff = this.extractHandoff(structuredOutput, gate);

    // Extract reason from structured output if present
    const reason = this.extractReason(structuredOutput);

    return {
      intent: intentResult.intent,
      target,
      handoff: Object.keys(handoff).length > 0 ? handoff : undefined,
      usedFallback: intentResult.usedFallback,
      reason: reason ?? intentResult.reason,
    };
  }

  /**
   * Extract and validate intent from structured output.
   *
   * NOTE: intentField is now required in StructuredGate (per design/08_step_flow_design.md).
   * Runtime does not infer the field path - missing intentField is a config error
   * that should be caught at load time by validateIntentSchemaRef.
   */
  private extractIntent(
    output: Record<string, unknown>,
    gate: StructuredGate,
    stepDef: PromptStepDefinition,
  ): { intent: GateIntent; usedFallback: boolean; reason?: string } {
    // intentField is required - no inference fallback
    const intentField = gate.intentField;

    // Defensive check for runtime data that bypasses type system
    if (!intentField) {
      return this.useFallback(
        gate,
        stepDef.stepId,
        "intentField is required but missing - config error",
      );
    }

    // Extract raw value
    const rawValue = getValueAtPath(output, intentField);

    if (rawValue === undefined || rawValue === null) {
      return this.useFallback(
        gate,
        stepDef.stepId,
        `No value at path: ${intentField}`,
      );
    }

    // Convert to string for mapping
    const stringValue = typeof rawValue === "string"
      ? rawValue.toLowerCase()
      : String(rawValue).toLowerCase();

    // Map to GateIntent
    const mappedIntent = ACTION_TO_INTENT[stringValue];

    if (mappedIntent) {
      // Validate against allowed intents
      if (!gate.allowedIntents.includes(mappedIntent)) {
        return this.useFallback(
          gate,
          stepDef.stepId,
          `Intent '${mappedIntent}' not in allowedIntents`,
        );
      }
      return { intent: mappedIntent, usedFallback: false };
    }

    // Check if raw value is already a valid intent
    if (VALID_INTENTS.has(stringValue as GateIntent)) {
      const intent = stringValue as GateIntent;
      if (!gate.allowedIntents.includes(intent)) {
        return this.useFallback(
          gate,
          stepDef.stepId,
          `Intent '${intent}' not in allowedIntents`,
        );
      }
      return { intent, usedFallback: false };
    }

    return this.useFallback(
      gate,
      stepDef.stepId,
      `Unknown intent value: ${stringValue}`,
    );
  }

  /**
   * Use fallback intent or throw error.
   *
   * When `gate.failFast` is true, throws immediately without using fallback.
   * This aligns with 08_step_flow_design.md Section 4/6 which mandates
   * fail-fast behavior when intent cannot be determined.
   */
  private useFallback(
    gate: StructuredGate,
    stepId: string,
    reason: string,
  ): { intent: GateIntent; usedFallback: boolean; reason: string } {
    // Fail-fast mode (default per design doc): throw immediately without fallback
    // Per design doc Section 4/6: "When Gate cannot interpret intent,
    // Runner stops with FAILED_STEP_ROUTING"
    // Note: failFast defaults to true in schema as of design/08 update
    if (gate.failFast !== false) {
      throw new GateInterpretationError(
        `[failFast] Cannot determine intent: ${reason}. ` +
          `Step "${stepId}" has failFast enabled (default), no fallback allowed.`,
        stepId,
      );
    }

    // failFast=false: Log [StepFlow][SpecViolation] per design doc Section 6
    // This is an exceptional debug-only mode; production should use failFast=true
    // deno-lint-ignore no-console
    console.warn(
      `[StepFlow][SpecViolation] Step "${stepId}": Using fallback intent. ` +
        `Reason: ${reason}. failFast=false is for debugging only.`,
    );

    if (
      gate.fallbackIntent && gate.allowedIntents.includes(gate.fallbackIntent)
    ) {
      return {
        intent: gate.fallbackIntent,
        usedFallback: true,
        reason,
      };
    }

    // Default to "next" if it's allowed
    if (gate.allowedIntents.includes("next")) {
      return {
        intent: "next",
        usedFallback: true,
        reason,
      };
    }

    // Use first allowed intent as last resort
    if (gate.allowedIntents.length > 0) {
      return {
        intent: gate.allowedIntents[0],
        usedFallback: true,
        reason,
      };
    }

    throw new GateInterpretationError(
      `Cannot determine intent: ${reason}`,
      stepId,
    );
  }

  // NOTE: inferIntentField was removed - intentField is now required in StructuredGate
  // per design/08_step_flow_design.md Section 4. Runtime does not infer field paths.

  /**
   * Extract handoff data from structured output.
   */
  private extractHandoff(
    output: Record<string, unknown>,
    gate: StructuredGate,
  ): Record<string, unknown> {
    const handoff: Record<string, unknown> = {};

    if (!gate.handoffFields || gate.handoffFields.length === 0) {
      return handoff;
    }

    for (const fieldPath of gate.handoffFields) {
      const value = getValueAtPath(output, fieldPath);
      if (value !== undefined) {
        // Use last part of path as key
        const key = fieldPath.split(".").pop() ?? fieldPath;
        handoff[key] = value;
      }
    }

    return handoff;
  }

  /**
   * Extract reason from structured output if present.
   */
  private extractReason(output: Record<string, unknown>): string | undefined {
    // Try common reason/message fields
    const reasonPaths = [
      "next_action.reason",
      "reason",
      "message",
      "next_action.details.reason",
    ];

    for (const path of reasonPaths) {
      const value = getValueAtPath(output, path);
      if (typeof value === "string") {
        return value;
      }
    }

    return undefined;
  }
}
