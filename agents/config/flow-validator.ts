/**
 * Flow Reachability Validator
 *
 * Validates the step flow graph for reachability and completeness:
 * - All non-section steps must be reachable from entry points (warning if not)
 * - At least one closure step must be reachable from entry points (error if not)
 * - Transition keys must be valid intents (warning if not)
 * - Transition keys must match stepKind allowed intents (error if not)
 * - allowedIntents and transitions must be consistent (error/warning)
 * - escalate is restricted to verification steps (error if not)
 * - initial steps should not use handoff (warning)
 * - Dangling transition targets must not reference non-existent steps (error)
 * - Each entry point must independently reach at least one closure step (error)
 * - Orphan flow steps with structuredGate escalate to errors
 * - StepKind boundary crossing validation (error)
 * - Self-loop via 'next' intent (warning; use 'repeat' for retry patterns)
 * - Strongly connected components with no path to closure (error)
 *
 * @module
 */

import type { ValidationResult } from "../src_common/types.ts";
import type { StepKind } from "../common/step-registry/types.ts";
import { STEP_KIND_ALLOWED_INTENTS } from "../common/step-registry/types.ts";
import {
  type Decision,
  decisionFromLegacyMapped,
  type ValidationErrorCode,
} from "../shared/validation/mod.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The fixed set of valid intent names used in transition keys.
 *
 * Frozen 6-value ADT per design 14 §E. Mirrors `GateIntent` in
 * `agents/common/step-registry/types.ts`.
 */
