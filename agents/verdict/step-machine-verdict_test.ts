/**
 * Tests for Issue #454
 *
 * StepMachineVerdictHandler verdict extraction for orchestrator routing.
 *
 * When a detect:graph agent's closure step produces structured output with a
 * `verdict` field, the handler must expose it via getLastVerdict() so the
 * runner can populate AgentResult.verdict and the orchestrator can route
 * via outputPhases.
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import { StepMachineVerdictHandler } from "./step-machine.ts";
import type { ExtendedStepsRegistry } from "../common/validation-types.ts";
import { makeStep } from "../common/step-registry/test-helpers.ts";

// =============================================================================
// Helpers
// =============================================================================

function createMinimalRegistry(
  entryStep = "initial.review",
): ExtendedStepsRegistry {
  return {
    agentId: "test",
    version: "1.0.0",
    c1: "steps",
    entryStep,
    steps: {
      [entryStep]: makeStep({
        stepId: entryStep,
        name: "Test Step",
        c2: "initial",
        c3: "review",
        edition: "default",
      }),
    },
  } as ExtendedStepsRegistry;
}

function createHandler(
  entryStep = "initial.review",
): StepMachineVerdictHandler {
  return new StepMachineVerdictHandler(
    createMinimalRegistry(entryStep),
    entryStep,
  );
}

// =============================================================================
// Verdict extraction via onBoundaryHook
// =============================================================================

Deno.test("StepMachine - onBoundaryHook extracts verdict from structured output", async () => {
  const handler = createHandler();

  await handler.onBoundaryHook({
    stepId: "closure.review",
    stepKind: "closure",
    structuredOutput: {
      verdict: "approved",
      closure_action: "label-and-close",
    },
  });

  assertEquals(handler.getLastVerdict(), "approved");
});

Deno.test("StepMachine - onBoundaryHook extracts rejected verdict", async () => {
  const handler = createHandler();

  await handler.onBoundaryHook({
    stepId: "closure.review",
    stepKind: "closure",
    structuredOutput: {
      verdict: "rejected",
      closure_action: "label-only",
    },
  });

  assertEquals(handler.getLastVerdict(), "rejected");
});

Deno.test("StepMachine - getLastVerdict returns undefined before onBoundaryHook", () => {
  const handler = createHandler();
  assertEquals(handler.getLastVerdict(), undefined);
});

Deno.test("StepMachine - onBoundaryHook ignores missing verdict field", async () => {
  const handler = createHandler();

  await handler.onBoundaryHook({
    stepId: "closure.review",
    stepKind: "closure",
    structuredOutput: { closure_action: "close" },
  });

  assertEquals(handler.getLastVerdict(), undefined);
});

Deno.test("StepMachine - onBoundaryHook ignores non-string verdict", async () => {
  const handler = createHandler();

  await handler.onBoundaryHook({
    stepId: "closure.review",
    stepKind: "closure",
    structuredOutput: { verdict: 123 },
  });

  assertEquals(handler.getLastVerdict(), undefined);
});

Deno.test("StepMachine - onBoundaryHook ignores empty string verdict", async () => {
  const handler = createHandler();

  await handler.onBoundaryHook({
    stepId: "closure.review",
    stepKind: "closure",
    structuredOutput: { verdict: "" },
  });

  assertEquals(handler.getLastVerdict(), undefined);
});

Deno.test("StepMachine - onBoundaryHook without structuredOutput is no-op", async () => {
  const handler = createHandler();

  await handler.onBoundaryHook({
    stepId: "closure.review",
    stepKind: "closure",
  });

  assertEquals(handler.getLastVerdict(), undefined);
});

Deno.test("StepMachine - getLastVerdict returns latest verdict on multiple calls", async () => {
  const handler = createHandler();

  await handler.onBoundaryHook({
    stepId: "closure.review",
    stepKind: "closure",
    structuredOutput: { verdict: "approved" },
  });
  assertEquals(handler.getLastVerdict(), "approved");

  await handler.onBoundaryHook({
    stepId: "closure.review",
    stepKind: "closure",
    structuredOutput: { verdict: "rejected" },
  });
  assertEquals(handler.getLastVerdict(), "rejected");
});
