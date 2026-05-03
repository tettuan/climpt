/**
 * TC-G2b — `consumePendingAdaptation` clears the slot on stepId mismatch.
 *
 * Invariant under test (Contract):
 *   When `pendingAdaptation` carries a `stepId` that does NOT match the
 *   stepId requested by the caller, `consumePendingAdaptation(stepId)`:
 *     (i)   returns `undefined` (no leakage of the queued adaptation), AND
 *     (ii)  clears the slot to `null` (no second-chance retention).
 *
 * Source-of-truth citation:
 *   - agents/runner/runner.ts:1289-1299 (`consumePendingAdaptation`).
 *     Specifically lines 1294-1297: the slot is unconditionally cleared
 *     before the stepId equality check, and a mismatch returns `undefined`.
 *
 * Reachability note:
 *   The runner's natural code paths set `pendingAdaptation` only on
 *   `intent === "repeat"` (router line 824-828 + closure line 227),
 *   keyed by the same `stepId` that becomes `currentStepId` next
 *   iteration. Forward-progress transitions clear the cursor and consume
 *   the slot via stepId match. As a result, normal flow does NOT
 *   produce a stepId-mismatch consume — the contract at lines 1295-1297
 *   is a structural backstop guarding against future regressions or
 *   queued state surviving a different-step routing.
 *
 *   To exercise the backstop without a production change, this test
 *   directly seeds `pendingAdaptation` with a stale entry before
 *   iteration 1 begins and observes the consume-and-clear via
 *   `iterationObserved`. The seed is the smallest fixture path that
 *   reaches lines 1295-1297; no production code is mutated.
 *
 * Diagnosability:
 *   The failure messages cite `runner.ts:1295-1297` and frame the fix
 *   as a Contract: a mismatch must (a) not leak the adaptation, and
 *   (b) not retain the slot for a later consume.
 *
 * Non-vacuity:
 *   Pre-asserts that `pendingAdaptation` was actually non-null prior to
 *   iteration 1 (else the post-iteration observation of `null` could
 *   trivially come from "never seeded" instead of "consume cleared").
 *   Also asserts the iteration's prompt observed `adaptation === undefined`
 *   to confirm the queued value was NOT applied.
 */

import { assert, assertEquals } from "@std/assert";
import { decodeAdaptationFromPrompt, makeRunnerHarness } from "./harness.ts";
import { makeStep } from "../../common/step-registry/test-helpers.ts";
import type { ExtendedStepsRegistry } from "../../common/validation-types.ts";
import type { IterationSummary } from "../../src_common/types.ts";

const STEP_ID = "initial.consume-mismatch";
const STALE_STEP_ID = "ghost-step";
const STALE_ADAPTATION = "leaked-adaptation";

const RUNNER_TS = "agents/runner/runner.ts";

function makeRegistry(): ExtendedStepsRegistry {
  return {
    agentId: "stepid-mismatch",
    version: "1.0.0",
    c1: "steps",
    entryStep: STEP_ID,
    steps: {
      [STEP_ID]: makeStep({
        stepId: STEP_ID,
        kind: "work",
        address: {
          c1: "steps",
          c2: "initial",
          c3: "consume-mismatch",
          edition: "default",
        },
        // Adaptation chain irrelevant — iteration 1 emits `next`, not
        // `repeat`, so the cursor is never advanced. A non-empty chain
        // is included only to ensure the fixture is structurally
        // representative of a real Flow step.
        adaptationChain: ["unused"],
        structuredGate: {
          allowedIntents: ["next", "repeat"],
          intentField: "next_action.action",
          intentSchemaRef:
            "#/definitions/initial.consume-mismatch/properties/next_action/properties/action",
        },
        // Self-transition on `next` so iteration 1's routing keeps
        // `currentStepId === STEP_ID`. This isolates the consume-once
        // behavior to the stale-seed path under test.
        transitions: {
          next: { target: STEP_ID },
        },
      }),
    },
  } as unknown as ExtendedStepsRegistry;
}

const NEXT_SUMMARY: IterationSummary = {
  iteration: 1,
  sessionId: "sess-mismatch",
  assistantResponses: ["intent=next"],
  toolsUsed: [],
  errors: [],
  structuredOutput: {
    stepId: STEP_ID,
    next_action: { action: "next", reason: "advance" },
  },
};