const VALID_INTENTS: ReadonlySet<string> = new Set([
  "next",
  "repeat",
  "jump",
  "handoff",
  "closing",
  "escalate",
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
 * Structured transition detail: intent key mapped to its target(s).
 * Each entry represents one transition rule with all its possible targets.
 */
interface TransitionDetail {
  intent: string;
  /** Direct target (may be null for terminal transitions) */
  target: string | null;
  /** Fallback target (if any) */
  fallback: string | null;
  /** Conditional targets: conditionValue -> target (if any) */
  conditionalTargets: Array<{ conditionValue: string; target: string | null }>;
}

/**
 * Extract structured transition details from a step definition.
 * Returns per-intent target information for dangling-target and boundary checks.
 */
function collectTransitionDetails(
  stepDef: Record<string, unknown>,
): TransitionDetail[] {
  const details: TransitionDetail[] = [];
  const transitions = asRecord(stepDef.transitions);
  if (!transitions) return details;

  for (const [intent, rule] of Object.entries(transitions)) {
    const ruleObj = asRecord(rule);
    if (!ruleObj) continue;

    const detail: TransitionDetail = {
      intent,
      target: null,
      fallback: null,
      conditionalTargets: [],
    };

    // Direct target
    if ("target" in ruleObj) {
      const t = ruleObj.target;
      detail.target = (t !== null && typeof t === "string") ? t : null;
    }

    // Fallback
    if ("fallback" in ruleObj) {
      const f = ruleObj.fallback;
      detail.fallback = (f !== null && typeof f === "string") ? f : null;
    }

    // Conditional targets
    if ("targets" in ruleObj) {
      const condTargets = asRecord(ruleObj.targets);
      if (condTargets) {
        for (const [condValue, condTarget] of Object.entries(condTargets)) {
          detail.conditionalTargets.push({
            conditionValue: condValue,
            target: (condTarget !== null && typeof condTarget === "string")
              ? condTarget
              : null,
          });
        }
      }
    }

    details.push(detail);
  }

  return details;
}

/**
 * Extract the `address.c2` field from a step definition, if present.
 *
 * Reads the post-T7 ADT shape: `Step.address.c2` (see
 * `agents/common/step-registry/types.ts` §C3LAddress). Non-flow steps
 * (e.g., `section`) and malformed records return `undefined`.
 */
function getC2(stepDef: Record<string, unknown>): string | undefined {
  const address = asRecord(stepDef.address);
  if (!address) return undefined;
  const c2 = address.c2;
  return typeof c2 === "string" ? c2 : undefined;
}

/**
 * Read the explicit `kind` discriminator from a step definition.
 *
 * Per design 14 §B and the post-T7 ADT (`Step.kind` in
 * `agents/common/step-registry/types.ts`), `kind` is mandatory and is the
 * sole source of truth for step taxonomy — no inference from `c2` is
 * permitted. Non-flow steps (e.g., `section`) carry no `kind` and return
 * `undefined`.
 */
function inferStepKindFromDef(
  stepDef: Record<string, unknown>,
): StepKind | undefined {
  const kind = stepDef.kind;
  if (
    typeof kind === "string" &&
    (kind === "work" || kind === "verification" || kind === "closure")
  ) {
    return kind as StepKind;
  }
  return undefined;
}

/**
 * Extract `structuredGate.allowedIntents` from a step definition.
 */
function getAllowedIntents(
  stepDef: Record<string, unknown>,
): string[] | undefined {
  const gate = asRecord(stepDef.structuredGate);
  if (!gate) return undefined;
  const intents = gate.allowedIntents;
  if (Array.isArray(intents)) {
    return intents.filter((v): v is string => typeof v === "string");
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate flow reachability within a steps_registry.json document.
 *
 * Performs BFS from all entry points and checks:
 * 1. Orphan steps (non-section steps unreachable from any entry) -> warnings/errors
 * 2. Closure reachability (per-entry-point closure path) -> error
 * 3. Transition key validity (keys must be valid intents) -> warnings
 * 4. stepKind-aware transition validation -> errors
 * 5. allowedIntents ↔ transitions cross-validation -> errors/warnings
 * 6. escalate restricted to verification steps -> errors
 * 7. initial step handoff warning -> warnings
 * 8. Dangling transition targets -> errors
 * 9. Per-entry-point closure reachability -> errors
 * 10. Orphan severity escalation (structuredGate) -> errors
 * 11. StepKind boundary crossing validation -> errors
 * 12. Self-loop via 'next' intent -> warnings
 * 13. Cycle (SCC) without closure path -> errors
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
  // P2-2: Dangling target detection
  // -----------------------------------------------------------------------

  /** stepId -> structured transition details (for P2-2 and P2-3) */
  const stepTransitionDetails = new Map<string, TransitionDetail[]>();

  for (const [stepId, stepDef] of Object.entries(stepsRaw)) {
    const step = asRecord(stepDef);
    if (!step) continue;

    const details = collectTransitionDetails(step);
    stepTransitionDetails.set(stepId, details);

    for (const detail of details) {
      // Check direct target
      if (
        detail.target !== null && !allStepIds.has(detail.target)
      ) {
        errors.push(
          `Step '${stepId}': transition '${detail.intent}' targets '${detail.target}' which does not exist in steps`,
        );
      }

      // Check fallback target
      if (
        detail.fallback !== null && !allStepIds.has(detail.fallback)
      ) {
        errors.push(
          `Step '${stepId}': transition '${detail.intent}' targets '${detail.fallback}' which does not exist in steps`,
        );
      }

      // Check conditional targets
      for (const cond of detail.conditionalTargets) {
        if (
          cond.target !== null && !allStepIds.has(cond.target)
        ) {
          errors.push(
            `Step '${stepId}': transition '${detail.intent}' targets '${cond.target}' which does not exist in steps`,
          );
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // 2. Collect entry points from entryStepMapping (with key tracking)
  // -----------------------------------------------------------------------

  /** entryKey -> stepId mapping for per-entry-point checks */
  const entryPointMap = new Map<string, string>();
  const entryPoints = new Set<string>();
  const entryStepMapping = asRecord(registry.entryStepMapping);
  if (entryStepMapping) {
    for (const [entryKey, value] of Object.entries(entryStepMapping)) {
      const pair = asRecord(value);
      if (!pair) continue;
      const initial = pair.initial;
      const continuation = pair.continuation;
      if (typeof initial === "string" && allStepIds.has(initial)) {
        entryPointMap.set(`${entryKey}.initial`, initial);
        entryPoints.add(initial);
      }
      if (typeof continuation === "string" && allStepIds.has(continuation)) {
        entryPointMap.set(`${entryKey}.continuation`, continuation);
        entryPoints.add(continuation);
      }
    }
  }

  // Also check entryStep (singular) as entry point
  const entryStep = registry.entryStep;
  if (typeof entryStep === "string" && allStepIds.has(entryStep)) {
    entryPointMap.set("__entryStep__", entryStep);
    entryPoints.add(entryStep);
  }

  // -----------------------------------------------------------------------
  // 3. BFS from all entry points (merged for orphan detection)
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
  // P2-1: Per-entry-point closure reachability
  // -----------------------------------------------------------------------

  for (const [entryKey, stepId] of entryPointMap) {
    const perEntryVisited = new Set<string>();
    const perEntryQueue: string[] = [stepId];

    while (perEntryQueue.length > 0) {
      const current = perEntryQueue.shift();
      if (current === undefined) break;
      if (perEntryVisited.has(current)) continue;
      perEntryVisited.add(current);

      const neighbors = adjacency.get(current);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (!perEntryVisited.has(neighbor) && allStepIds.has(neighbor)) {
          perEntryQueue.push(neighbor);
        }
      }
    }

    let entryClosureReachable = false;
    for (const visitedId of perEntryVisited) {
      if (stepC2.get(visitedId) === "closure") {
        entryClosureReachable = true;
        break;
      }
    }

    if (!entryClosureReachable) {
      errors.push(
        `Entry point '${entryKey}' (step '${stepId}') cannot reach any closure step`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // 4. Check results
  // -----------------------------------------------------------------------

  // 4a. Orphan steps: non-section steps not reachable from any entry
  // P2-5: Severity escalation — orphan steps with structuredGate -> error
  const orphanWarningSteps: string[] = [];
  for (const stepId of allStepIds) {
    if (visited.has(stepId)) continue;
    const c2 = stepC2.get(stepId);
    // Section steps are referenced via prompt injection, not transitions
    if (c2 === "section") continue;

    // P2-5: Check if this orphan step has a structuredGate
    const step = asRecord(stepsRaw[stepId]);
    const hasStructuredGate = step !== undefined &&
      asRecord(step.structuredGate) !== undefined;

    if (hasStructuredGate) {
      errors.push(
        `Orphan flow step '${stepId}' has structuredGate but is not reachable from any entry point`,
      );
    } else {
      orphanWarningSteps.push(stepId);
    }
  }

  if (orphanWarningSteps.length > 0) {
    orphanWarningSteps.sort();
    warnings.push(
      `Orphan steps not reachable from any entry point: ${
        orphanWarningSteps.join(", ")
      }`,
    );
  }

  // 4b. Closure reachability: at least one closure step must be reachable
  // (kept as global check for edge cases like empty entry points)
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

  // -----------------------------------------------------------------------
  // 6. Step-level semantic validation (stepKind-aware)
  // -----------------------------------------------------------------------

  for (const [stepId, stepDef] of Object.entries(stepsRaw)) {
    const step = asRecord(stepDef);
    if (!step) continue;

    const kind = inferStepKindFromDef(step);
    // Skip non-flow steps (e.g., section)
    if (!kind) continue;

    const transitionKeys = Object.keys(asRecord(step.transitions) ?? {});
    const allowedForKind = new Set<string>(STEP_KIND_ALLOWED_INTENTS[kind]);
    const declaredIntents = getAllowedIntents(step);
    const c2 = getC2(step);

    // --- P1-1: transition-intent validation against stepKind ---
    for (const key of transitionKeys) {
      if (!allowedForKind.has(key)) {
        errors.push(
          `Step '${stepId}': transition '${key}' is not allowed for stepKind '${kind}' (allowed: ${
            STEP_KIND_ALLOWED_INTENTS[kind].join(", ")
          })`,
        );
      }
    }

    // --- P1-2: allowedIntents ↔ transitions cross-validation ---
    if (declaredIntents) {
      // Each declared intent (except repeat) must have a transition rule.
      // `repeat` is exempt because it self-loops on the same step and never
      // routes to a sibling target.
      for (const intent of declaredIntents) {
        if (intent === "repeat") continue;
        if (!transitionKeys.includes(intent)) {
          errors.push(
            `Step '${stepId}': allowedIntents includes '${intent}' but no transition rule is defined for it`,
          );
        }
      }

      // Each transition key not in allowedIntents is a dead transition
      const declaredSet = new Set(declaredIntents);
      for (const key of transitionKeys) {
        if (!declaredSet.has(key)) {
          warnings.push(
            `Step '${stepId}': transition '${key}' defined but not in allowedIntents (dead transition)`,
          );
        }
      }
    }

    // --- P1-3: escalate restricted to verification steps ---
    if (kind !== "verification") {
      if (transitionKeys.includes("escalate")) {
        errors.push(
          `Step '${stepId}': 'escalate' is only valid for verification steps, but stepKind is '${kind}'`,
        );
      }
      if (declaredIntents && declaredIntents.includes("escalate")) {
        errors.push(
          `Step '${stepId}': 'escalate' in allowedIntents is only valid for verification steps, but stepKind is '${kind}'`,
        );
      }
    }

    // --- P1-4: initial step handoff warning ---
    if (c2 === "initial") {
      if (transitionKeys.includes("handoff")) {
        warnings.push(
          `Step '${stepId}': initial steps should not use handoff (design Section 7.3)`,
        );
      }
      if (
        declaredIntents && declaredIntents.includes("handoff") &&
        !transitionKeys.includes("handoff")
      ) {
        warnings.push(
          `Step '${stepId}': initial steps should not use handoff (design Section 7.3)`,
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // P2-3: StepKind boundary crossing validation
  // -----------------------------------------------------------------------

  /** Expected target kinds for each (sourceKind, intent) pair. */
  const BOUNDARY_RULES: Record<
    string,
    Record<string, StepKind[] | null>
  > = {
    work: {
      next: ["work", "verification"],
      jump: ["work", "verification"],
      handoff: ["closure"],
      repeat: null, // self-loop, no cross-kind check
    },
    verification: {
      next: ["work", "verification", "closure"],
      jump: ["work", "verification", "closure"],
      escalate: ["work", "verification"],
      repeat: null,
    },
    closure: {
      repeat: ["work"],
      closing: null, // terminal, target is null
    },
  };

  for (const [stepId, stepDef] of Object.entries(stepsRaw)) {
    const step = asRecord(stepDef);
    if (!step) continue;

    const sourceKind = inferStepKindFromDef(step);
    if (!sourceKind) continue;

    const details = stepTransitionDetails.get(stepId);
    if (!details) continue;

    const kindRules = BOUNDARY_RULES[sourceKind];
    if (!kindRules) continue;

    for (const detail of details) {
      const expectedKinds = kindRules[detail.intent];
      // null means no boundary check for this intent
      if (expectedKinds === undefined || expectedKinds === null) continue;

      // Check all non-null targets for boundary violations
      const targetsToCheck: string[] = [];

      if (detail.target !== null) {
        targetsToCheck.push(detail.target);
      }
      if (detail.fallback !== null) {
        targetsToCheck.push(detail.fallback);
      }
      for (const cond of detail.conditionalTargets) {
        if (cond.target !== null) {
          targetsToCheck.push(cond.target);
        }
      }

      for (const targetId of targetsToCheck) {
        // Skip self-loops (repeat targeting self is always valid)
        if (targetId === stepId) continue;

        // Skip targets that don't exist (already caught by P2-2)
        if (!allStepIds.has(targetId)) continue;

        const targetStep = asRecord(stepsRaw[targetId]);
        if (!targetStep) continue;

        const targetKind = inferStepKindFromDef(targetStep);
        if (!targetKind) continue;

        if (!expectedKinds.includes(targetKind)) {
          errors.push(
            `Step '${stepId}' (${sourceKind}): transition '${detail.intent}' targets '${targetId}' (${targetKind}), but ${detail.intent} from ${sourceKind} steps should target ${
              expectedKinds.join("/")
            }`,
          );
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // P2-4a: Self-loop via 'next' intent warning
  // -----------------------------------------------------------------------

  for (const [stepId, stepDef] of Object.entries(stepsRaw)) {
    const step = asRecord(stepDef);
    if (!step) continue;

    const transitions = asRecord(step.transitions);
    if (!transitions) continue;

    const nextRule = asRecord(transitions.next);
    if (!nextRule) continue;

    const target = nextRule.target;
    if (typeof target === "string" && target === stepId) {
      warnings.push(
        `Step '${stepId}': 'next' transition targets itself (self-loop). Use 'repeat' for retry patterns.`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // P2-4b: Cycle (SCC) without closure path detection (Tarjan's algorithm)
  // -----------------------------------------------------------------------

  // Tarjan's SCC algorithm
  {
    let index = 0;
    const stack: string[] = [];
    const onStack = new Set<string>();
    const indices = new Map<string, number>();
    const lowlinks = new Map<string, number>();
    const sccs: string[][] = [];

    const strongconnect = (v: string): void => {
      indices.set(v, index);
      lowlinks.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      const neighbors = adjacency.get(v) ?? [];
      for (const w of neighbors) {
        // Only consider edges to nodes that exist in the graph
        if (!allStepIds.has(w)) continue;

        if (!indices.has(w)) {
          strongconnect(w);
          const vLow = lowlinks.get(v) ?? 0;
          const wLow = lowlinks.get(w) ?? 0;
          lowlinks.set(v, Math.min(vLow, wLow));
        } else if (onStack.has(w)) {
          const vLow = lowlinks.get(v) ?? 0;
          const wIdx = indices.get(w) ?? 0;
          lowlinks.set(v, Math.min(vLow, wIdx));
        }
      }

      // Root of an SCC
      if (lowlinks.get(v) === indices.get(v)) {
        const scc: string[] = [];
        let w: string | undefined;
        do {
          w = stack.pop();
          if (w === undefined) break;
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);
        sccs.push(scc);
      }
    };

    for (const stepId of allStepIds) {
      if (!indices.has(stepId)) {
        strongconnect(stepId);
      }
    }

    // Collect closure step IDs for reachability check
    const closureStepIds = new Set<string>();
    for (const stepId of allStepIds) {
      if (stepC2.get(stepId) === "closure") {
        closureStepIds.add(stepId);
      }
    }

    // For each non-trivial SCC, check if it has a path to closure
    for (const scc of sccs) {
      const sccSet = new Set(scc);

      // Skip trivial SCCs (single node without a self-loop via non-repeat intent)
      if (scc.length === 1) {
        const stepId = scc[0];
        const neighbors = adjacency.get(stepId) ?? [];
        const hasSelfLoop = neighbors.includes(stepId);
        if (!hasSelfLoop) continue;

        // Check if the only self-loops are via 'repeat' (which are by design)
        const details = stepTransitionDetails.get(stepId);
        if (!details) continue;
        const hasNonRepeatSelfLoop = details.some(
          (d) =>
            d.intent !== "repeat" &&
            (d.target === stepId ||
              d.fallback === stepId ||
              d.conditionalTargets.some((c) => c.target === stepId)),
        );
        if (!hasNonRepeatSelfLoop) continue;
      }

      // Check if any node in the SCC has an outgoing edge to a step
      // outside the SCC that can reach a closure step.
      // BFS/DFS from all out-edges of the SCC to see if closure is reachable.
      let canReachClosure = false;

      // If any SCC member is itself a closure step, the SCC reaches closure
      for (const stepId of scc) {
        if (closureStepIds.has(stepId)) {
          canReachClosure = true;
          break;
        }
      }

      if (!canReachClosure) {
        // Collect all outgoing edges from the SCC to nodes outside the SCC
        const frontier: string[] = [];
        for (const stepId of scc) {
          const neighbors = adjacency.get(stepId) ?? [];
          for (const neighbor of neighbors) {
            if (!sccSet.has(neighbor) && allStepIds.has(neighbor)) {
              frontier.push(neighbor);
            }
          }
        }

        // BFS from frontier to check if any closure step is reachable
        const bfsVisited = new Set<string>();
        const bfsQueue = [...frontier];
        while (bfsQueue.length > 0) {
          const current = bfsQueue.shift();
          if (current === undefined) break;
          if (bfsVisited.has(current)) continue;
          bfsVisited.add(current);

          if (closureStepIds.has(current)) {
            canReachClosure = true;
            break;
          }

          const neighbors = adjacency.get(current) ?? [];
          for (const neighbor of neighbors) {
            if (!bfsVisited.has(neighbor) && allStepIds.has(neighbor)) {
              bfsQueue.push(neighbor);
            }
          }
        }
      }

      if (!canReachClosure) {
        const sortedIds = [...scc].sort();
        errors.push(
          `Steps ${sortedIds.join(", ")} form a cycle with no path to closure`,
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

/**
 * Per-message rule-code mapper for the flow validator.
 *
 * The flow validator covers **A3** (reachability), **A4** (boundary
 * crossing), **S2** (dangling target), and **S3** (allowedIntents ↔
 * transitions consistency). This mapper picks the best-fit rule per
 * message; unmatched messages fall back to **A3** (the dominant rule
 * for this validator).
 *
 * TODO[T2.2]: replace with native Decision-shaped sub-validators per
 * rule once `BootKernel.boot` is in place.
 */
function mapFlowMessageToRule(
  message: string,
): ValidationErrorCode | undefined {
  if (message.includes("does not exist in steps")) return "S2";
  if (message.includes("should target")) return "A4";
  if (
    message.includes("not reachable") ||
    message.includes("cannot reach") ||
    message.includes("No closure step") ||
    message.includes("form a cycle")
  ) {
    return "A3";
  }
  if (
    message.includes("allowedIntents") ||
    message.includes("not allowed for stepKind") ||
    message.includes("only valid for verification")
  ) {
    return "S3";
  }
  return undefined;
}

/**
 * Decision-shaped sibling of {@link validateFlowReachability}.
 *
 * Returns a single `Decision<void>` whose Reject errors are tagged
 * per-message with their best-fit rule code (A3 / A4 / S2 / S3).
 */
export function validateFlowReachabilityAsDecision(
  registry: Record<string, unknown>,
): Decision<void> {
  const result = validateFlowReachability(registry);
  return decisionFromLegacyMapped(
    result,
    mapFlowMessageToRule,
    "A3",
    "steps_registry.json",
  );
}
