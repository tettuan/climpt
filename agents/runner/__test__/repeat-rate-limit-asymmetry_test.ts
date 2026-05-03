/**
 * TC-G3 — Rate-limit retry asymmetry (closure vs flow).
 *
 * Invariant under test (Conformance):
 *   IF a closure-step iteration emits `summary.rateLimitRetry`,
 *   THEN the runner decrements `iteration` before `continue` so the
 *        retry executes on the SAME iteration index.
 *   IF a flow-step (work) iteration emits the same,
 *   THEN the runner does NOT decrement; the retry executes on
 *        the NEXT iteration index (loop's `iteration++` advances normally).
 *
 * Source-of-truth citations:
 *   - agents/runner/runner.ts:595-598   (closure rate-limit branch: `iteration--; continue;`)
 *   - agents/runner/runner.ts:801-809   (flow rate-limit branch: `continue;` only)
 *
 * Diagnosability:
 *   On failure each assertion names BOTH source paths so a reviewer can
 *   open the file and confirm which branch drifted from the contract.
 *
 * Non-vacuity:
 *   Each variant pre-asserts that at least one rate-limit retry was
 *   actually fired before checking the iteration-index invariant.
 *
 * The tests bound iterations at 5 (`maxIterations: 5`) so a regression
 * cannot loop indefinitely.
 */

import { assertEquals } from "@std/assert";
import { makeRunnerHarness } from "./harness.ts";
import type { ExtendedStepsRegistry } from "../../common/validation-types.ts";
import { makeStep } from "../../common/step-registry/test-helpers.ts";
import type { IterationSummary } from "../../src_common/types.ts";

const MAX_ITERATIONS = 5;

const RUNNER_TS = "agents/runner/runner.ts";
const RATE_LIMIT_RETRY_WAIT_MS = 0;

/**
 * Single-step registry of the requested kind. The step is set as the
 * registry's entry step so the runner enters it on iteration 1.
 */
function singleStepRegistry(
  stepId: string,
  kind: "work" | "closure",
): ExtendedStepsRegistry {
  return {
    agentId: "rate-limit-asymmetry",
    version: "1.0.0",
    c1: "steps",
    entryStep: stepId,
    steps: {
      [stepId]: makeStep({
        stepId,
        kind,
        address: {
          c1: "steps",
          c2: kind === "closure" ? "closure" : "initial",
          c3: "rate-limit",
          edition: "default",
        },
      }),
    },
  } as unknown as ExtendedStepsRegistry;
}

/**
 * Iteration-N summary scripter: iteration 1 emits a rate-limit retry,
 * iteration 2 onwards is a normal (no-rate-limit) summary.
 *
 * Both summaries omit `structuredOutput` so the verdict handler (round-
 * robined "not finished") drives termination via maxIterations only.
 */
function rateLimitThenNormal(): IterationSummary[] {
  const rateLimited: IterationSummary = {
    iteration: 1,
    sessionId: "sess-rl",
    assistantResponses: ["rate-limited"],
    toolsUsed: [],
    errors: [],
    rateLimitRetry: { waitMs: RATE_LIMIT_RETRY_WAIT_MS, attempt: 1 },
  };
  const normal: IterationSummary = {
    iteration: 1, // overwritten by harness with real loop iteration
    sessionId: "sess-rl",
    assistantResponses: ["resumed"],
    toolsUsed: [],
    errors: [],
  };
  return [rateLimited, normal];
}

Deno.test(
  "TC-G3 Variant A (closure path): rate-limit retry decrements iteration so the retry runs at the same index",
  async () => {
    const stepId = "closure.rate-limit";
    const promptIterations: number[] = [];
    let rateLimitSeen = 0;

    const h = makeRunnerHarness({
      stepsRegistry: singleStepRegistry(stepId, "closure"),
      scriptedSummaries: rateLimitThenNormal(),
      maxIterations: MAX_ITERATIONS,
      observe: {
        promptObserved: (iteration, _prompt, _type) => {
          promptIterations.push(iteration);
        },
      },
    });

    // Capture the rate-limit emissions to enforce non-vacuity.
    h.runner.on("queryExecuted", (payload) => {
      if (payload.summary.rateLimitRetry) rateLimitSeen++;
    });

    await h.run();

    // Non-vacuity: the rate-limit summary must actually have fired.
    assertEquals(
      rateLimitSeen >= 1,
      true,
      `closure variant: at least one rateLimitRetry summary must reach the runner ` +
        `| where: ${RUNNER_TS}:585 (closureManager.runClosureIteration → executeClosureLoopIteration) ` +
        `| how-to-fix: ensure scripted summary[0].rateLimitRetry is non-null and the closure path reaches the rate-limit branch`,
    );

    // Closure-path contract: prompts at index [0] (the rate-limited call)
    // and [1] (the immediate retry) must observe the SAME iteration value
    // — proving `iteration--; continue;` ran (runner.ts:595-598).
    assertEquals(
      promptIterations[0],
      promptIterations[1],
      `closure variant: rate-limit retry must execute on the SAME iteration index ` +
        `as the rate-limited call (got [${promptIterations[0]}, ${
          promptIterations[1]
        }]) ` +
        `| where: ${RUNNER_TS}:595-598 (closure rate-limit: iteration--; continue) ` +
        `| how-to-fix: keep the iteration-- decrement before the continue inside the closure ` +
        `branch's rate-limit handler`,
    );
  },
);

Deno.test(
  "TC-G3 Variant B (flow path): rate-limit retry does NOT decrement iteration; the retry runs at index+1",
  async () => {
    const stepId = "initial.rate-limit";
    const promptIterations: number[] = [];
    let rateLimitSeen = 0;

    const h = makeRunnerHarness({
      stepsRegistry: singleStepRegistry(stepId, "work"),
      scriptedSummaries: rateLimitThenNormal(),
      maxIterations: MAX_ITERATIONS,
      observe: {
        promptObserved: (iteration) => {
          promptIterations.push(iteration);
        },
      },
    });

    h.runner.on("queryExecuted", (payload) => {
      if (payload.summary.rateLimitRetry) rateLimitSeen++;
    });

    await h.run();

    // Non-vacuity guard.
    assertEquals(
      rateLimitSeen >= 1,
      true,
      `flow variant: at least one rateLimitRetry summary must reach the runner ` +
        `| where: ${RUNNER_TS}:760 (Flow Loop executeQuery emit) ` +
        `| how-to-fix: ensure scripted summary[0].rateLimitRetry is non-null and the flow path reaches the rate-limit branch`,
    );

    // Flow-path contract: the retry call's iteration index must be exactly
    // one greater than the rate-limited call's index (no decrement).
    assertEquals(
      promptIterations[1] - promptIterations[0],
      1,
      `flow variant: rate-limit retry must execute at iteration+1 ` +
        `(got [${promptIterations[0]}, ${promptIterations[1]}], delta=${
          promptIterations[1] - promptIterations[0]
        }) ` +
        `| where: ${RUNNER_TS}:801-809 (flow rate-limit: continue without iteration--) ` +
        `| how-to-fix: keep the flow rate-limit branch a plain continue — never decrement iteration here`,
    );
  },
);
