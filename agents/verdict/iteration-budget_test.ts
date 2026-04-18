/**
 * Tests for IterationBudgetVerdictHandler.onBoundaryHook verdict extraction.
 *
 * Context: the closure-signal path in `completion-loop-processor.ts` does not
 * call `setCurrentSummary`, so `lastSummary` may be empty even when a closure
 * step emits structured output. The handler must therefore extract `verdict`
 * directly from the boundary hook payload, mirroring the pattern used by
 * {@link StepMachineVerdictHandler} and {@link ExternalStateAdapter}.
 *
 * Fixes verdict propagation for considerer/detailer on #471.
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import { IterationBudgetVerdictHandler } from "./iteration-budget.ts";
import type { IterationSummary } from "../src_common/types.ts";

// =============================================================================
// Verdict extraction via onBoundaryHook
// =============================================================================

Deno.test(
  "IterationBudget - onBoundaryHook extracts verdict from structured output",
  async () => {
    const handler = new IterationBudgetVerdictHandler(10);

    await handler.onBoundaryHook({
      stepId: "closure.consider",
      stepKind: "closure",
      structuredOutput: { verdict: "done" },
    });

    assertEquals(handler.getLastVerdict(), "done");
  },
);

Deno.test(
  "IterationBudget - getLastVerdict returns undefined before onBoundaryHook",
  () => {
    const handler = new IterationBudgetVerdictHandler(10);
    assertEquals(handler.getLastVerdict(), undefined);
  },
);

Deno.test(
  "IterationBudget - onBoundaryHook ignores missing verdict field",
  async () => {
    const handler = new IterationBudgetVerdictHandler(10);

    await handler.onBoundaryHook({
      stepId: "closure.consider",
      stepKind: "closure",
      structuredOutput: { status: "completed" },
    });

    assertEquals(handler.getLastVerdict(), undefined);
  },
);

Deno.test(
  "IterationBudget - onBoundaryHook ignores non-string verdict",
  async () => {
    const handler = new IterationBudgetVerdictHandler(10);

    await handler.onBoundaryHook({
      stepId: "closure.consider",
      stepKind: "closure",
      structuredOutput: { verdict: 42 },
    });

    assertEquals(handler.getLastVerdict(), undefined);
  },
);

Deno.test(
  "IterationBudget - onBoundaryHook ignores empty string verdict",
  async () => {
    const handler = new IterationBudgetVerdictHandler(10);

    await handler.onBoundaryHook({
      stepId: "closure.consider",
      stepKind: "closure",
      structuredOutput: { verdict: "" },
    });

    assertEquals(handler.getLastVerdict(), undefined);
  },
);

Deno.test(
  "IterationBudget - onBoundaryHook without structuredOutput is no-op",
  async () => {
    const handler = new IterationBudgetVerdictHandler(10);

    await handler.onBoundaryHook({
      stepId: "closure.consider",
      stepKind: "closure",
    });

    assertEquals(handler.getLastVerdict(), undefined);
  },
);

Deno.test(
  "IterationBudget - getLastVerdict returns latest verdict on multiple calls",
  async () => {
    const handler = new IterationBudgetVerdictHandler(10);

    await handler.onBoundaryHook({
      stepId: "closure.consider",
      stepKind: "closure",
      structuredOutput: { verdict: "done" },
    });
    assertEquals(handler.getLastVerdict(), "done");

    await handler.onBoundaryHook({
      stepId: "closure.consider",
      stepKind: "closure",
      structuredOutput: { verdict: "needs_detail" },
    });
    assertEquals(handler.getLastVerdict(), "needs_detail");
  },
);

// =============================================================================
// Interaction with legacy lastSummary-derived verdict
// =============================================================================

Deno.test(
  "IterationBudget - boundary-hook verdict takes precedence over lastSummary",
  async () => {
    const handler = new IterationBudgetVerdictHandler(10);

    const summary: IterationSummary = {
      iteration: 1,
      assistantResponses: [],
      toolsUsed: [],
      errors: [],
      structuredOutput: { verdict: "stale" },
    } as IterationSummary;
    handler.setCurrentSummary(summary);
    assertEquals(handler.getLastVerdict(), "stale");

    await handler.onBoundaryHook({
      stepId: "closure.consider",
      stepKind: "closure",
      structuredOutput: { verdict: "done" },
    });

    assertEquals(handler.getLastVerdict(), "done");
  },
);

Deno.test(
  "IterationBudget - falls back to lastSummary verdict when boundary hook not invoked",
  () => {
    const handler = new IterationBudgetVerdictHandler(10);

    const summary: IterationSummary = {
      iteration: 1,
      assistantResponses: [],
      toolsUsed: [],
      errors: [],
      structuredOutput: { verdict: "in_progress" },
    } as IterationSummary;
    handler.setCurrentSummary(summary);

    assertEquals(handler.getLastVerdict(), "in_progress");
  },
);
