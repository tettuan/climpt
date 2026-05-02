/**
 * TC-G4 — `schemaResolutionFailed` keeps the runner pinned to the same
 * step and lets the fallback iteration cap drive termination.
 *
 * Invariant under test (Conformance, three-part):
 *   While `schemaResolutionFailed === true`:
 *     (i)   `currentStepId` does NOT change between iterations.
 *     (ii)  The adaptation cursor for `s1` does NOT advance (no
 *           `adaptation_advance` events emitted).
 *     (iii) The loop terminates only at
 *           `AGENT_LIMITS.FALLBACK_MAX_ITERATIONS` (no `maxIterations`
 *           override is supplied; the runner falls through).
 *
 * Source-of-truth citations:
 *   - agents/runner/runner.ts:1162-1172  (`getMaxIterations()` fallback)
 *   - agents/runner/flow-orchestrator.ts:208-215 (StepGate skip on
 *     `schemaResolutionFailed`; `currentStepId` stays unchanged)
 *   - agents/shared/constants.ts:13-24 (`AGENT_LIMITS.FALLBACK_MAX_ITERATIONS`)
 *
 * Diagnosability:
 *   Each failure message names the specific source path so a reviewer can
 *   open the file and identify which contract drifted.
 *
 * Non-vacuity:
 *   The test pre-asserts that `schemaResolutionFailed` was actually
 *   propagated to the runner at least once before checking the cap. It
 *   also asserts the cursor's pre-call snapshot (no `adaptation_advance`
 *   events) so a "no events because nothing ran" failure cannot pass
 *   silently.
 */

import { assert, assertEquals } from "@std/assert";
import { AgentMaxIterationsError } from "../errors.ts";
import { makeRunnerHarness } from "./harness.ts";
import { AGENT_LIMITS } from "../../shared/constants.ts";
import { makeStep } from "../../common/step-registry/test-helpers.ts";
import type { ExtendedStepsRegistry } from "../../common/validation-types.ts";
import type { IterationSummary } from "../../src_common/types.ts";

const STEP_ID = "s1";

const ADAPTATION_CHAIN: readonly string[] = ["a", "b", "c", "d", "e"];

/**
 * Single work-step registry with a 5-element `adaptationChain`. The cursor
 * walks this chain on every `intent === "repeat"`. The chain is exposed
 * to the test only as a hand-off to the runner — we never assert on its
 * contents (the test asserts the cursor stayed at position 0).
 */
function makeRegistry(): ExtendedStepsRegistry {
  return {
    agentId: "schema-resolution-failed",
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
          c3: "schema-failed",
          edition: "default",
        },
        adaptationChain: ADAPTATION_CHAIN,
      }),
    },
  } as unknown as ExtendedStepsRegistry;
}

/**
 * Iteration summary that flags `schemaResolutionFailed`. The runner copies
 * this into `IterationSummary.schemaResolutionFailed` and forwards it to
 * `flowOrchestrator.setSchemaResolutionFailed` (runner.ts:786-788).
 */
const SCHEMA_FAILURE_SUMMARY: IterationSummary = {
  iteration: 1,
  sessionId: "sess-schema-fail",
  assistantResponses: ["schema failed"],
  toolsUsed: [],
  errors: ["Schema resolution failed for step"],
  schemaResolutionFailed: true,
};

