/**
 * Tests for agents/config/flow-validator.ts
 *
 * Covers validateFlowReachability() with in-memory registries:
 * - Valid flow, orphan steps, section steps, closure reachability
 * - Transition key validation (valid intents vs unknown)
 * - Multiple entry points, empty registries, real config integration
 */

import { assertEquals } from "@std/assert";
import { validateFlowReachability } from "./flow-validator.ts";

// =============================================================================
// Fixtures
// =============================================================================

/**
 * Minimal valid registry with a linear flow:
 * entry("issue") -> initial.issue -> continuation.issue -> closure.issue
 */
function validFlowRegistry(): Record<string, unknown> {
  return {
    agentId: "test",
    version: "1.0.0",
    entryStepMapping: {
      issue: "initial.issue",
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
          next: { target: "closure.issue" },
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

Deno.test("flow-validator - unknown transition key produces warning", () => {
  const registry = validFlowRegistry();
  const steps = registry.steps as Record<string, Record<string, unknown>>;

  steps["initial.issue"].transitions = {
    next: { target: "continuation.issue" },
    invalid_intent: { target: "continuation.issue" },
  };

  const result = validateFlowReachability(registry);

  // Flow is still valid (warnings only for unknown intents)
  assertEquals(result.valid, true);
  const intentWarning = result.warnings.find((w) =>
    w.includes("invalid_intent")
  );
  assertEquals(intentWarning !== undefined, true);
});

// =============================================================================
// 6. All 7 valid intents -> no warnings about intents
// =============================================================================

Deno.test("flow-validator - all valid intents produce no intent warnings", () => {
  const registry: Record<string, unknown> = {
    entryStepMapping: { issue: "step.a" },
    steps: {
      "step.a": {
        stepId: "step.a",
        c2: "initial",
        transitions: {
          next: { target: "step.b" },
          repeat: { target: "step.a" },
          jump: { target: "step.b" },
          handoff: { target: "step.b" },
          closing: { target: null },
          escalate: { target: "step.b" },
          abort: { target: null },
        },
      },
      "step.b": {
        stepId: "step.b",
        c2: "closure",
        transitions: {
          closing: { target: null },
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
      issue: "initial.issue",
      project: "initial.project",
    },
    steps: {
      "initial.issue": {
        stepId: "initial.issue",
        c2: "initial",
        transitions: {
          next: { target: "closure.issue" },
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
          next: { target: "closure.project" },
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
          next: { target: "closure.issue" },
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
          next: { target: "closure.issue" },
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

Deno.test("flow-validator/integration - iterator steps_registry has valid flow", async () => {
  const text = await Deno.readTextFile(".agent/iterator/steps_registry.json");
  const data = JSON.parse(text);

  const result = validateFlowReachability(data);

  assertEquals(
    result.valid,
    true,
    `Flow errors: ${JSON.stringify(result.errors)}`,
  );
  // The iterator registry has project/issue flows not all connected to
  // entryStepMapping entries, so orphan warnings are expected
});
