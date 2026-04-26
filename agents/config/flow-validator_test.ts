/**
 * Tests for agents/config/flow-validator.ts
 *
 * Covers validateFlowReachability() with in-memory registries:
 * - Valid flow, orphan steps, section steps, closure reachability
 * - Transition key validation (valid intents vs unknown)
 * - Multiple entry points, empty registries, real config integration
 */

import { assert, assertEquals } from "@std/assert";
import { validateFlowReachability } from "./flow-validator.ts";
import { STEP_KIND_ALLOWED_INTENTS } from "../common/step-registry/types.ts";

// =============================================================================
// Fixtures
// =============================================================================

/**
 * Minimal valid registry with a linear flow:
 * entry("issue") -> initial.issue -> continuation.issue --(handoff)--> closure.issue
 *
 * Uses handoff for work->closure transition (P2-3 compliant).
 */
function validFlowRegistry(): Record<string, unknown> {
  return {
    agentId: "test",
    version: "1.0.0",
    entryStepMapping: {
      issue: { initial: "initial.issue", continuation: "initial.issue" },
    },
    steps: {
      "initial.issue": {
        stepId: "initial.issue",
        c2: "initial",
        transitions: {
          next: { target: "continuation.issue" },
          repeat: { target: "initial.issue" },
        },
      },
      "continuation.issue": {
        stepId: "continuation.issue",
        c2: "continuation",
        transitions: {
          handoff: { target: "closure.issue" },
          repeat: { target: "continuation.issue" },
        },
      },
      "closure.issue": {
        stepId: "closure.issue",
        c2: "closure",
        transitions: {
          closing: { target: null },
          repeat: { target: "closure.issue" },
        },
      },
    },
  };
}

// =============================================================================
// 1. Valid flow -> valid, no errors
// =============================================================================