Deno.test(
  "TC-G4: schemaResolutionFailed pins step + cursor; loop terminates at FALLBACK_MAX_ITERATIONS",
  async () => {
    let schemaFailedSets = 0;
    const stepIdsObserved: string[] = [];
    const emittedErrors: Error[] = [];

    const h = makeRunnerHarness({
      stepsRegistry: makeRegistry(),
      scriptedSummaries: [SCHEMA_FAILURE_SUMMARY],
      // No `maxIterations` → runner.getMaxIterations() must fall through
      // to AGENT_LIMITS.FALLBACK_MAX_ITERATIONS (runner.ts:1171).
      maxIterations: undefined,
      observe: {
        promptObserved: (_iteration, prompt) => {
          // Decode the stepId the resolver was asked to render. Source-of-
          // truth: the resolver itself encodes the stepId into the prompt
          // marker (harness.ts buildHarnessPromptMarker).
          const colon = prompt.indexOf("|");
          stepIdsObserved.push(colon < 0 ? prompt : prompt.slice(0, colon));
        },
      },
    });

    // Force the schemaManager getter to report `true` so the runner
    // propagates the flag on every iteration without exercising the
    // 2-strike abort rule (which would terminate before the fallback
    // cap). Mirrors the pattern used in runner-loop-integration_test.ts.
    // deno-lint-ignore no-explicit-any
    const sm = (h.runner as any).schemaManager;
    Object.defineProperty(sm, "schemaResolutionFailed", {
      get: () => true,
      configurable: true,
    });

    // Spy on `flowOrchestrator.setSchemaResolutionFailed(true)` to
    // anchor non-vacuity (i.e., the failure flag actually flowed into
    // the orchestrator at least once).
    // deno-lint-ignore no-explicit-any
    const fo = (h.runner as any).flowOrchestrator;
    const original = fo.setSchemaResolutionFailed.bind(fo);
    fo.setSchemaResolutionFailed = (failed: boolean) => {
      if (failed) schemaFailedSets++;
      original(failed);
    };

    h.runner.on("error", (payload) => {
      emittedErrors.push(payload.error);
    });

    const result = await h.run();

    // ----- Non-vacuity guards ------------------------------------------
    assert(
      schemaFailedSets >= 1,
      `non-vacuity: flowOrchestrator.setSchemaResolutionFailed(true) must fire ` +
        `at least once during the run (got ${schemaFailedSets}) ` +
        `| where: agents/runner/runner.ts:786-788 ` +
        `| how-to-fix: ensure schemaManager.schemaResolutionFailed reports true`,
    );
    assert(
      h.observations.length > 0,
      `non-vacuity: at least one iterationEnd snapshot must exist ` +
        `(got ${h.observations.length}) | where: harness iteration capture`,
    );

    // ----- (i) currentStepId stays pinned ------------------------------
    // Every prompt observation must target the same step id, proving
    // `flow-orchestrator.ts:208-215` did not advance currentStepId.
    for (let i = 0; i < stepIdsObserved.length; i++) {
      assertEquals(
        stepIdsObserved[i],
        STEP_ID,
        `(i) iteration ${
          i + 1
        }: stepId must remain "${STEP_ID}" while schemaResolutionFailed is true ` +
          `(observed "${stepIdsObserved[i]}") ` +
          `| where: agents/runner/flow-orchestrator.ts:208-215 (StepGate skip path) ` +
          `| how-to-fix: keep currentStepId unchanged when schemaResolutionFailed`,
      );
    }

    // ----- (ii) cursor never advanced ----------------------------------
    // The cursor emits `adaptation_advance` for every successful cursor++.
    // While schemaResolutionFailed is true, no `intent === "repeat"`
    // routing path runs (StepGate is skipped), so the cursor MUST stay
    // at position 0.
    const advances = h.cursorEvents.filter(
      (e) => e.message === "adaptation_advance",
    );
    assertEquals(
      advances.length,
      0,
      `(ii) cursor must not advance while schemaResolutionFailed is true ` +
        `(observed ${advances.length} adaptation_advance events) ` +
        `| where: agents/runner/adaptation-cursor.ts (next() emits adaptation_advance) ` +
        `| how-to-fix: ensure StepGate routing is skipped on schemaResolutionFailed so ` +
        `cursor.next() is never invoked`,
    );

    // ----- (iii) loop terminates at FALLBACK_MAX_ITERATIONS ------------
    // Source of truth: AGENT_LIMITS.FALLBACK_MAX_ITERATIONS — never
    // hardcode the numeric value here.
    assertEquals(
      result.iterations,
      AGENT_LIMITS.FALLBACK_MAX_ITERATIONS,
      `(iii) iterations must equal AGENT_LIMITS.FALLBACK_MAX_ITERATIONS ` +
        `(=${AGENT_LIMITS.FALLBACK_MAX_ITERATIONS}; got ${result.iterations}) ` +
        `| where: agents/runner/runner.ts:1162-1172 (getMaxIterations fallback) ` +
        `| how-to-fix: when verdict.config.maxIterations is undefined, ` +
        `getMaxIterations must return AGENT_LIMITS.FALLBACK_MAX_ITERATIONS`,
    );

    // The runner emits a single AgentMaxIterationsError on cap breach
    // (runner.ts:649-664). Use this as a corroborating contract — if the
    // run terminated for any other reason, this assertion would fail.
    const maxIterErrors = emittedErrors.filter((e) =>
      e instanceof AgentMaxIterationsError
    );
    assertEquals(
      maxIterErrors.length,
      1,
      `corroboration: exactly one AgentMaxIterationsError must be emitted ` +
        `(got ${maxIterErrors.length}) ` +
        `| where: agents/runner/runner.ts:649-664 ` +
        `| how-to-fix: ensure the cap-breach branch emits the error event exactly once`,
    );
    assertEquals(
      (maxIterErrors[0] as AgentMaxIterationsError).maxIterations,
      AGENT_LIMITS.FALLBACK_MAX_ITERATIONS,
      `error.maxIterations must equal the fallback constant ` +
        `(got ${
          (maxIterErrors[0] as AgentMaxIterationsError).maxIterations
        }) ` +
        `| where: agents/runner/errors.ts AgentMaxIterationsError ctor`,
    );
  },
);