Deno.test(
  "TC-G2b: consumePendingAdaptation clears the slot AND returns no adaptation when queued stepId does not match",
  async () => {
    const adaptationByIteration = new Map<number, string | undefined>();

    const h = makeRunnerHarness({
      stepsRegistry: makeRegistry(),
      // Iteration 1 only — the test asserts the consume-and-clear
      // observed at the end of iteration 1. Iteration 2 onwards is not
      // exercised; `maxIterations: 1` plus the `next` summary gracefully
      // terminates the loop after one query.
      scriptedSummaries: [NEXT_SUMMARY],
      maxIterations: 1,
      observe: {
        promptObserved: (iteration, prompt) => {
          adaptationByIteration.set(
            iteration,
            decodeAdaptationFromPrompt(prompt),
          );
        },
      },
    });

    // Seed a stale `pendingAdaptation` BEFORE iteration 1 starts. This is
    // the smallest fixture path that reaches `runner.ts:1295-1297`. The
    // production runner sets this slot only on intent=repeat — see the
    // "Reachability note" in the file header for why a seed is necessary.
    //
    // The seed uses a stepId that the registry has NOT registered, so any
    // accidental leak (e.g. a regression that returned the adaptation
    // anyway) would be detectable as an unknown adaptation in the prompt
    // observation.
    // deno-lint-ignore no-explicit-any
    (h.runner as any).pendingAdaptation = {
      stepId: STALE_STEP_ID,
      adaptation: STALE_ADAPTATION,
    };

    // Non-vacuity: verify the seed actually took effect before run().
    // Without this, a later assertion of `null` post-iteration could come
    // from "the seed was never written" instead of "consume-and-clear
    // worked".
    // deno-lint-ignore no-explicit-any
    const seeded = (h.runner as any).pendingAdaptation;
    assert(
      seeded !== null && seeded.stepId === STALE_STEP_ID &&
        seeded.adaptation === STALE_ADAPTATION,
      `non-vacuity: pendingAdaptation must be non-null with the stale ` +
        `seed before run() (got ${JSON.stringify(seeded)}) ` +
        `| where: harness pre-run seeding step ` +
        `| how-to-fix: ensure (runner as any).pendingAdaptation = {...} ` +
        `is writable on the runner instance prior to run()`,
    );

    await h.run();

    // ----- (i) Mismatch must NOT leak the queued adaptation -----------
    // The harness's prompt resolver decodes the `adaptation` slot it was
    // called with. Iteration 1 requests stepId=STEP_ID; the queued slot
    // is for stepId=STALE_STEP_ID — mismatch — so the resolver MUST be
    // called with adaptation=undefined.
    const observedAdaptation = adaptationByIteration.get(1);
    assertEquals(
      observedAdaptation,
      undefined,
      `Fix: stepId mismatch must not leak the queued adaptation ` +
        `(got ${JSON.stringify(observedAdaptation)}, expected undefined). ` +
        `See ${RUNNER_TS}:1295-1297 — when pending.stepId !== stepId, ` +
        `consumePendingAdaptation must return undefined.`,
    );
    // Defensive guard against accidental leak: assert the leaked value
    // is not surfaced in the prompt either.
    assert(
      observedAdaptation !== STALE_ADAPTATION,
      `Fix: stale adaptation "${STALE_ADAPTATION}" leaked into iteration 1 ` +
        `prompt. See ${RUNNER_TS}:1295-1297.`,
    );

    // ----- (ii) Mismatch must clear the slot --------------------------
    // After iteration 1 ends, `pendingAdaptation` must be null — even
    // though the queued value was not applied (mismatch), the slot is
    // unconditionally cleared at line 1294.
    const lastObs = h.observations[h.observations.length - 1];
    assert(
      lastObs !== undefined,
      `non-vacuity: at least one iterationEnd observation must exist ` +
        `(got ${h.observations.length}) | where: harness iteration capture`,
    );
    assertEquals(
      lastObs.pendingAdaptation,
      null,
      `Fix: stepId mismatch must clear the slot to null (consume-once is ` +
        `unconditional — line 1294 runs before the equality check). ` +
        `Got ${JSON.stringify(lastObs.pendingAdaptation)}. ` +
        `See ${RUNNER_TS}:1294-1297.`,
    );
  },
);
