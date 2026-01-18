/**
 * Tests for WorkflowRouter
 */

import { assertEquals, assertThrows } from "@std/assert";
import { RoutingError, WorkflowRouter } from "./workflow-router.ts";
import type { StepRegistry } from "../common/step-registry.ts";
import type { GateInterpretation } from "./step-gate-interpreter.ts";

// Helper to create minimal registry
function createRegistry(
  steps: Record<string, Partial<StepRegistry["steps"][string]>> = {},
): StepRegistry {
  const fullSteps: StepRegistry["steps"] = {};

  for (const [stepId, partial] of Object.entries(steps)) {
    fullSteps[stepId] = {
      stepId,
      name: partial.name ?? `Step ${stepId}`,
      c2: partial.c2 ?? "test",
      c3: partial.c3 ?? "step",
      edition: partial.edition ?? "default",
      fallbackKey: partial.fallbackKey ?? "fallback",
      uvVariables: partial.uvVariables ?? [],
      usesStdin: partial.usesStdin ?? false,
      ...partial,
    };
  }

  return {
    agentId: "test",
    version: "1.0.0",
    c1: "steps",
    steps: fullSteps,
  };
}

// Helper to create interpretation
function createInterpretation(
  overrides: Partial<GateInterpretation> = {},
): GateInterpretation {
  return {
    intent: "next",
    usedFallback: false,
    ...overrides,
  };
}

Deno.test("WorkflowRouter - closing intent signals completion", () => {
  const registry = createRegistry({
    "initial.issue": {},
  });
  const router = new WorkflowRouter(registry);

  const result = router.route(
    "initial.issue",
    createInterpretation({ intent: "closing", reason: "Task done" }),
  );

  assertEquals(result.signalCompletion, true);
  assertEquals(result.nextStepId, "initial.issue");
  assertEquals(result.reason, "Task done");
});

Deno.test("WorkflowRouter - abort intent signals completion", () => {
  const registry = createRegistry({
    "initial.issue": {},
  });
  const router = new WorkflowRouter(registry);

  const result = router.route(
    "initial.issue",
    createInterpretation({ intent: "abort" }),
  );

  assertEquals(result.signalCompletion, true);
  assertEquals(result.reason, "Intent: abort");
});

Deno.test("WorkflowRouter - repeat intent stays on current step", () => {
  const registry = createRegistry({
    "initial.issue": {},
  });
  const router = new WorkflowRouter(registry);

  const result = router.route(
    "initial.issue",
    createInterpretation({ intent: "repeat", reason: "Retry needed" }),
  );

  assertEquals(result.nextStepId, "initial.issue");
  assertEquals(result.signalCompletion, false);
  assertEquals(result.reason, "Retry needed");
});

Deno.test("WorkflowRouter - jump intent uses explicit target", () => {
  const registry = createRegistry({
    "initial.issue": {},
    "s_review": {},
  });
  const router = new WorkflowRouter(registry);

  const result = router.route(
    "initial.issue",
    createInterpretation({ intent: "jump", target: "s_review" }),
  );

  assertEquals(result.nextStepId, "s_review");
  assertEquals(result.signalCompletion, false);
});

Deno.test("WorkflowRouter - jump to invalid target throws error", () => {
  const registry = createRegistry({
    "initial.issue": {},
  });
  const router = new WorkflowRouter(registry);

  assertThrows(
    () =>
      router.route(
        "initial.issue",
        createInterpretation({ intent: "jump", target: "nonexistent" }),
      ),
    RoutingError,
    "does not exist",
  );
});

Deno.test("WorkflowRouter - next intent uses transitions config", () => {
  const registry = createRegistry({
    "initial.issue": {
      transitions: {
        next: { target: "continuation.issue" },
      },
    },
    "continuation.issue": {},
  });
  const router = new WorkflowRouter(registry);

  const result = router.route(
    "initial.issue",
    createInterpretation({ intent: "next" }),
  );

  assertEquals(result.nextStepId, "continuation.issue");
  assertEquals(result.signalCompletion, false);
});

