/**
 * Registry Validator - Cross-Reference Validation for steps_registry.json
 *
 * Validates cross-references within a steps registry:
 * - transition targets reference existing steps
 * - validationConditions reference existing validators
 * - validators reference existing failurePatterns
 * - conditional transition targets reference existing steps
 *
 * Note: entryStepMapping validation is handled at load time by
 * common/step-registry/validator.ts:validateEntryStepMapping() (typed, throws)
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

  // entryStepMapping: validated at load time by
  // common/step-registry/validator.ts:validateEntryStepMapping() (typed, throws)

  // 1. transitions.*.target must exist in steps (null is OK = terminal)
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

  // 2. validationConditions[].validator must exist in validators
  for (const [vsId, vsDef] of Object.entries(validationSteps)) {
    const vs = asRecord(vsDef);
    if (!vs) continue;

    const conditions = vs.validationConditions;
    if (!Array.isArray(conditions)) continue;

    for (let i = 0; i < conditions.length; i++) {
      const cond = asRecord(conditions[i]);
      if (!cond) continue;

      const validatorName = cond.validator;
      if (
        typeof validatorName === "string" &&
        !validatorKeys.has(validatorName)
      ) {
        errors.push(
          `validationSteps["${vsId}"].validationConditions[${i}].validator references unknown validator "${validatorName}"`,
        );
      }
    }
  }

  // 3. validators.*.failurePattern must exist in failurePatterns
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
