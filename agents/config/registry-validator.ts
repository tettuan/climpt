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

  // 1. entryStepMapping values must exist in steps
  const entryStepMapping = asRecord(registry.entryStepMapping);
  if (entryStepMapping) {
    for (const [mode, target] of Object.entries(entryStepMapping)) {
      if (typeof target === "string" && !stepKeys.has(target)) {
        errors.push(
          `entryStepMapping["${mode}"] references unknown step "${target}"`,
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
