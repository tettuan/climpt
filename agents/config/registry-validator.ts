/**
 * Registry Validator - Cross-Reference Validation for steps_registry.json
 *
 * Validates internal consistency of a steps registry:
 * - entryStepMapping values reference existing steps
 * - transition targets reference existing steps
 * - preflightConditions / postLLMConditions reference existing validators
 * - Validator `phase` matches the conditions slot that references it
 * - validators reference existing failurePatterns
 * - conditional transition targets reference existing steps
 *
 * @module
 */

import {
  type Decision,
  decisionFromLegacyMapped,
  type ValidationErrorCode,
} from "../shared/validation/mod.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CrossRefResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Safely get an object property or return undefined. */
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
 * Validate cross-references within a steps_registry.json document.
 *
 * @param registry - Parsed steps_registry.json content
 * @returns Cross-reference validation result
 */
export function validateCrossReferences(
  registry: Record<string, unknown>,
): CrossRefResult {
  const errors: string[] = [];

  const steps = asRecord(registry.steps) ?? {};
  const stepKeys = new Set(Object.keys(steps));
  const validators = asRecord(registry.validators) ?? {};
  const validatorKeys = new Set(Object.keys(validators));
  const failurePatterns = asRecord(registry.failurePatterns) ?? {};
  const failurePatternKeys = new Set(Object.keys(failurePatterns));
  const validationSteps = asRecord(registry.validationSteps) ?? {};

  // 1. entryStepMapping values must be { initial, continuation } objects
  //    whose step ids both exist in steps. The legacy string form is rejected.
  const entryStepMapping = asRecord(registry.entryStepMapping);
  if (entryStepMapping) {
    for (const [mode, value] of Object.entries(entryStepMapping)) {
      const pair = asRecord(value);
      if (!pair) {
        errors.push(
          `entryStepMapping["${mode}"] must be an object { initial, continuation }; got ${typeof value}`,
        );
        continue;
      }
      const initial = pair.initial;
      const continuation = pair.continuation;
      if (typeof initial !== "string" || initial.length === 0) {
        errors.push(
          `entryStepMapping["${mode}"].initial must be a non-empty string`,
        );
      } else if (!stepKeys.has(initial)) {
        errors.push(
          `entryStepMapping["${mode}"].initial references unknown step "${initial}"`,
        );
      }
      if (typeof continuation !== "string" || continuation.length === 0) {
        errors.push(
          `entryStepMapping["${mode}"].continuation must be a non-empty string`,
        );
      } else if (!stepKeys.has(continuation)) {
        errors.push(
          `entryStepMapping["${mode}"].continuation references unknown step "${continuation}"`,
        );
      }
    }
  }

  // 2. transitions.*.target must exist in steps (null is OK = terminal)
  for (const [stepId, stepDef] of Object.entries(steps)) {
    const step = asRecord(stepDef);
    if (!step) continue;

    const transitions = asRecord(step.transitions);
    if (!transitions) continue;

    for (const [intent, rule] of Object.entries(transitions)) {
      const ruleObj = asRecord(rule);
      if (!ruleObj) continue;

      // Direct target
      if ("target" in ruleObj) {
        const target = ruleObj.target;
        if (
          target !== null && typeof target === "string" && !stepKeys.has(target)
        ) {
          errors.push(
            `steps["${stepId}"].transitions["${intent}"].target references unknown step "${target}"`,
          );
        }
        // Also check fallback if present
        if ("fallback" in ruleObj) {
          const fallback = ruleObj.fallback;
          if (
            fallback !== null && typeof fallback === "string" &&
            !stepKeys.has(fallback)
          ) {
            errors.push(
              `steps["${stepId}"].transitions["${intent}"].fallback references unknown step "${fallback}"`,
            );
          }
        }
      }

      // 5. Conditional transitions: targets values must exist in steps
      if ("targets" in ruleObj) {
        const targets = asRecord(ruleObj.targets);
        if (targets) {
          for (const [condValue, condTarget] of Object.entries(targets)) {
            if (
              condTarget !== null &&
              typeof condTarget === "string" &&
              !stepKeys.has(condTarget)
            ) {
              errors.push(
                `steps["${stepId}"].transitions["${intent}"].targets["${condValue}"] references unknown step "${condTarget}"`,
              );
            }
          }
        }
      }
    }
  }

  // 3. preflightConditions / postLLMConditions: validator ref must exist
  //    AND validator.phase must match the slot it is wired into.
  const EXPECTED_PHASE: Record<string, "preflight" | "postllm"> = {
    preflightConditions: "preflight",
    postLLMConditions: "postllm",
  };

  for (const [vsId, vsDef] of Object.entries(validationSteps)) {
    const vs = asRecord(vsDef);
    if (!vs) continue;

    // Reject legacy field explicitly — no backward compat
    if ("validationConditions" in vs) {
      errors.push(
        `validationSteps["${vsId}"] uses removed field "validationConditions"; split into "preflightConditions" and "postLLMConditions"`,
      );
    }

    for (const slot of ["preflightConditions", "postLLMConditions"] as const) {
      const conditions = vs[slot];
      if (!Array.isArray(conditions)) {
        errors.push(
          `validationSteps["${vsId}"].${slot} must be an array (empty is allowed)`,
        );
        continue;
      }

      for (let i = 0; i < conditions.length; i++) {
        const cond = asRecord(conditions[i]);
        if (!cond) continue;

        const validatorName = cond.validator;
        if (typeof validatorName !== "string") continue;

        if (!validatorKeys.has(validatorName)) {
          errors.push(
            `validationSteps["${vsId}"].${slot}[${i}].validator references unknown validator "${validatorName}"`,
          );
          continue;
        }

        // Phase mismatch check
        const validatorDef = asRecord(validators[validatorName]);
        const declaredPhase = validatorDef?.phase;
        const expectedPhase = EXPECTED_PHASE[slot];
        if (typeof declaredPhase !== "string") {
          errors.push(
            `validators["${validatorName}"] is wired into ${slot} but declares no "phase" field; phase "${expectedPhase}" is required`,
          );
        } else if (declaredPhase !== expectedPhase) {
          errors.push(
            `validators["${validatorName}"].phase is "${declaredPhase}" but is wired into ${slot} (expects "${expectedPhase}")`,
          );
        }
      }
    }
  }

  // 4. validators.*.failurePattern must exist in failurePatterns
  for (const [vId, vDef] of Object.entries(validators)) {
    const v = asRecord(vDef);
    if (!v) continue;

    const fp = v.failurePattern;
    if (typeof fp === "string" && !failurePatternKeys.has(fp)) {
      errors.push(
        `validators["${vId}"].failurePattern references unknown failurePattern "${fp}"`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Per-message rule-code mapper for the cross-reference validator.
 *
 * Covers **S1** (stepId unique implicit), **S2** (transition target /
 * entryStepMapping target valid — dominant), **S7** (validators ↔
 * failurePatterns refs), and **S8** (entryStepMapping target valid).
 *
 * TODO[T2.2]: split into native per-rule Decision-shaped sub-validators.
 */
function mapCrossRefMessageToRule(
  message: string,
): ValidationErrorCode | undefined {
  if (message.includes("entryStepMapping")) return "S8";
  if (message.includes("failurePattern")) return "S7";
  if (
    message.includes("references unknown step") ||
    message.includes("references unknown validator") ||
    message.includes(".target") ||
    message.includes(".fallback") ||
    message.includes(".targets[")
  ) {
    return "S2";
  }
  return undefined;
}

/**
 * Decision-shaped sibling of {@link validateCrossReferences}.
 */
export function validateCrossReferencesAsDecision(
  registry: Record<string, unknown>,
): Decision<void> {
  const result = validateCrossReferences(registry);
  return decisionFromLegacyMapped(
    { valid: result.valid, errors: result.errors },
    mapCrossRefMessageToRule,
    "S2",
    "steps_registry.json",
  );
}
