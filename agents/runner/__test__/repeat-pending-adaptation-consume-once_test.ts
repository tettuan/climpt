/**
 * TC-G2a — Pending adaptation is consumed exactly once after a same-step
 * repeat, then cleared on forward progress (cursor reset on outgoing step).
 *
 * Invariant under test (Conformance, three iterations):
 *
 *   1. Iteration k (s1, intent=repeat, chain=["x"]):
 *      - Prompt observed at k:   adaptation = undefined  (first entry, no pending).
 *      - Router advances cursor; queues `pendingAdaptation = {s1, "x"}`.
 *   2. Iteration k+1 (s1, intent=next):
 *      - Prompt observed at k+1: adaptation = "x"        (queued slot consumed).
 *      - Router routes s1 → s2 (forward progress); cursor for s1 reset.
 *   3. Iteration k+2 (s2, intent=next, transition next→s1):
 *      - Router routes s2 → s1 (forward progress).
 *   4. Iteration k+3 (s1 re-entry, no prior repeat):
 *      - Prompt observed at k+3: adaptation = undefined  (cursor reset; nothing queued).
 *
 * The contract proven: a "repeat" pre-loads pendingAdaptation, the very
 * next iteration consumes it once (visible in the resolved prompt), and a
 * later re-entry of the same stepId after forward progress observes the
 * empty slot — no leak of the prior adaptation.
 *
 * Source-of-truth citations:
 *   - agents/runner/runner.ts:692-707  (consumePendingAdaptation +
 *     resolveFlowStepPrompt with `{ adaptation }` override on the next iteration)
 *   - agents/runner/runner.ts:824-829  (queue pendingAdaptation on
 *     `routingResult.repeatAdaptation`)
 *   - agents/runner/runner.ts:1289-1299 (`consumePendingAdaptation`:
 *     consume-once + stepId match)
 *   - agents/runner/workflow-router.ts:189-191
 *     (forward-progress reset via `resolveFromTransitions`)
 *
 * Diagnosability:
 *   Each assertion names the iteration k by ordinal and the file:line of
 *   the contract it verifies.
 *
 * Non-vacuity:
 *   The test explicitly asserts iteration k+1 observed adaptation === "x"
 *   (the consume-once event happened) BEFORE asserting iteration k+3
 *   observed adaptation === undefined.
 */

import { assert, assertEquals } from "@std/assert";
import { decodeAdaptationFromPrompt, makeRunnerHarness } from "./harness.ts";
import { makeStep } from "../../common/step-registry/test-helpers.ts";
import type { ExtendedStepsRegistry } from "../../common/validation-types.ts";
import type { IterationSummary } from "../../src_common/types.ts";

const S1 = "initial.consume-once";
const S2 = "continuation.consume-once";
const ADAPTATION_CHAIN = ["x"];

/**
 * Two-step registry. Both steps declare a structuredGate so the
 * `WorkflowRouter` can read the `next_action.action` intent. `s2`'s
 * `next` transition loops back to `s1` so the test can drive an explicit
 * re-entry without manipulating internal state.
 */
function makeRegistry(): ExtendedStepsRegistry {
  return {
    agentId: "consume-once",
    version: "1.0.0",
    c1: "steps",
    entryStep: S1,
    steps: {
      [S1]: makeStep({
        stepId: S1,
        kind: "work",
        address: {
          c1: "steps",
          c2: "initial",
          c3: "consume-once",
          edition: "default",
        },
        adaptationChain: ADAPTATION_CHAIN,
        structuredGate: {
          allowedIntents: ["next", "repeat"],
          intentField: "next_action.action",
          intentSchemaRef:
            "#/definitions/initial.consume-once/properties/next_action/properties/action",
        },
        transitions: {
          next: { target: S2 },
          repeat: { target: S1 },
        },
      }),
      [S2]: makeStep({
        stepId: S2,
        kind: "work",
        address: {
          c1: "steps",
          c2: "continuation",
          c3: "consume-once",
          edition: "default",
        },
        structuredGate: {
          allowedIntents: ["next"],
          intentField: "next_action.action",
          intentSchemaRef:
            "#/definitions/continuation.consume-once/properties/next_action/properties/action",
        },
        // Loop back to s1 so the test exercises re-entry through the
        // forward-progress branch (and therefore the cursor reset).
        transitions: {
          next: { target: S1 },
        },
      }),
    },
  } as unknown as ExtendedStepsRegistry;
}

/**
 * Build a summary that emits a `next_action.action` intent. `WorkflowRouter`
 * reads this through the `structuredGate.intentField` path
 * (`next_action.action`).
 */
function intentSummary(
  iteration: number,
  intent: "next" | "repeat",
): IterationSummary {
  return {
    iteration,
    sessionId: "sess-consume-once",
    assistantResponses: [`intent=${intent}`],
    toolsUsed: [],
    errors: [],
    structuredOutput: {
      stepId: iteration === 3 ? S2 : S1, // canonical only; runner normalizes
      next_action: { action: intent, reason: `script: ${intent}` },
    },
  };
}

