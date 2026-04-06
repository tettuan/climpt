/**
 * Handoff-to-Inputs Compatibility Validator
 *
 * Validates that when a step declares required inputs via `from: "stepId.key"`,
 * the source step's `structuredGate.handoffFields` can plausibly provide the
 * referenced data.
 *
 * This is a **warning-level** check because:
 * - The `from` field references the structured output path, determined by AI at runtime
 * - `handoffFields` define which paths to extract, but the AI may produce additional fields
 * - Config-time coverage is best-effort; full guarantee requires runtime validation
 *
 * Responsibility: Static handoff-input compatibility analysis (no I/O)
 * Side effects: None
 *
 * @module
 */

import type { ValidationResult } from "../src_common/types.ts";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Safely cast an unknown value to a Record, or return undefined. */
function asRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Parse a `from` field value into (sourceStepId, fieldKey).
 *
 * The `from` format is "stepId.key" where stepId may itself contain dots
 * (e.g., "initial.issue.understanding").
 *
 * Uses lastIndexOf to split at the final dot, matching the convention in
 * step-context.ts `toUV()`.
 *
 * @returns [stepId, key] or null if format is invalid
 */
function parseFromField(from: string): [string, string] | null {
  const dotPos = from.lastIndexOf(".");
  if (dotPos <= 0) return null;
  return [from.substring(0, dotPos), from.substring(dotPos + 1)];
}

/**
 * Check whether any of the handoffFields could plausibly provide a given key.
 *
 * A handoffField "covers" a key when the last segment of the handoffField path
 * matches the key. For example:
 * - handoffField "analysis.understanding" covers key "understanding"
 * - handoffField "issue" covers key "issue"
 * - handoffField "issue.number" covers key "number"
 *
 * This is a heuristic match — the handoff extraction uses the last segment of
 * the path as the key in the handoff record (see step-gate-interpreter.ts:315).
 */
function handoffFieldCoversKey(
  handoffFields: string[],
  key: string,
): boolean {
  for (const fieldPath of handoffFields) {
    const lastSegment = fieldPath.split(".").pop();
    if (lastSegment === key) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate handoff-to-inputs compatibility across all steps in a registry.
 *
 * For each step with `inputs`:
 * 1. Parse each input's `from` field to identify the source step and key
 * 2. Check if the source step exists
 * 3. Check if the source step's handoffFields could provide the required key
 * 4. Emit warnings for gaps (not errors — runtime may still succeed)
 *
 * @param registry - Parsed steps_registry.json content
 * @returns Validation result with warnings for coverage gaps
 */
export function validateHandoffInputs(
  registry: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const stepsRaw = asRecord(registry.steps) ?? {};
  const stepKeys = new Set(Object.keys(stepsRaw));

  for (const [stepId, stepDef] of Object.entries(stepsRaw)) {
    const step = asRecord(stepDef);
    if (!step) continue;

    const inputs = asRecord(step.inputs);
    if (!inputs) continue;

    for (const [inputName, inputDef] of Object.entries(inputs)) {
      const spec = asRecord(inputDef);
      if (!spec) continue;

      const from = spec.from;
      if (typeof from !== "string") continue;

      const parsed = parseFromField(from);
      if (!parsed) {
        // Invalid from format is already caught by other validators
        continue;
      }

      const [sourceStepId, key] = parsed;
      const isRequired = spec.required !== false; // default true

      // Check 1: Does the source step exist?
      if (!stepKeys.has(sourceStepId)) {
        if (isRequired) {
          warnings.push(
            `Step "${stepId}": required input "${inputName}" references ` +
              `source step "${sourceStepId}" (from "${from}") which does not exist in steps`,
          );
        }
        continue;
      }

      // Check 2: Does the source step have handoffFields?
      const sourceStep = asRecord(stepsRaw[sourceStepId]);
      if (!sourceStep) continue;

      const sourceGate = asRecord(sourceStep.structuredGate);
      if (!sourceGate) {
        if (isRequired) {
          warnings.push(
            `Step "${stepId}": required input "${inputName}" expects key "${key}" ` +
              `from step "${sourceStepId}", but "${sourceStepId}" has no structuredGate configuration`,
          );
        }
        continue;
      }

      const handoffFields = sourceGate.handoffFields;
      if (!Array.isArray(handoffFields)) {
        if (isRequired) {
          warnings.push(
            `Step "${stepId}": required input "${inputName}" expects key "${key}" ` +
              `from step "${sourceStepId}", but "${sourceStepId}" has no handoffFields declared`,
          );
        }
        continue;
      }

      if (handoffFields.length === 0) {
        if (isRequired) {
          warnings.push(
            `Step "${stepId}": required input "${inputName}" expects key "${key}" ` +
              `from step "${sourceStepId}", but "${sourceStepId}" has empty handoffFields`,
          );
        }
        continue;
      }

      // Check 3: Do the handoffFields cover the required key?
      const stringFields = handoffFields.filter(
        (f): f is string => typeof f === "string",
      );
      if (!handoffFieldCoversKey(stringFields, key)) {
        if (isRequired) {
          warnings.push(
            `Step "${stepId}": required input "${inputName}" expects key "${key}" ` +
              `from step "${sourceStepId}", but "${sourceStepId}" handoffFields ` +
              `[${
                stringFields.join(", ")
              }] do not produce a key named "${key}"`,
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
