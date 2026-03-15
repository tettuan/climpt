/**
 * Flow Reachability Validator
 *
 * Validates the step flow graph for reachability and completeness:
 * - All non-section steps must be reachable from entry points (warning if not)
 * - At least one closure step must be reachable from entry points (error if not)
 * - Transition keys must be valid intents (warning if not)
 *
 * @module
 */

import type { ValidationResult } from "../src_common/types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The fixed set of valid intent names used in transition keys.
 */
const VALID_INTENTS: ReadonlySet<string> = new Set([
  "next",
  "repeat",
  "jump",
  "handoff",
  "closing",
  "escalate",
  "abort",
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

/**
 * Extract all transition target step IDs from a single step definition.
 * Collects `target`, `fallback`, and conditional `targets` values.
 */
function collectTransitionTargets(
  stepDef: Record<string, unknown>,
): string[] {
  const targets: string[] = [];
  const transitions = asRecord(stepDef.transitions);
  if (!transitions) return targets;

  for (const rule of Object.values(transitions)) {
    const ruleObj = asRecord(rule);
    if (!ruleObj) continue;

    // Direct target
    if ("target" in ruleObj) {
      const target = ruleObj.target;
      if (target !== null && typeof target === "string") {
        targets.push(target);
      }
    }

    // Fallback target
    if ("fallback" in ruleObj) {
      const fallback = ruleObj.fallback;
      if (fallback !== null && typeof fallback === "string") {
        targets.push(fallback);
      }
    }

    // Conditional targets
    if ("targets" in ruleObj) {
      const condTargets = asRecord(ruleObj.targets);
      if (condTargets) {
        for (const condTarget of Object.values(condTargets)) {
          if (condTarget !== null && typeof condTarget === "string") {
            targets.push(condTarget);
          }
        }
      }
    }
  }

  return targets;
}

/**
 * Extract the c2 field from a step definition, if present and a string.
 */
function getC2(stepDef: Record<string, unknown>): string | undefined {
  const c2 = stepDef.c2;
  return typeof c2 === "string" ? c2 : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate flow reachability within a steps_registry.json document.
 *
 * Performs BFS from all entry points and checks:
 * 1. Orphan steps (non-section steps unreachable from any entry) -> warnings
 * 2. Closure reachability (at least one closure step reachable) -> error
 * 3. Transition key validity (keys must be valid intents) -> warnings
 *
 * @param registry - Parsed steps_registry.json content
 * @returns Validation result with errors and warnings
 */
export function validateFlowReachability(
  registry: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const stepsRaw = asRecord(registry.steps) ?? {};

  // -----------------------------------------------------------------------
  // 1. Build adjacency list and collect step metadata
  // -----------------------------------------------------------------------

  /** stepId -> list of target stepIds */
  const adjacency = new Map<string, string[]>();
  /** stepId -> c2 value */
  const stepC2 = new Map<string, string | undefined>();

  for (const [stepId, stepDef] of Object.entries(stepsRaw)) {
    const step = asRecord(stepDef);
    if (!step) continue;

    stepC2.set(stepId, getC2(step));
    adjacency.set(stepId, collectTransitionTargets(step));
  }

  const allStepIds = new Set(adjacency.keys());

  // -----------------------------------------------------------------------
  // 2. Collect entry points from entryStepMapping
  // -----------------------------------------------------------------------

  const entryPoints = new Set<string>();
  const entryStepMapping = asRecord(registry.entryStepMapping);
  if (entryStepMapping) {
    for (const target of Object.values(entryStepMapping)) {
      if (typeof target === "string" && allStepIds.has(target)) {
        entryPoints.add(target);
      }
    }
  }

  // Also check entryStep (singular) as entry point
  const entryStep = registry.entryStep;
  if (typeof entryStep === "string" && allStepIds.has(entryStep)) {
    entryPoints.add(entryStep);
  }

  // -----------------------------------------------------------------------
  // 3. BFS from all entry points
  // -----------------------------------------------------------------------

  const visited = new Set<string>();
  const queue: string[] = [...entryPoints];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adjacency.get(current);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor) && allStepIds.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  // -----------------------------------------------------------------------
  // 4. Check results
  // -----------------------------------------------------------------------

  // 4a. Orphan steps: non-section steps not reachable from any entry
  const orphanSteps: string[] = [];
  for (const stepId of allStepIds) {
    if (visited.has(stepId)) continue;
    const c2 = stepC2.get(stepId);
    // Section steps are referenced via prompt injection, not transitions
    if (c2 === "section") continue;
    orphanSteps.push(stepId);
  }

  if (orphanSteps.length > 0) {
    orphanSteps.sort();
    warnings.push(
      `Orphan steps not reachable from any entry point: ${
        orphanSteps.join(", ")
      }`,
    );
  }

  // 4b. Closure reachability: at least one closure step must be reachable
  let closureReachable = false;
  for (const stepId of visited) {
    if (stepC2.get(stepId) === "closure") {
      closureReachable = true;
      break;
    }
  }

  if (!closureReachable) {
    errors.push(
      "No closure step is reachable from entry points",
    );
  }

  // -----------------------------------------------------------------------
  // 5. Transition key validity
  // -----------------------------------------------------------------------

  for (const [stepId, stepDef] of Object.entries(stepsRaw)) {
    const step = asRecord(stepDef);
    if (!step) continue;

    const transitions = asRecord(step.transitions);
    if (!transitions) continue;

    for (const key of Object.keys(transitions)) {
      if (!VALID_INTENTS.has(key)) {
        warnings.push(
          `steps["${stepId}"].transitions has unknown intent key "${key}"`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
