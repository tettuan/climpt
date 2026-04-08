/**
 * Prompt Resolution Validator
 *
 * Validates that each step in steps_registry.json has a resolvable prompt:
 * - C3L path components (c2, c3) are non-empty strings
 * - C3L path components are consistent with stepId
 *
 * Responsibility: Verify prompt resolution feasibility (no I/O)
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate prompt resolution for all steps in a steps registry.
 *
 * Checks per step:
 * 1. c2 and c3 are non-empty strings
 * 2. c2 and c3 are consistent with stepId parts
 *
 * @param registry - Parsed steps_registry.json content
 * @returns Validation result with errors and warnings
 */
export function validatePrompts(
  registry: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const stepsRaw = asRecord(registry.steps) ?? {};

  for (const [stepId, stepDef] of Object.entries(stepsRaw)) {
    const step = asRecord(stepDef);
    if (!step) continue;

    // 1. C3L path components must be non-empty strings
    const c2 = step.c2;
    const c3 = step.c3;

    if (typeof c2 !== "string" || c2 === "") {
      errors.push(
        `steps["${stepId}"].c2 is missing or empty`,
      );
    }

    if (typeof c3 !== "string" || c3 === "") {
      errors.push(
        `steps["${stepId}"].c3 is missing or empty`,
      );
    }

    // 2. C3L path components consistency with stepId
    // stepId format: "c2.c3" (e.g., "initial.issue") or "c2.c3.suffix"
    // (e.g., "initial.project.preparation")
    if (
      typeof c2 === "string" && c2 !== "" && typeof c3 === "string" &&
      c3 !== ""
    ) {
      const parts = stepId.split(".");
      if (parts.length >= 2) {
        const stepIdC2 = parts[0];
        const stepIdC3 = parts[1];
        if (c2 !== stepIdC2) {
          warnings.push(
            `steps["${stepId}"].c2 is "${c2}" but stepId prefix is "${stepIdC2}"`,
          );
        }
        if (c3 !== stepIdC3) {
          warnings.push(
            `steps["${stepId}"].c3 is "${c3}" but stepId second part is "${stepIdC3}"`,
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
