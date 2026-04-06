/**
 * UV Variable Reachability Validator
 *
 * Validates that each step's declared uvVariables have a known supply source
 * across all four UV Channels:
 *
 * - Channel 1: CLI parameters (from agent.json parameters)
 * - Channel 2: Runner runtime variables (iteration, completed_iterations, etc.)
 * - Channel 3: VerdictHandler variables (max_iterations, remaining, etc.)
 * - Channel 4: Step handoff via inputs (InputSpec, stepId_key namespace)
 *
 * A UV variable with no identified supply source from any channel gets a
 * warning. Optional CLI parameters without defaults are also flagged.
 *
 * Additionally validates prefix substitution consistency:
 * - For each initial.X step, checks that a corresponding continuation.X exists
 * - If both exist, compares their uvVariables declarations and warns on mismatch
 *
 * Responsibility: Static UV supply analysis (no I/O)
 * Side effects: None
 *
 * @module
 */

import type { ValidationResult } from "../src_common/types.ts";
import { RUNTIME_SUPPLIED_UV_VARS } from "../shared/constants.ts";
import type { InputSpec } from "../src_common/contracts.ts";

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
// Prefix substitution constants
// ---------------------------------------------------------------------------

const INITIAL_PREFIX = "initial.";
const CONTINUATION_PREFIX = "continuation.";

// ---------------------------------------------------------------------------
// Internal: prefix substitution consistency
// ---------------------------------------------------------------------------

/**
 * Extract string-typed uvVariables from a step definition.
 * Returns a sorted array (for deterministic comparison) or null if absent.
 */
function extractUvVariables(
  stepDef: Record<string, unknown>,
): string[] | null {
  const uv = stepDef.uvVariables;
  if (!Array.isArray(uv)) return null;
  return uv
    .filter((v): v is string => typeof v === "string")
    .slice()
    .sort();
}

/**
 * Check prefix substitution consistency between initial.* and continuation.* steps.
 *
 * For each initial.X step:
 * - If continuation.X is missing, emit a warning (default transition will fail)
 * - If both exist, compare uvVariables and warn on mismatch
 *
 * These are warnings (not errors) because not all agents use count:iteration
 * and some may have explicit transitions that bypass continuation steps.
 */
function validatePrefixSubstitutionConsistency(
  stepsRaw: Record<string, unknown>,
): string[] {
  const warnings: string[] = [];
  const stepIds = new Set(Object.keys(stepsRaw));

  for (const stepId of stepIds) {
    if (!stepId.startsWith(INITIAL_PREFIX)) continue;

    const suffix = stepId.slice(INITIAL_PREFIX.length);
    const continuationId = `${CONTINUATION_PREFIX}${suffix}`;

    const initialStep = asRecord(stepsRaw[stepId]);
    if (!initialStep) continue;

    if (!stepIds.has(continuationId)) {
      // continuation.X is missing
      warnings.push(
        `steps["${stepId}"] exists but steps["${continuationId}"] is missing. ` +
          `Default transition will fail if no explicit transition is configured.`,
      );
      continue;
    }

    const continuationStep = asRecord(stepsRaw[continuationId]);
    if (!continuationStep) continue;

    const initialUv = extractUvVariables(initialStep);
    const continuationUv = extractUvVariables(continuationStep);

    // Both null or both empty - no mismatch
    if (initialUv === null && continuationUv === null) continue;

    const initialStr = JSON.stringify(initialUv ?? []);
    const continuationStr = JSON.stringify(continuationUv ?? []);

    if (initialStr !== continuationStr) {
      warnings.push(
        `steps["${stepId}"] declares uvVariables ${initialStr} but ` +
          `steps["${continuationId}"] declares ${continuationStr}. ` +
          `Prefix substitution (initial.* -> continuation.*) may cause UV variable mismatch at runtime.`,
      );
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive the set of UV variable names that a step's inputs would produce
 * via Channel 4 (StepContext.toUV).
 *
 * The naming convention is: `stepId_key` where dots in stepId are replaced
 * with underscores.  Example: `initial.issue` + key `number` → `initial_issue_number`.
 *
 * This is a best-effort static analysis — full runtime resolution is in P3-1.
 */
function deriveChannel4UvNames(inputs: InputSpec): Set<string> {
  const names = new Set<string>();
  for (const [_varName, spec] of Object.entries(inputs)) {
    if (!spec.from || typeof spec.from !== "string") continue;
    const dotPos = spec.from.lastIndexOf(".");
    if (dotPos <= 0) continue;
    const stepId = spec.from.substring(0, dotPos);
    const key = spec.from.substring(dotPos + 1);
    const uvKey = stepId.replace(/\./g, "_") + "_" + key;
    names.add(uvKey);
  }
  return names;
}

/**
 * Validate UV variable reachability for all steps in a steps registry.
 *
 * Checks per step:
 * 1. Channel 1 — If a uvVariable matches a CLI parameter, validate its
 *    optionality / default
 * 2. Channel 2/3 — If the variable is in RUNTIME_SUPPLIED_UV_VARS, it is
 *    supplied at runtime → no warning
 * 3. Channel 4 — If the step has `inputs` and the variable matches a
 *    derived input UV name, it is supplied via handoff → no warning
 * 4. If none of the above channels supply the variable, emit a warning
 * 5. initial.* / continuation.* prefix substitution consistency
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

    // Pre-compute Channel 4 UV names for this step (if inputs exist)
    const inputsRaw = asRecord(step.inputs);
    const channel4Names: Set<string> = inputsRaw
      ? deriveChannel4UvNames(inputsRaw as InputSpec)
      : new Set();

    for (const varEntry of uvVariables) {
      const varName = typeof varEntry === "string" ? varEntry : null;
      if (varName === null) continue;

      // Channel 1: CLI parameters
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

      // Channel 2/3: Runtime-supplied variables
      if (RUNTIME_SUPPLIED_UV_VARS.has(varName)) {
        continue;
      }

      // Channel 4: Step handoff via inputs
      if (channel4Names.has(varName)) {
        continue;
      }

      // No identified supply source from any channel
      warnings.push(
        `Step "${stepId}": uvVariable "${varName}" has no identified supply source (not a CLI parameter, not a runtime variable, not an input handoff).`,
      );
    }
  }

  // Prefix substitution consistency (initial.* vs continuation.*)
  const prefixWarnings = validatePrefixSubstitutionConsistency(stepsRaw);
  warnings.push(...prefixWarnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