Deno.test("WorkflowRouter - transitions with invalid target throws error", () => {
  const registry = createRegistry({
    "initial.issue": {
      transitions: {
        next: { target: "nonexistent.step" },
      },
    },
  });
  const router = new WorkflowRouter(registry);

  assertThrows(
    () =>
      router.route(
        "initial.issue",
        createInterpretation({ intent: "next" }),
      ),
    RoutingError,
    "does not exist",
  );
});

Deno.test("WorkflowRouter - default transition initial -> continuation", () => {
  const registry = createRegistry({
    "initial.issue": {}, // No transitions
    "continuation.issue": {},
  });
  const router = new WorkflowRouter(registry);

  const result = router.route(
    "initial.issue",
    createInterpretation({ intent: "next" }),
  );

  assertEquals(result.nextStepId, "continuation.issue");
  assertEquals(result.signalCompletion, false);
});

Deno.test("WorkflowRouter - signals completion when no continuation exists", () => {
  const registry = createRegistry({
    "initial.issue": {}, // No transitions
    // No continuation.issue
  });
  const router = new WorkflowRouter(registry);

  const result = router.route(
    "initial.issue",
    createInterpretation({ intent: "next" }),
  );

  assertEquals(result.signalCompletion, true);
});

Deno.test("WorkflowRouter - conditional transition based on handoff", () => {
  const registry = createRegistry({
    "initial.issue": {
      transitions: {
        next: {
          condition: "testResult",
          targets: {
            pass: "s_review",
            fail: "s_fix",
            default: "continuation.issue",
          },
        },
      },
    },
    "s_review": {},
    "s_fix": {},
    "continuation.issue": {},
  });
  const router = new WorkflowRouter(registry);

  // Test "pass" condition
  const resultPass = router.route(
    "initial.issue",
    createInterpretation({
      intent: "next",
      handoff: { testResult: "pass" },
    }),
  );
  assertEquals(resultPass.nextStepId, "s_review");

  // Test "fail" condition
  const resultFail = router.route(
    "initial.issue",
    createInterpretation({
      intent: "next",
      handoff: { testResult: "fail" },
    }),
  );
  assertEquals(resultFail.nextStepId, "s_fix");

  // Test unknown value uses default
  const resultUnknown = router.route(
    "initial.issue",
    createInterpretation({
      intent: "next",
      handoff: { testResult: "unknown" },
    }),
  );
  assertEquals(resultUnknown.nextStepId, "continuation.issue");
});

Deno.test("WorkflowRouter - conditional with boolean handoff value", () => {
  const registry = createRegistry({
    "initial.issue": {
      transitions: {
        next: {
          condition: "testsPass",
          targets: {
            true: "s_review",
            false: "s_fix",
          },
        },
      },
    },
    "s_review": {},
    "s_fix": {},
  });
  const router = new WorkflowRouter(registry);

  const resultTrue = router.route(
    "initial.issue",
    createInterpretation({
      intent: "next",
      handoff: { testsPass: true },
    }),
  );
  assertEquals(resultTrue.nextStepId, "s_review");

  const resultFalse = router.route(
    "initial.issue",
    createInterpretation({
      intent: "next",
      handoff: { testsPass: false },
    }),
  );
  assertEquals(resultFalse.nextStepId, "s_fix");
});

Deno.test("WorkflowRouter - handles multi-part step IDs", () => {
  const registry = createRegistry({
    "initial.project.preparation": {},
    "continuation.project.preparation": {},
  });
  const router = new WorkflowRouter(registry);

  const result = router.route(
    "initial.project.preparation",
    createInterpretation({ intent: "next" }),
  );

  assertEquals(result.nextStepId, "continuation.project.preparation");
});

Deno.test("WorkflowRouter - preserves reason from interpretation", () => {
  const registry = createRegistry({
    "initial.issue": {
      transitions: {
        next: { target: "continuation.issue" },
      },
    },
    "continuation.issue": {},
  });
  const router = new WorkflowRouter(registry);

  const result = router.route(
    "initial.issue",
    createInterpretation({ intent: "next", reason: "Analysis complete" }),
  );

  assertEquals(result.reason, "Analysis complete");
});

