/**
 * TC-G6 — Closure-path vs Router-path repeat-cursor parity.
 *
 * Invariant under test (Conformance):
 *   IF the same `(stepId, adaptationChain)` is consumed by
 *      `advanceClosureAdaptation`  (closure repeat path)
 *   AND
 *      `WorkflowRouter.route(...intent: "repeat")` (non-closure repeat path,
 *      which internally calls the private `advanceRepeatCursor`)
 *   THEN both paths must produce:
 *      a) the same sequence of adaptations (one per call, in chain order)
 *      b) the same exhaustion error shape on the call after the chain ends
 *         (`AgentAdaptationChainExhaustedError` with identical
 *          `chainLength` and `lastAdaptation`).
 *
 * Source-of-truth citations:
 *   - agents/runner/adaptation-cursor.ts:273-289 (advanceClosureAdaptation)
 *   - agents/runner/workflow-router.ts:117-227   (route -> advanceRepeatCursor)
 *
 * Why parity matters: design 01-self-route-termination §3.2 declares ONE
 * cursor advance per stepId per repeat occurrence. If the two integration
 * sites diverge, a closure repeat after a non-closure repeat could reset
 * or double-advance silently.
 *
 * Diagnosability:
 *   On failure each assertion names BOTH file paths so a reviewer can
 *   open the file and confirm which integration site drifted.
 *
 * Non-vacuity:
 *   Pre-asserts the chain has at least 2 elements before iterating, so a
 *   future fixture mutation that empties the chain can never trivially pass.
 *
 * Anti-patterns avoided:
 *   - Hardcoded list of chain elements: assertions derive expected values
 *     from `CHAIN[i]` rather than literal-listing "a"/"b"/"c".
 *   - Magic number for chain length: derived from `CHAIN.length`.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { AdaptationCursor } from "../adaptation-cursor.ts";
import { advanceClosureAdaptation } from "../adaptation-cursor.ts";
import { WorkflowRouter } from "../workflow-router.ts";
import { AgentAdaptationChainExhaustedError } from "../../shared/errors/flow-errors.ts";
import { makeStep } from "../../common/step-registry/test-helpers.ts";
import type { StepRegistry } from "../../common/step-registry.ts";

const ADAPTATION_CURSOR_TS = "agents/runner/adaptation-cursor.ts";
const WORKFLOW_ROUTER_TS = "agents/runner/workflow-router.ts";

/**
 * Test fixture — 3-element chain so both helpers must yield 3 adaptations
 * before exhaustion. Length and contents are derived in assertions; never
 * literal-listed.
 */
const STEP_ID = "s1";
const CHAIN: readonly string[] = ["a", "b", "c"] as const;

/**
 * Build a minimal step registry with a single `work` step that allows the
 * `repeat` intent. `kind: "work"` is required because closure steps bypass
 * `WorkflowRouter` entirely (handled by `runClosureLoop` instead) — to
 * exercise `WorkflowRouter.advanceRepeatCursor` we need a non-closure step.
 */
function buildRegistry(): StepRegistry {
  return {
    agentId: "g6-parity",
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
          c3: "g6",
          edition: "default",
        },
        adaptationChain: CHAIN,
      }),
    },
  };
}

