/**
 * UV Variable Reachability Validator
 *
 * Validates that each step's declared uvVariables have a known supply source:
 * - CLI parameters (from agent.json parameters)
 * - Runtime variables (iteration, completed_iterations, completion_keyword)
 *
 * Variables not matching either source are flagged as errors.
 * Optional CLI parameters without defaults are flagged as warnings.
 *
 * Responsibility: Static UV supply analysis (no I/O)
 * Side effects: None
 *
 * @module
 */

import type { ValidationResult } from "../src_common/types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Runtime variables supplied by the runner at execution time.
 * See runner.ts buildUvVariables() for the authoritative source.
 */
const RUNTIME_VARIABLES: ReadonlySet<string> = new Set([
  "iteration",
  "completed_iterations",
  "completion_keyword",
]);

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
 * Validate UV variable reachability for all steps in a steps registry.
 *
 * Checks per step:
 * 1. Each declared uvVariable has a supply source (runtime or CLI parameter)
 * 2. CLI-sourced variables with optional parameters and no default produce warnings
 *
 * @param registry - Parsed steps_registry.json content
 * @param agentDef - Parsed agent.json content
 * @returns Validation result with errors and warnings
 */
export function validateUvReachability(
  registry: Record<string, unknown>,
  agentDef: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const stepsRaw = asRecord(registry.steps) ?? {};
  const parametersRaw = asRecord(agentDef.parameters) ?? {};
  const parameterKeys = new Set(Object.keys(parametersRaw));

  for (const [stepId, stepDef] of Object.entries(stepsRaw)) {
    const step = asRecord(stepDef);
    if (!step) continue;

    const uvVariables = step.uvVariables;
    if (!Array.isArray(uvVariables) || uvVariables.length === 0) continue;

    for (const varEntry of uvVariables) {
      const varName = typeof varEntry === "string" ? varEntry : null;
      if (varName === null) continue;

      // Runtime variable - always available
      if (RUNTIME_VARIABLES.has(varName)) continue;

      // CLI parameter - check existence and optionality
      if (parameterKeys.has(varName)) {
        const paramDef = asRecord(parametersRaw[varName]);
        if (paramDef) {
          const isRequired = paramDef.required === true;
          const hasDefault = "default" in paramDef;
          if (!isRequired && !hasDefault) {
            warnings.push(
              `Step "${stepId}": UV variable "${varName}" maps to optional CLI parameter with no default value.`,
            );
          }
        }
        continue;
      }

      // No known source
      errors.push(
        `Step "${stepId}": UV variable "${varName}" has no supply source. Not in CLI parameters (agent.json) or runtime variables.`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