Deno.test(
  "TC-G2a: pendingAdaptation is consumed exactly once; re-entry after forward progress observes undefined",
  async () => {
    /**
     * Scripted iteration plan:
     *   1: s1 → repeat   (queues pendingAdaptation = "x")
     *   2: s1 → next     (consumes "x"; routes s1→s2; cursor reset for s1)
     *   3: s2 → next     (routes s2→s1)
     *   4: s1 (re-entry) → next (terminate via maxIterations cap)
     */
    const scripted: IterationSummary[] = [
      intentSummary(1, "repeat"),
      intentSummary(2, "next"),
      intentSummary(3, "next"),
      intentSummary(4, "next"),
    ];

    // Capture (iteration → adaptation slot at prompt-resolution time).
    const promptAdaptationByIteration = new Map<number, string | undefined>();

    const h = makeRunnerHarness({
      stepsRegistry: makeRegistry(),
      scriptedSummaries: scripted,
      maxIterations: 4,
      observe: {
        promptObserved: (iteration, prompt) => {
          promptAdaptationByIteration.set(
            iteration,
            decodeAdaptationFromPrompt(prompt),
          );
        },
      },
    });

    await h.run();

    // ----- Non-vacuity: iteration 2 must have observed adaptation="x"
    // (proves the consume-once event actually fired). The rest of the
    // assertions key off this fact. -----------------------------------
    const adapt2 = promptAdaptationByIteration.get(2);
    assertEquals(
      adapt2,
      "x",
      `non-vacuity: iteration 2 must observe adaptation="x" (the queued ` +
        `pendingAdaptation slot must be consumed by the next iteration's prompt resolver) ` +
        `| got ${JSON.stringify(adapt2)} ` +
        `| where: agents/runner/runner.ts:692-707 (consumePendingAdaptation → resolveFlowStepPrompt with override) ` +
        `| how-to-fix: ensure pendingAdaptation set on iteration 1's repeat is read on iteration 2's prompt resolve`,
    );

    // ----- (i) Iteration 1: first entry into s1, no pending → undefined
    const adapt1 = promptAdaptationByIteration.get(1);
    assertEquals(
      adapt1,
      undefined,
      `iteration 1 (first entry into s1): adaptation must be undefined ` +
        `(got ${JSON.stringify(adapt1)}) ` +
        `| where: agents/runner/runner.ts:1289-1299 ` +
        `| how-to-fix: consumePendingAdaptation must return undefined when pendingAdaptation is null`,
    );

    // ----- (ii) Iteration 4: re-entry to s1 after forward progress
    // (s1→s2→s1) — pending slot must be empty (cursor was reset). -----
    const adapt4 = promptAdaptationByIteration.get(4);
    assertEquals(
      adapt4,
      undefined,
      `iteration 4 (re-entry to s1 after forward progress): adaptation must be undefined ` +
        `(got ${JSON.stringify(adapt4)}) ` +
        `| where: agents/runner/workflow-router.ts:189-191 (resolveFromTransitions cursor.reset) + ` +
        `agents/runner/runner.ts:1289-1299 (consume-once) ` +
        `| how-to-fix: forward-progress branches must reset the cursor for the outgoing stepId, and ` +
        `pendingAdaptation must already have been consumed by iteration 2 — re-entry to s1 must not see it again`,
    );

    // ----- (iii) Cursor advanced exactly once (iteration 1's repeat) --
    // After the repeat in iteration 1, the cursor walked chain[0]="x".
    // No further repeats occurred, so exactly one `adaptation_advance`
    // event must have been emitted across the whole run.
    const advances = h.cursorEvents.filter(
      (e) => e.message === "adaptation_advance",
    );
    assertEquals(
      advances.length,
      1,
      `cursor must advance exactly once across the run (got ${advances.length}) ` +
        `| where: agents/runner/adaptation-cursor.ts (next emits adaptation_advance) ` +
        `| how-to-fix: only iteration 1's intent="repeat" should advance the cursor; ` +
        `iteration 2's intent="next" must reset it via resolveFromTransitions`,
    );
    assertEquals(
      advances[0].fields.toAdaptation,
      ADAPTATION_CHAIN[0],
      `the single advance must read chain[0]="${ADAPTATION_CHAIN[0]}" ` +
        `| where: agents/runner/adaptation-cursor.ts AdaptationCursor.next`,
    );

    // ----- (iv) pendingAdaptation slot is null at end-of-run ----------
    // After iteration 2's "next" routed s1→s2, the slot is implicitly
    // cleared by stepId mismatch on iteration 3's consume call. Iteration
    // 3 emits next; iteration 4 starts at s1 with no queued adaptation.
    const lastObs = h.observations[h.observations.length - 1];
    assert(
      lastObs !== undefined,
      `non-vacuity: at least one iterationEnd observation must exist ` +
        `(got ${h.observations.length}) | where: harness iteration capture`,
    );
    assertEquals(
      lastObs.pendingAdaptation,
      null,
      `pendingAdaptation must be null at end-of-run ` +
        `(got ${JSON.stringify(lastObs.pendingAdaptation)}) ` +
        `| where: agents/runner/runner.ts:1289-1299 ` +
        `| how-to-fix: consume-once must clear pendingAdaptation on every consume`,
    );
  },
);
