/**
 * UV Variable Reachability Validator
 *
 * Validates that each step's declared uvVariables have a known supply source
 * via CLI parameters (Channel 1 --from agent.json parameters).
 *
 * Variables not found in CLI parameters are silently skipped --they are
 * assumed to be runtime-supplied and are not the validator's concern.
 *
 * Optional CLI parameters without defaults are flagged as warnings.
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
 * Validate UV variable reachability for all steps in a steps registry.
 *
 * Checks per step:
 * 1. If a uvVariable matches a CLI parameter, validate its optionality/default
 * 2. Variables not in CLI parameters are silently skipped (runtime-supplied)
 * 3. initial.* / continuation.* prefix substitution consistency
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

      // Only check Channel 1 (CLI parameters).
      // Variables not in params are assumed runtime-supplied --skip silently.
      if (!parameterKeys.has(varName)) continue;

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