// ============================================================================
// Step Kind and Intent Validation Tests
// ============================================================================

Deno.test("WorkflowRouter - closure step can emit closing intent", () => {
  const registry = createRegistry({
    "closure.default": {
      c2: "closure",
      structuredGate: {
        allowedIntents: ["closing", "repeat"],
        intentField: "next_action.action",
      },
      transitions: {
        closing: { target: null },
        repeat: { target: "continuation.default" },
      },
    },
    "continuation.default": {},
  });
  const router = new WorkflowRouter(registry);

  const result = router.route(
    "closure.default",
    createInterpretation({ intent: "closing" }),
  );

  assertEquals(result.signalCompletion, true);
});

Deno.test("WorkflowRouter - work step closing with transition goes to closure step", () => {
  // Backward compatibility: work step can use closing as transition signal
  const registry = createRegistry({
    "initial.issue": {
      c2: "initial",
      transitions: {
        closing: { target: "closure.issue" },
      },
    },
    "closure.issue": {
      c2: "closure",
    },
  });
  const router = new WorkflowRouter(registry);

  const result = router.route(
    "initial.issue",
    createInterpretation({ intent: "closing" }),
  );

  assertEquals(result.nextStepId, "closure.issue");
  assertEquals(result.signalCompletion, false);
});

Deno.test("WorkflowRouter - verification step can emit escalate intent", () => {
  const registry = createRegistry({
    "verification.default": {
      c2: "verification",
      structuredGate: {
        allowedIntents: ["next", "repeat", "jump", "escalate"],
        intentField: "next_action.action",
      },
      transitions: {
        escalate: { target: "continuation.support" },
      },
    },
    "continuation.support": {},
  });
  const router = new WorkflowRouter(registry);

  const result = router.route(
    "verification.default",
    createInterpretation({ intent: "escalate" }),
  );

  assertEquals(result.nextStepId, "continuation.support");
  assertEquals(result.signalCompletion, false);
});

Deno.test("WorkflowRouter - escalate without transition throws error", () => {
  const registry = createRegistry({
    "verification.default": {
      c2: "verification",
      // No escalate transition defined
    },
  });
  const router = new WorkflowRouter(registry);

  assertThrows(
    () =>
      router.route(
        "verification.default",
        createInterpretation({ intent: "escalate" }),
      ),
    RoutingError,
    "No 'escalate' transition defined",
  );
});

Deno.test("WorkflowRouter - work step cannot emit escalate intent", () => {
  const registry = createRegistry({
    "initial.issue": {
      c2: "initial",
      transitions: {
        escalate: { target: "continuation.support" },
      },
    },
    "continuation.support": {},
  });
  const router = new WorkflowRouter(registry);

  assertThrows(
    () =>
      router.route(
        "initial.issue",
        createInterpretation({ intent: "escalate" }),
      ),
    RoutingError,
    "not allowed for work step",
  );
});

Deno.test("WorkflowRouter - handoff intent signals completion", () => {
  const registry = createRegistry({
    "initial.issue": {
      c2: "initial",
    },
  });
  const router = new WorkflowRouter(registry);

  const result = router.route(
    "initial.issue",
    createInterpretation({
      intent: "handoff",
      reason: "Delegating to reviewer",
    }),
  );

  assertEquals(result.signalCompletion, true);
  assertEquals(result.reason, "Delegating to reviewer");
});

Deno.test("WorkflowRouter - closure step cannot emit handoff intent", () => {
  const registry = createRegistry({
    "closure.default": {
      c2: "closure",
    },
  });
  const router = new WorkflowRouter(registry);

  assertThrows(
    () =>
      router.route(
        "closure.default",
        createInterpretation({ intent: "handoff" }),
      ),
    RoutingError,
    "not allowed for closure step",
  );
});