Deno.test("flow-validator - valid flow returns valid with no errors", () => {
  const registry = validFlowRegistry();

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

// =============================================================================
// 2. Orphan step -> warning (not error)
// =============================================================================

Deno.test("flow-validator - orphan step produces warning not error", () => {
  const registry = validFlowRegistry();
  const steps = registry.steps as Record<string, Record<string, unknown>>;

  // Add a disconnected step
  steps["orphan.step"] = {
    stepId: "orphan.step",
    c2: "initial",
    transitions: {},
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  const orphanWarning = result.warnings.find((w) => w.includes("orphan.step"));
  assertEquals(orphanWarning !== undefined, true);
});

// =============================================================================
// 3. Section step not flagged as orphan
// =============================================================================

Deno.test("flow-validator - section step is not flagged as orphan", () => {
  const registry = validFlowRegistry();
  const steps = registry.steps as Record<string, Record<string, unknown>>;

  // Add a section step (not connected to transitions)
  steps["section.context"] = {
    stepId: "section.context",
    c2: "section",
    transitions: {},
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, true);
  // No warning should mention section.context
  const sectionWarning = result.warnings.find((w) =>
    w.includes("section.context")
  );
  assertEquals(sectionWarning, undefined);
});

// =============================================================================
// 4. No closure reachable -> error
// =============================================================================

Deno.test("flow-validator - unreachable closure produces error", () => {
  const registry = validFlowRegistry();
  const steps = registry.steps as Record<string, Record<string, unknown>>;

  // Remove the closure step entirely
  delete steps["closure.issue"];

  // Make continuation.issue terminal (no path to closure)
  steps["continuation.issue"] = {
    stepId: "continuation.issue",
    c2: "continuation",
    transitions: {
      next: { target: null },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, false);
  const closureError = result.errors.find((e) => e.includes("closure"));
  assertEquals(closureError !== undefined, true);
});

Deno.test("flow-validator - closure exists but unreachable produces error", () => {
  const registry = validFlowRegistry();
  const steps = registry.steps as Record<string, Record<string, unknown>>;

  // Disconnect continuation from closure -- make it only self-loop
  steps["continuation.issue"] = {
    stepId: "continuation.issue",
    c2: "continuation",
    transitions: {
      next: { target: "continuation.issue" },
      repeat: { target: "continuation.issue" },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, false);
  const closureError = result.errors.find((e) => e.includes("closure"));
  assertEquals(closureError !== undefined, true);
});

// =============================================================================
// 5. Unknown transition key -> warning
// =============================================================================

Deno.test("flow-validator - unknown transition key produces warning and stepKind error", () => {
  const registry = validFlowRegistry();
  const steps = registry.steps as Record<string, Record<string, unknown>>;

  steps["initial.issue"].transitions = {
    next: { target: "continuation.issue" },
    invalid_intent: { target: "continuation.issue" },
  };

  const result = validateFlowReachability(registry);

  // Name-level warning is still produced for unknown intent key
  const intentWarning = result.warnings.find((w) =>
    w.includes("invalid_intent")
  );
  assertEquals(intentWarning !== undefined, true);

  // stepKind-level error is also produced (invalid_intent not in work's allowed intents)
  assertEquals(result.valid, false);
  const kindError = result.errors.find((e) =>
    e.includes("invalid_intent") && e.includes("stepKind")
  );
  assertEquals(kindError !== undefined, true);
});

// =============================================================================
// 6. All 7 valid intents -> no warnings about intents
// =============================================================================

Deno.test("flow-validator - all valid intents produce no unknown-intent warnings", () => {
  // Derive the full intent set from the authoritative source
  const ALL_INTENTS = [
    ...new Set(Object.values(STEP_KIND_ALLOWED_INTENTS).flat()),
  ];

  // Distribute intents to steps with matching stepKinds to avoid stepKind errors.
  // work: next, repeat, jump, handoff
  // verification: next, repeat, jump, escalate
  // closure: closing, repeat
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "step.work", continuation: "step.work" },
    },
    steps: {
      "step.work": {
        stepId: "step.work",
        c2: "continuation",
        transitions: {
          next: { target: "step.verification" },
          repeat: { target: "step.work" },
          jump: { target: "step.verification" },
          handoff: { target: "step.closure" },
        },
      },
      "step.verification": {
        stepId: "step.verification",
        c2: "verification",
        transitions: {
          next: { target: "step.closure" },
          repeat: { target: "step.verification" },
          jump: { target: "step.closure" },
          escalate: { target: "step.work" },
        },
      },
      "step.closure": {
        stepId: "step.closure",
        c2: "closure",
        transitions: {
          closing: { target: null },
          repeat: { target: "step.closure" },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, true);
  // No warnings about unknown intent keys
  const intentWarnings = result.warnings.filter((w) =>
    w.includes("unknown intent")
  );
  assert(
    ALL_INTENTS.length > 0,
    "ALL_INTENTS must be non-empty for filter to be non-vacuous",
  );
  assertEquals(intentWarnings.length, 0);
});

// =============================================================================
// 7. Empty registry (no steps, no entryStepMapping)
// =============================================================================

Deno.test("flow-validator - empty registry reports closure error", () => {
  const registry: Record<string, unknown> = {};

  const result = validateFlowReachability(registry);

  // No steps at all -> BFS visits nothing -> closureReachable=false -> error
  assertEquals(result.valid, false);
  const closureError = result.errors.find((e) => e.includes("closure"));
  assertEquals(closureError !== undefined, true);
});

Deno.test("flow-validator - registry with empty steps reports closure error", () => {
  const registry: Record<string, unknown> = {
    steps: {},
    entryStepMapping: {},
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, false);
  const closureError = result.errors.find((e) => e.includes("closure"));
  assertEquals(closureError !== undefined, true);
});

// =============================================================================
// 8. Multiple entry points -> all reachable
// =============================================================================

Deno.test("flow-validator - multiple entry points reaching different closures", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "initial.issue", continuation: "initial.issue" },
      project: { initial: "initial.project", continuation: "initial.project" },
    },
    steps: {
      "initial.issue": {
        stepId: "initial.issue",
        c2: "initial",
        transitions: {
          handoff: { target: "closure.issue" },
        },
      },
      "closure.issue": {
        stepId: "closure.issue",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
      "initial.project": {
        stepId: "initial.project",
        c2: "initial",
        transitions: {
          handoff: { target: "closure.project" },
        },
      },
      "closure.project": {
        stepId: "closure.project",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

// =============================================================================
// 9. entryStep (singular) as BFS starting point
// =============================================================================

Deno.test("flow-validator - entryStep (singular) reaches closure", () => {
  const registry: Record<string, unknown> = {
    entryStep: "initial.issue",
    steps: {
      "initial.issue": {
        stepId: "initial.issue",
        c2: "initial",
        transitions: {
          handoff: { target: "closure.issue" },
        },
      },
      "closure.issue": {
        stepId: "closure.issue",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("flow-validator - entryStep pointing to non-existent step is skipped", () => {
  const registry: Record<string, unknown> = {
    entryStep: "nonexistent.step",
    steps: {
      "initial.issue": {
        stepId: "initial.issue",
        c2: "initial",
        transitions: {
          handoff: { target: "closure.issue" },
        },
      },
      "closure.issue": {
        stepId: "closure.issue",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  // No entry points -> BFS visits nothing -> closure unreachable -> error
  assertEquals(result.valid, false);
  const closureError = result.errors.find((e) => e.includes("closure"));
  assertEquals(closureError !== undefined, true);
});

// =============================================================================
// 10. Integration test with real iterator registry
// =============================================================================

// =============================================================================
// 11. P1-1: stepKind-aware transition-intent validation
// =============================================================================

Deno.test("flow-validator/P1-1 - work step with closing transition produces error", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.step", continuation: "work.step" },
    },
    steps: {
      "work.step": {
        stepId: "work.step",
        c2: "continuation",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, false);
  const kindError = result.errors.find((e) =>
    e.includes("work.step") && e.includes("closing") &&
    e.includes("stepKind") && e.includes("work")
  );
  assertEquals(
    kindError !== undefined,
    true,
    `Expected error about 'closing' not allowed for work stepKind, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("flow-validator/P1-1 - closure step with next transition produces error", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "close.step", continuation: "close.step" },
    },
    steps: {
      "close.step": {
        stepId: "close.step",
        c2: "closure",
        transitions: {
          next: { target: "close.step" },
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, false);
  const kindError = result.errors.find((e) =>
    e.includes("close.step") && e.includes("next") &&
    e.includes("stepKind") && e.includes("closure")
  );
  assertEquals(
    kindError !== undefined,
    true,
    `Expected error about 'next' not allowed for closure stepKind, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("flow-validator/P1-1 - valid work step with next and repeat produces no stepKind error", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.step", continuation: "work.step" },
    },
    steps: {
      "work.step": {
        stepId: "work.step",
        c2: "initial",
        transitions: {
          next: { target: "work.step2" },
          repeat: { target: "work.step" },
          handoff: { target: "closure.step" },
        },
      },
      "work.step2": {
        stepId: "work.step2",
        c2: "continuation",
        transitions: {
          handoff: { target: "closure.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
          repeat: { target: "closure.step" },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, true);
  // No stepKind errors at all
  const kindErrors = result.errors.filter((e) => e.includes("stepKind"));
  assertEquals(kindErrors.length, 0);
});

Deno.test("flow-validator/P1-1 - valid closure step with closing and repeat produces no stepKind error", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "closure.step", continuation: "closure.step" },
    },
    steps: {
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
          repeat: { target: "closure.step" },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, true);
  const kindErrors = result.errors.filter((e) => e.includes("stepKind"));
  assertEquals(kindErrors.length, 0);
});

// =============================================================================
// 12. P1-2: allowedIntents <-> transitions cross-validation
// =============================================================================

Deno.test("flow-validator/P1-2 - allowedIntents has handoff but no handoff transition produces error", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.step", continuation: "work.step" },
    },
    steps: {
      "work.step": {
        stepId: "work.step",
        c2: "continuation",
        structuredGate: {
          allowedIntents: ["next", "repeat", "handoff"],
          intentSchemaRef: "#/test",
          intentField: "action",
        },
        transitions: {
          next: { target: "work.step" },
          repeat: { target: "work.step" },
          // handoff transition is missing
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, false);
  const missingError = result.errors.find((e) =>
    e.includes("work.step") && e.includes("handoff") &&
    e.includes("allowedIntents") && e.includes("no transition rule")
  );
  assertEquals(
    missingError !== undefined,
    true,
    `Expected error about handoff in allowedIntents without transition, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("flow-validator/P1-2 - transition defined but not in allowedIntents produces dead transition warning", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.step", continuation: "work.step" },
    },
    steps: {
      "work.step": {
        stepId: "work.step",
        c2: "continuation",
        structuredGate: {
          allowedIntents: ["next", "repeat"],
          intentSchemaRef: "#/test",
          intentField: "action",
        },
        transitions: {
          next: { target: "work.step" },
          repeat: { target: "work.step" },
          handoff: { target: "closure.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  // Dead transition is a warning, not an error
  assertEquals(result.valid, true);
  const deadWarning = result.warnings.find((w) =>
    w.includes("work.step") && w.includes("handoff") &&
    w.includes("dead transition")
  );
  assertEquals(
    deadWarning !== undefined,
    true,
    `Expected warning about dead transition 'handoff', got: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

Deno.test("flow-validator/P1-2 - aligned allowedIntents and transitions produce no cross-validation issues", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.step", continuation: "work.step" },
    },
    steps: {
      "work.step": {
        stepId: "work.step",
        c2: "continuation",
        structuredGate: {
          allowedIntents: ["next", "repeat", "handoff"],
          intentSchemaRef: "#/test",
          intentField: "action",
        },
        transitions: {
          next: { target: "work.step" },
          repeat: { target: "work.step" },
          handoff: { target: "closure.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, true);
  // No cross-validation errors
  const crossErrors = result.errors.filter((e) => e.includes("allowedIntents"));
  assertEquals(crossErrors.length, 0);
  // No dead transition warnings
  const deadWarnings = result.warnings.filter((w) =>
    w.includes("dead transition")
  );
  assertEquals(deadWarnings.length, 0);
});

// =============================================================================
// 13. P1-3: escalate restricted to verification steps
// =============================================================================

Deno.test("flow-validator/P1-3 - work step with escalate transition produces error mentioning verification", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.step", continuation: "work.step" },
    },
    steps: {
      "work.step": {
        stepId: "work.step",
        c2: "continuation",
        transitions: {
          handoff: { target: "closure.step" },
          escalate: { target: "work.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, false);
  const escalateError = result.errors.find((e) =>
    e.includes("work.step") && e.includes("escalate") &&
    e.includes("verification")
  );
  assertEquals(
    escalateError !== undefined,
    true,
    `Expected error about escalate being restricted to verification steps, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

// =============================================================================
// 14. P1-4: initial step handoff warning
// =============================================================================

Deno.test("flow-validator/P1-4 - initial step with handoff produces warning mentioning initial", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "init.step", continuation: "init.step" },
    },
    steps: {
      "init.step": {
        stepId: "init.step",
        c2: "initial",
        transitions: {
          next: { target: "init.step" },
          handoff: { target: "closure.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  // handoff on initial is a warning, not an error
  assertEquals(result.valid, true);
  const handoffWarning = result.warnings.find((w) =>
    w.includes("init.step") && w.includes("initial") &&
    w.includes("handoff") && w.includes("Section 7.3")
  );
  assertEquals(
    handoffWarning !== undefined,
    true,
    `Expected warning about handoff on initial step referencing Section 7.3, got: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

// =============================================================================
// 15. Integration test with real iterator registry
// =============================================================================

Deno.test("flow-validator/integration - iterator steps_registry validates without crash", async () => {
  const text = await Deno.readTextFile(".agent/iterator/steps_registry.json");
  const data = JSON.parse(text);

  const result = validateFlowReachability(data);

  // The iterator registry has known issues detected by Wave 3 validation:
  // - P2-5: orphan flow steps with structuredGate (project/issue flows not
  //   connected to entryStepMapping) produce errors
  // - P2-3: closure step repeat self-loops and work handoff to work steps
  //   violate boundary crossing rules
  // These are tracked as known debt; the test validates the validator
  // runs without crash and produces structured output.
  assertEquals(typeof result.valid, "boolean");
  assert(Array.isArray(result.errors));
  assert(Array.isArray(result.warnings));
  // Errors are expected from P2-3 and P2-5 (orphan gated steps)
  assert(
    result.errors.length > 0,
    "Expected errors from P2-3/P2-5 on the real iterator registry",
  );
});

// =============================================================================
// 16. P2-2: Dangling target detection
// =============================================================================

Deno.test("flow-validator/P2-2 - transition target that does not exist produces error", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.step", continuation: "work.step" },
    },
    steps: {
      "work.step": {
        stepId: "work.step",
        c2: "continuation",
        transitions: {
          next: { target: "nonexistent.step" },
          handoff: { target: "closure.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, false);
  const danglingError = result.errors.find((e) =>
    e.includes("nonexistent.step") && e.includes("does not exist")
  );
  assertEquals(
    danglingError !== undefined,
    true,
    `Expected error mentioning 'nonexistent.step' as dangling target, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("flow-validator/P2-2 - all targets exist produces no dangling target error", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.step", continuation: "work.step" },
    },
    steps: {
      "work.step": {
        stepId: "work.step",
        c2: "continuation",
        transitions: {
          next: { target: "work.step" },
          handoff: { target: "closure.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, true);
  const danglingErrors = result.errors.filter((e) =>
    e.includes("does not exist")
  );
  assertEquals(
    danglingErrors.length,
    0,
    `Expected no dangling target errors, got: ${
      JSON.stringify(danglingErrors)
    }`,
  );
});

// =============================================================================
// 17. P2-1: Per-entry-point closure reachability
// =============================================================================

Deno.test("flow-validator/P2-1 - entry point that cannot reach closure produces error", () => {
  // Two entry points: "issue" reaches closure, "project" does not
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.issue", continuation: "work.issue" },
      project: { initial: "work.project", continuation: "work.project" },
    },
    steps: {
      "work.issue": {
        stepId: "work.issue",
        c2: "continuation",
        transitions: {
          handoff: { target: "closure.issue" },
        },
      },
      "closure.issue": {
        stepId: "closure.issue",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
      "work.project": {
        stepId: "work.project",
        c2: "continuation",
        transitions: {
          // Only self-loop, no path to any closure step
          next: { target: "work.project" },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, false);
  const projectError = result.errors.find((e) =>
    e.includes("project") && e.includes("cannot reach any closure")
  );
  assertEquals(
    projectError !== undefined,
    true,
    `Expected error for 'project' entry point not reaching closure, got: ${
      JSON.stringify(result.errors)
    }`,
  );
  // "issue" entry should NOT have a closure reachability error
  const issueError = result.errors.find((e) =>
    e.includes("'issue'") && e.includes("cannot reach any closure")
  );
  assertEquals(
    issueError,
    undefined,
    `'issue' entry reaches closure, should not have error, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("flow-validator/P2-1 - both entry points reach closure produces no per-entry error", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.issue", continuation: "work.issue" },
      project: { initial: "work.project", continuation: "work.project" },
    },
    steps: {
      "work.issue": {
        stepId: "work.issue",
        c2: "continuation",
        transitions: {
          handoff: { target: "closure.shared" },
        },
      },
      "work.project": {
        stepId: "work.project",
        c2: "continuation",
        transitions: {
          handoff: { target: "closure.shared" },
        },
      },
      "closure.shared": {
        stepId: "closure.shared",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, true);
  const closureErrors = result.errors.filter((e) =>
    e.includes("cannot reach any closure")
  );
  assertEquals(
    closureErrors.length,
    0,
    `Expected no per-entry closure errors, got: ${
      JSON.stringify(closureErrors)
    }`,
  );
});

// =============================================================================
// 18. P2-5: Orphan flow-step severity escalation
// =============================================================================

Deno.test("flow-validator/P2-5 - orphan step with structuredGate produces error", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.step", continuation: "work.step" },
    },
    steps: {
      "work.step": {
        stepId: "work.step",
        c2: "continuation",
        transitions: {
          handoff: { target: "closure.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
      // Orphan step with structuredGate -> should be error
      "orphan.gated": {
        stepId: "orphan.gated",
        c2: "continuation",
        structuredGate: {
          allowedIntents: ["next", "repeat"],
          intentSchemaRef: "#/test",
          intentField: "action",
        },
        transitions: {
          next: { target: "orphan.gated" },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, false);
  const orphanError = result.errors.find((e) =>
    e.includes("orphan.gated") && e.includes("structuredGate") &&
    e.includes("not reachable")
  );
  assertEquals(
    orphanError !== undefined,
    true,
    `Expected error for orphan step with structuredGate, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("flow-validator/P2-5 - orphan step without structuredGate produces warning", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.step", continuation: "work.step" },
    },
    steps: {
      "work.step": {
        stepId: "work.step",
        c2: "continuation",
        transitions: {
          handoff: { target: "closure.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
      // Orphan step without structuredGate -> should be warning only
      "orphan.simple": {
        stepId: "orphan.simple",
        c2: "continuation",
        transitions: {},
      },
    },
  };

  const result = validateFlowReachability(registry);

  // Should remain valid (orphan without gate is only a warning)
  assertEquals(result.valid, true);
  const orphanWarning = result.warnings.find((w) =>
    w.includes("orphan.simple")
  );
  assertEquals(
    orphanWarning !== undefined,
    true,
    `Expected warning for orphan step without structuredGate, got: ${
      JSON.stringify(result.warnings)
    }`,
  );
  // Should NOT be in errors
  const orphanError = result.errors.find((e) => e.includes("orphan.simple"));
  assertEquals(
    orphanError,
    undefined,
    `Orphan step without structuredGate should not produce error, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

// =============================================================================
// 19. P2-3: StepKind boundary crossing validation
// =============================================================================

Deno.test("flow-validator/P2-3 - work step next targeting closure step produces boundary error", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.step", continuation: "work.step" },
    },
    steps: {
      "work.step": {
        stepId: "work.step",
        c2: "continuation",
        transitions: {
          // next from work should target work/verification, NOT closure
          next: { target: "closure.step" },
          handoff: { target: "closure.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, false);
  const boundaryError = result.errors.find((e) =>
    e.includes("work.step") && e.includes("work") &&
    e.includes("next") && e.includes("closure.step") &&
    e.includes("closure") && e.includes("should target")
  );
  assertEquals(
    boundaryError !== undefined,
    true,
    `Expected boundary crossing error for work->next->closure, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("flow-validator/P2-3 - work step handoff targeting work step produces boundary error", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.a", continuation: "work.a" },
    },
    steps: {
      "work.a": {
        stepId: "work.a",
        c2: "continuation",
        transitions: {
          // handoff from work should target closure, NOT work
          handoff: { target: "work.b" },
        },
      },
      "work.b": {
        stepId: "work.b",
        c2: "continuation",
        transitions: {
          handoff: { target: "closure.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, false);
  const boundaryError = result.errors.find((e) =>
    e.includes("work.a") && e.includes("handoff") &&
    e.includes("work.b") && e.includes("should target")
  );
  assertEquals(
    boundaryError !== undefined,
    true,
    `Expected boundary crossing error for work->handoff->work, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("flow-validator/P2-3 - work step handoff targeting closure step produces no boundary error", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.step", continuation: "work.step" },
    },
    steps: {
      "work.step": {
        stepId: "work.step",
        c2: "continuation",
        transitions: {
          handoff: { target: "closure.step" },
          repeat: { target: "work.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, true);
  const boundaryErrors = result.errors.filter((e) =>
    e.includes("should target")
  );
  assertEquals(
    boundaryErrors.length,
    0,
    `Expected no boundary crossing errors, got: ${
      JSON.stringify(boundaryErrors)
    }`,
  );
});

// =============================================================================
// 20. P2-4a: Self-loop via 'next' intent warning
// =============================================================================

Deno.test("flow-validator/P2-4a - next self-loop produces warning", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.step", continuation: "work.step" },
    },
    steps: {
      "work.step": {
        stepId: "work.step",
        c2: "continuation",
        transitions: {
          // next targeting self is suspicious
          next: { target: "work.step" },
          handoff: { target: "closure.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  const selfLoopWarning = result.warnings.find((w) =>
    w.includes("work.step") && w.includes("'next'") &&
    w.includes("self-loop") && w.includes("'repeat'")
  );
  assertEquals(
    selfLoopWarning !== undefined,
    true,
    `Expected warning about 'next' self-loop suggesting 'repeat', got warnings: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

Deno.test("flow-validator/P2-4a - repeat self-loop produces no warning", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "work.step", continuation: "work.step" },
    },
    steps: {
      "work.step": {
        stepId: "work.step",
        c2: "continuation",
        transitions: {
          // repeat targeting self is by design (retry pattern)
          repeat: { target: "work.step" },
          handoff: { target: "closure.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, true);
  const selfLoopWarning = result.warnings.find((w) => w.includes("self-loop"));
  assertEquals(
    selfLoopWarning,
    undefined,
    `repeat self-loop should not produce warning, got: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

// =============================================================================
// 21. P2-4b: Cycle (SCC) without closure path detection
// =============================================================================

Deno.test("flow-validator/P2-4b - cycle without closure path produces error", () => {
  // A->B->A cycle where neither A nor B can reach closure.
  // Entry reaches closure via a separate path so per-entry check passes,
  // but the cycle A<->B has no exit to closure.
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "entry.step", continuation: "entry.step" },
    },
    steps: {
      "entry.step": {
        stepId: "entry.step",
        c2: "initial",
        transitions: {
          // Entry can reach closure directly (per-entry check passes)
          handoff: { target: "closure.step" },
          // Entry can also reach the cycle
          next: { target: "cycle.a" },
        },
      },
      "cycle.a": {
        stepId: "cycle.a",
        c2: "continuation",
        transitions: {
          next: { target: "cycle.b" },
        },
      },
      "cycle.b": {
        stepId: "cycle.b",
        c2: "continuation",
        transitions: {
          next: { target: "cycle.a" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  assertEquals(result.valid, false);
  const cycleError = result.errors.find((e) =>
    e.includes("cycle.a") && e.includes("cycle.b") &&
    e.includes("form a cycle") && e.includes("no path to closure")
  );
  assertEquals(
    cycleError !== undefined,
    true,
    `Expected error about cycle.a and cycle.b forming a cycle with no closure path, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("flow-validator/P2-4b - cycle with closure path produces no cycle error", () => {
  // A->B->A cycle, but B also has an edge to closure -> no cycle error
  const registry: Record<string, unknown> = {
    entryStepMapping: {
      issue: { initial: "cycle.a", continuation: "cycle.a" },
    },
    steps: {
      "cycle.a": {
        stepId: "cycle.a",
        c2: "initial",
        transitions: {
          next: { target: "cycle.b" },
        },
      },
      "cycle.b": {
        stepId: "cycle.b",
        c2: "continuation",
        transitions: {
          next: { target: "cycle.a" },
          handoff: { target: "closure.step" },
        },
      },
      "closure.step": {
        stepId: "closure.step",
        c2: "closure",
        transitions: {
          closing: { target: null },
        },
      },
    },
  };

  const result = validateFlowReachability(registry);

  const cycleErrors = result.errors.filter((e) => e.includes("form a cycle"));
  assertEquals(
    cycleErrors.length,
    0,
    `Expected no cycle errors when cycle has closure path, got: ${
      JSON.stringify(cycleErrors)
    }`,
  );
});
