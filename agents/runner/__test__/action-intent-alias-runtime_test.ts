/**
 * TC-G1 — ACTION_TO_INTENT alias runtime contract.
 *
 * Invariant under test (Contract):
 *   For every alias in `ACTION_TO_INTENT` whose mapped value is `"repeat"`,
 *   emitting a structured output with `next_action.action === "<alias>"`
 *   on a Flow step must produce same-step routing through the runner
 *   end-to-end (router resolves to `nextStepId === currentStepId` and
 *   advances the adaptation cursor).
 *
 * Source-of-truth citations:
 *   - agents/runner/step-gate-interpreter.ts:39 (ACTION_TO_INTENT map)
 *   - agents/runner/workflow-router.ts:143-155 (intent === "repeat" branch)
 *
 * Diagnosability:
 *   The test imports `ACTION_TO_INTENT` directly from the production
 *   module — it does NOT hardcode `["retry", "wait", "fail"]`. Adding or
 *   removing a "repeat" alias automatically expands or contracts the test
 *   surface. Each per-alias assertion names the offending alias plus both
 *   source files.
 *
 * Non-vacuity:
 *   The test pre-asserts `aliases.length >= 3` so a future regression that
 *   empties the alias table fails loudly instead of passing vacuously.
 *
 * Validator-bypass note:
 *   The runtime path under test is StepGateInterpreter -> WorkflowRouter.
 *   The harness drives a real `IterationSummary.structuredOutput` so the
 *   alias goes through the production interpreter (no synthesized intent).
 */

import { assert, assertEquals } from "@std/assert";
import { decodeAdaptationFromPrompt, makeRunnerHarness } from "./harness.ts";
import { makeStep } from "../../common/step-registry/test-helpers.ts";
import type { ExtendedStepsRegistry } from "../../common/validation-types.ts";
import type { IterationSummary } from "../../src_common/types.ts";
import { ACTION_TO_INTENT } from "../step-gate-interpreter.ts";

const STEP_GATE_FILE = "agents/runner/step-gate-interpreter.ts";
const ROUTER_FILE = "agents/runner/workflow-router.ts";

/**
 * Derive every alias mapped to `"repeat"` directly from the production
 * `ACTION_TO_INTENT` table. Iterating `Object.entries` keeps the test in
 * sync with the source of truth — adding or removing a repeat alias
 * automatically reshapes the test surface.
 */
function discoverRepeatAliases(): string[] {
  return Object.entries(ACTION_TO_INTENT)
    .filter(([_alias, intent]) => intent === "repeat")
    .map(([alias]) => alias);
}

const ADAPTATION_CHAIN: readonly string[] = ["a", "b", "c"];
const STEP_ID = "initial.alias";

function makeRegistry(): ExtendedStepsRegistry {
  return {
    agentId: "alias-runtime",
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
          c3: "alias",
          edition: "default",
        },
        adaptationChain: ADAPTATION_CHAIN,
        structuredGate: {
          allowedIntents: ["next", "repeat"],
          intentField: "next_action.action",
          intentSchemaRef:
            "#/definitions/initial.alias/properties/next_action/properties/action",
        },
        // Only the `repeat` self-transition is declared. The test never
        // emits `next` so the default initial->continuation prefix
        // substitution path is never exercised; the run terminates
        // exclusively at maxIterations=2.
        transitions: {
          repeat: { target: STEP_ID },
        },
      }),
    },
  } as unknown as ExtendedStepsRegistry;
}

function aliasSummary(iteration: number, alias: string): IterationSummary {
  return {
    iteration,
    sessionId: `sess-alias-${alias}`,
    assistantResponses: [`alias=${alias}`],
    toolsUsed: [],
    errors: [],
    structuredOutput: {
      stepId: STEP_ID,
      next_action: { action: alias, reason: `script: ${alias}` },
    },
  };
}

Deno.test(
  "TC-G1: every ACTION_TO_INTENT alias mapping to 'repeat' produces same-step routing through the runner",
  async () => {
    const aliases = discoverRepeatAliases();

    // ----- Non-vacuity: the alias table must contain at least the three
    // historically declared "repeat" aliases (retry, wait, fail). A
    // regression that empties the table is caught here. -----
    assert(
      aliases.length >= 3,
      `non-vacuity: ACTION_TO_INTENT must contain at least 3 aliases mapping to "repeat" ` +
        `(found ${aliases.length}: ${JSON.stringify(aliases)}) ` +
        `| where: ${STEP_GATE_FILE}:39 (ACTION_TO_INTENT map) ` +
        `| how-to-fix: do not remove the historical aliases (retry, wait, fail); ` +
        `the runtime alias surface is part of the public contract`,
    );

    // For each repeat-alias, run a 2-iteration script and assert iteration
    // 2's prompt observed the first cursor step ("a"). This proves the
    // alias produced same-step routing AND advanced the cursor exactly
    // once on iteration 1.
    for (const alias of aliases) {
      const adaptationByIteration = new Map<number, string | undefined>();

      const h = makeRunnerHarness({
        stepsRegistry: makeRegistry(),
        scriptedSummaries: [
          aliasSummary(1, alias),
          // Iteration 2 emits another `repeat` so the run does not exit
          // through `next`'s prefix-substitution path. We only assert on
          // iteration 2's prompt-resolution snapshot, not on iteration 3.
          aliasSummary(2, alias),
        ],
        maxIterations: 2,
        observe: {
          promptObserved: (iteration, prompt) => {
            adaptationByIteration.set(
              iteration,
              decodeAdaptationFromPrompt(prompt),
            );
          },
        },
      });

      await h.run();

      // ----- Per-alias contract -----------------------------------------
      // Iteration 2's prompt must observe adaptation === ADAPTATION_CHAIN[0]
      // — proves both: (a) router routed to same step (else iteration 2
      // would resolve a different step's prompt), (b) cursor advanced by
      // one (so consumePendingAdaptation returned chain[0]).
      const adapt2 = adaptationByIteration.get(2);
      const expected = ADAPTATION_CHAIN[0]; // derive from fixture, not literal
      assertEquals(
        adapt2,
        expected,
        `Fix: ACTION_TO_INTENT["${alias}"] === "repeat" must produce same-step ` +
          `routing through runner. Got prompt adaptation=${
            JSON.stringify(adapt2)
          } ` +
          `(expected first cursor step "${expected}" derived from ` +
          `step.adaptationChain[0]). ` +
          `See ${STEP_GATE_FILE}:39 + ${ROUTER_FILE}:143-155.`,
      );

      // Cursor advance non-vacuity: at least one adaptation_advance event
      // must have fired on iteration 1, otherwise the chain[0] adaptation
      // could not have been queued.
      const advances = h.cursorEvents.filter(
        (e) => e.message === "adaptation_advance",
      );
      assert(
        advances.length >= 1,
        `Fix: alias "${alias}" must trigger at least one cursor advance ` +
          `(got ${advances.length} adaptation_advance events). ` +
          `See ${ROUTER_FILE}:148 (advanceRepeatCursor).`,
      );
    }
  },
);