Deno.test(
  "TC-G6: closure-path advanceClosureAdaptation and router-path advanceRepeatCursor produce identical sequences and identical exhaustion shape",
  () => {
    // Non-vacuity: a fixture with <2 elements would mask divergence by
    // making the loop body run zero or one times.
    assertEquals(
      CHAIN.length >= 2,
      true,
      `parity test requires CHAIN.length >= 2 to non-vacuously compare sequences ` +
        `(got ${CHAIN.length}) ` +
        `| where: ${ADAPTATION_CURSOR_TS}:273-289 + ${WORKFLOW_ROUTER_TS}:207-227 ` +
        `| how-to-fix: keep CHAIN with at least two distinct elements`,
    );

    // Two parallel cursors so each path mutates an independent counter and
    // the comparison reflects pure helper behavior.
    const closureCursor = new AdaptationCursor();
    const routerCursor = new AdaptationCursor();
    const router = new WorkflowRouter(buildRegistry(), undefined, routerCursor);

    // Step 1: advance both cursors `CHAIN.length` times and collect
    // adaptations. Each iteration's expected value is derived from the
    // input fixture, never literal-listed.
    for (let i = 0; i < CHAIN.length; i++) {
      const closureAdaptation = advanceClosureAdaptation(
        closureCursor,
        STEP_ID,
        CHAIN,
      ).adaptation;

      const routerResult = router.route(STEP_ID, {
        intent: "repeat",
        usedFallback: false,
      });

      const expected = CHAIN[i];

      assertEquals(
        closureAdaptation,
        expected,
        `IF (stepId=${STEP_ID}, chain=[${CHAIN.join(",")}]) THEN ` +
          `advanceClosureAdaptation must yield CHAIN[${i}]="${expected}" on call ${
            i + 1
          } ` +
          `(got "${closureAdaptation}") ` +
          `| where: ${ADAPTATION_CURSOR_TS}:273-289 ` +
          `| how-to-fix: closure path must call cursor.next(stepId, chain) once and return chain[cursor]`,
      );

      assertEquals(
        routerResult.repeatAdaptation,
        expected,
        `IF (stepId=${STEP_ID}, chain=[${CHAIN.join(",")}]) THEN ` +
          `WorkflowRouter.route(intent="repeat") must surface CHAIN[${i}]="${expected}" via repeatAdaptation on call ${
            i + 1
          } ` +
          `(got "${routerResult.repeatAdaptation}") ` +
          `| where: ${WORKFLOW_ROUTER_TS}:207-227 (advanceRepeatCursor) ` +
          `| how-to-fix: router path must call cursor.next(stepId, chain) once and surface chain[cursor] in RoutingResult.repeatAdaptation`,
      );

      // Cross-helper parity at every step — not just the final value.
      assertEquals(
        closureAdaptation,
        routerResult.repeatAdaptation,
        `IF identical (stepId, chain) THEN closure-path and router-path must yield IDENTICAL adaptation on call ${
          i + 1
        } ` +
          `(closure="${closureAdaptation}", router="${routerResult.repeatAdaptation}") ` +
          `| where: ${ADAPTATION_CURSOR_TS}:273-289 + ${WORKFLOW_ROUTER_TS}:207-227 ` +
          `| how-to-fix: keep both integration sites delegating to AdaptationCursor.next without bespoke pre/post logic`,
      );
    }

    // Step 2: the (CHAIN.length + 1)-th call must throw the same error
    // shape from both paths. Property equality, not message-string match.
    const closureError = assertThrows(
      () => advanceClosureAdaptation(closureCursor, STEP_ID, CHAIN),
      AgentAdaptationChainExhaustedError,
    );

    const routerError = assertThrows(
      () =>
        router.route(STEP_ID, {
          intent: "repeat",
          usedFallback: false,
        }),
      AgentAdaptationChainExhaustedError,
    );

    const expectedChainLength = CHAIN.length;
    const expectedLastAdaptation = CHAIN[CHAIN.length - 1];

    assertEquals(
      closureError.chainLength,
      expectedChainLength,
      `closure-path exhaustion error.chainLength must equal CHAIN.length=${expectedChainLength} ` +
        `(got ${closureError.chainLength}) ` +
        `| where: ${ADAPTATION_CURSOR_TS}:273-289 ` +
        `| how-to-fix: forward result.chainLength from cursor.next exhausted variant unchanged`,
    );

    assertEquals(
      closureError.lastAdaptation,
      expectedLastAdaptation,
      `closure-path exhaustion error.lastAdaptation must equal CHAIN[last]="${expectedLastAdaptation}" ` +
        `(got "${closureError.lastAdaptation}") ` +
        `| where: ${ADAPTATION_CURSOR_TS}:273-289 ` +
        `| how-to-fix: forward result.lastAdaptation from cursor.next exhausted variant unchanged`,
    );

    assertEquals(
      routerError.chainLength,
      expectedChainLength,
      `router-path exhaustion error.chainLength must equal CHAIN.length=${expectedChainLength} ` +
        `(got ${routerError.chainLength}) ` +
        `| where: ${WORKFLOW_ROUTER_TS}:207-227 ` +
        `| how-to-fix: forward result.chainLength from cursor.next exhausted variant unchanged`,
    );

    assertEquals(
      routerError.lastAdaptation,
      expectedLastAdaptation,
      `router-path exhaustion error.lastAdaptation must equal CHAIN[last]="${expectedLastAdaptation}" ` +
        `(got "${routerError.lastAdaptation}") ` +
        `| where: ${WORKFLOW_ROUTER_TS}:207-227 ` +
        `| how-to-fix: forward result.lastAdaptation from cursor.next exhausted variant unchanged`,
    );

    // Cross-helper parity on exhaustion: both errors must agree on the
    // shape fields the runner uses to format diagnostics.
    assertEquals(
      closureError.chainLength,
      routerError.chainLength,
      `IF identical (stepId, chain) THEN closure-path and router-path exhaustion errors must report IDENTICAL chainLength ` +
        `(closure=${closureError.chainLength}, router=${routerError.chainLength}) ` +
        `| where: ${ADAPTATION_CURSOR_TS}:273-289 + ${WORKFLOW_ROUTER_TS}:207-227 ` +
        `| how-to-fix: both integration sites must construct AgentAdaptationChainExhaustedError from result.chainLength verbatim`,
    );

    assertEquals(
      closureError.lastAdaptation,
      routerError.lastAdaptation,
      `IF identical (stepId, chain) THEN closure-path and router-path exhaustion errors must report IDENTICAL lastAdaptation ` +
        `(closure="${closureError.lastAdaptation}", router="${routerError.lastAdaptation}") ` +
        `| where: ${ADAPTATION_CURSOR_TS}:273-289 + ${WORKFLOW_ROUTER_TS}:207-227 ` +
        `| how-to-fix: both integration sites must construct AgentAdaptationChainExhaustedError from result.lastAdaptation verbatim`,
    );
  },
);
