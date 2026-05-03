/**
 * TC-G7 — Validation retry layer is orthogonal to the adaptation cursor.
 *
 * Invariant under test (Conformance, IF/THEN):
 *   IF post-LLM format validation fails on iteration N (so the runner sets
 *      `pendingRetryPrompt` and iteration N+1 consumes it),
 *   THEN the adaptation cursor for the same step is NOT advanced — i.e.
 *        no `adaptation_advance` telemetry event is emitted across the
 *        validation-retry sequence.
 *
 * This proves the two retry layers are orthogonal: validation-chain
 * (format / postLLMConditions) drives `pendingRetryPrompt`, while the
 * adaptation cursor advances only on a successful `intent === "repeat"`
 * routing decision (workflow-router.ts:148). A regression that piggybacks
 * cursor advance onto a validation retry would fail this contract.
 *
 * Source-of-truth citations:
 *   - agents/runner/validation-chain.ts:115-126 (Phase 2 format validation
 *     produces `retryPrompt`).
 *   - agents/runner/runner.ts:602-603 (`pendingRetryPrompt = result.retryPrompt`
 *     on closure path).
 *   - agents/runner/completion-loop-processor.ts:317-325 (closure-step
 *     iteration consumes pendingRetryPrompt → uses as next prompt).
 *   - agents/runner/workflow-router.ts:143-155 (intent === "repeat" branch:
 *     the only path that advances the cursor).
 *
 * Validator-bypass note (mandatory):
 *   This test drives the REAL validator. The harness is extended to
 *   construct an actual `ValidationChain` (no mocked `validateConditions`)
 *   and the failure-inducing summary contains assistantResponses that
 *   lack the JSON code block expected by `format-validator.ts:74-103`.
 *   The validator is `agents/loop/format-validator.ts` (FormatValidator
 *   #validateJson) — invoked by `validation-chain.ts:108-126` whenever
 *   `stepConfig.outputSchema` is defined.
 *
 * Diagnosability:
 *   Each assertion cites the source-of-truth file:line. Non-vacuity
 *   pre-asserts that validation actually retried at least once (otherwise
 *   the cursor non-advance assertion passes trivially with no validation
 *   ever firing).
 */

import { assert, assertEquals } from "@std/assert";
import { makeRunnerHarness } from "./harness.ts";
import { makeStep } from "../../common/step-registry/test-helpers.ts";
import type { ExtendedStepsRegistry } from "../../common/validation-types.ts";
import type { IterationSummary } from "../../src_common/types.ts";
import { ValidationChain } from "../validation-chain.ts";
import type { Logger } from "../../src_common/logger.ts";

const RUNNER_TS = "agents/runner/runner.ts";
const ROUTER_TS = "agents/runner/workflow-router.ts";
const VALIDATION_TS = "agents/runner/validation-chain.ts";

// Verdict type "count:iteration" maps to closure step id "closure.iteration"
// per ValidationChain.VERDICT_CLOSURE_MAP (validation-chain.ts:171-180). The
// harness uses verdict.type "count:iteration" by default, so the test step
// id is bound to that mapping — do NOT hardcode a different name.
const STEP_ID = "closure.iteration";

const ADAPTATION_CHAIN: readonly string[] = ["a"];

/**
 * Output schema requiring a `next_action.action` enum + `outcome` string.
 * The format validator extracts JSON from ```json``` code blocks in
 * `summary.assistantResponses`; a response without that block fails with
 * "No JSON block found" (format-validator.ts:107). A response WITH the
 * block but missing required fields fails schema validation.
 *
 * The schema below is the source-of-truth for what counts as "valid" in
 * iteration 3 — derived once and consumed in both the registry config
 * (drives the validator) and the iteration-3 assistantResponses construction.
 */
const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["next_action", "outcome"],
  properties: {
    next_action: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["closing", "repeat"] },
      },
    },
    outcome: { type: "string" },
  },
};

function makeRegistry(): ExtendedStepsRegistry {
  return {
    agentId: "validation-retry-orthogonality",
    version: "1.0.0",
    c1: "steps",
    entryStep: STEP_ID,
    steps: {
      [STEP_ID]: makeStep({
        stepId: STEP_ID,
        kind: "closure",
        address: {
          c1: "steps",
          c2: "closure",
          c3: "iteration",
          edition: "default",
        },
        adaptationChain: ADAPTATION_CHAIN,
        structuredGate: {
          allowedIntents: ["closing", "repeat"],
          intentField: "next_action.action",
          intentSchemaRef:
            "#/definitions/closure.iteration/properties/next_action/properties/action",
          failFast: false,
        },
      }),
    },
    // ValidationChain looks up the step config here keyed by closure step id.
    // The presence of `outputSchema` triggers FormatValidator on every
    // iteration's summary (validation-chain.ts:108-126).
    validationSteps: {
      [STEP_ID]: {
        stepId: STEP_ID,
        c2: "closure",
        c3: "iteration",
        preflightConditions: [],
        postLLMConditions: [],
        onFailure: { action: "retry", maxAttempts: 5 },
        outputSchema: OUTPUT_SCHEMA,
      },
    },
  } as unknown as ExtendedStepsRegistry;
}

/** Summary that fails format validation (no ```json``` code block). */
function failingSummary(iteration: number): IterationSummary {
  return {
    iteration,
    sessionId: "sess-validation-retry",
    // No JSON code block in the response — format validator returns
    // "No JSON block found" (format-validator.ts:107).
    assistantResponses: [
      "Plain text without any JSON block, deliberately failing format validation.",
    ],
    toolsUsed: [],
    errors: [],
    // structuredOutput is set so flow orchestration sees it, but the
    // FormatValidator only inspects assistantResponses for the JSON block
    // — the validator never reads structuredOutput. This summary therefore
    // exercises the real validator.
    structuredOutput: {
      stepId: STEP_ID,
      next_action: { action: "repeat", reason: "force-repeat-pre-validation" },
    },
  };
}

/**
 * Summary that PASSES format validation. The `assistantResponses[0]`
 * contains a properly-fenced JSON block matching {@link OUTPUT_SCHEMA},
 * and `next_action.action === "closing"` so the closure step terminates
 * after the validator passes.
 */
function passingSummary(iteration: number): IterationSummary {
  const payload = {
    next_action: { action: "closing", reason: "validation passed" },
    outcome: "ok",
  };
  return {
    iteration,
    sessionId: "sess-validation-retry",
    assistantResponses: [
      "Validation now passes:\n```json\n" + JSON.stringify(payload) +
      "\n```\n",
    ],
    toolsUsed: [],
    errors: [],
    structuredOutput: {
      stepId: STEP_ID,
      ...payload,
    },
  };
}

Deno.test(
  "TC-G7: validation-chain retry does NOT advance the adaptation cursor",
  async () => {
    const h = makeRunnerHarness({
      stepsRegistry: makeRegistry(),
      scriptedSummaries: [
        failingSummary(1),
        failingSummary(2),
        passingSummary(3),
      ],
      // Bound iterations at 5 so a regression that loops forever is
      // bounded; expected termination is at iteration 3 via "closing".
      maxIterations: 5,
    });

    // Extend the harness's `initializeValidation` override to ALSO wire a
    // real `ValidationChain`. The harness's default override only sets
    // `stepsRegistry` + flow-routing components — it does not construct
    // ValidationChain (file paths bypassed). Without this extension,
    // `closureManager.validateConditions` returns `{ valid: true }` and
    // FormatValidator is never invoked (Validator-bypass anti-pattern).
    //
    // After this monkey-patch, `closureManager.validateConditions` calls
    // `validationChain.validate(stepId, summary)` which runs the REAL
    // FormatValidator (`agents/loop/format-validator.ts`).
    // deno-lint-ignore no-explicit-any
    const cm = (h.runner as any).closureManager;
    const baseInitialize = cm.initializeValidation;
    cm.initializeValidation = async (...args: unknown[]) => {
      // deno-lint-ignore no-explicit-any
      await baseInitialize.apply(cm, args as any);
      cm.validationChain = new ValidationChain({
        workingDir: "./logs/harness/cwd",
        // ValidationChain only calls .info/.warn/.debug. The runner does
        // not expose its own logger as a public field, so a no-op
        // logger satisfies the constructor contract.
        logger: createNoopLogger(),
        stepsRegistry: cm.stepsRegistry,
        stepValidator: null,
        retryHandler: null,
        agentId: "validation-retry-orthogonality",
      });
    };

    // Spy on `pendingRetryPrompt` writes to count actual validation
    // retries (non-vacuity backstop). The write site for the closure
    // path is runner.ts:603; the read+clear site for closure steps is
    // the CompletionLoopProcessor pendingRetryPrompt dep (set null at
    // completion-loop-processor.ts:322). We install a property
    // descriptor on the runner field that observes both sides.
    //
    // - retrySetCount  : non-null assignments (validation produced a prompt)
    // - retryConsumedCount : non-null → null transitions (consume site)
    let retrySetCount = 0;
    let retryConsumedCount = 0;
    {
      // deno-lint-ignore no-explicit-any
      const runnerAny = h.runner as any;
      let value: string | null = runnerAny.pendingRetryPrompt ?? null;
      Object.defineProperty(runnerAny, "pendingRetryPrompt", {
        configurable: true,
        get: () => value,
        set: (next: string | null) => {
          if (next !== null && value === null) retrySetCount++;
          if (next === null && value !== null) retryConsumedCount++;
          value = next;
        },
      });
    }

    await h.run();

    // ----- Non-vacuity: validation actually retried at least once -----
    // Without this guard, the cursor non-advance assertion below could
    // pass even if validation never ran (e.g., a regression that
    // silently disabled the format validator).
    assert(
      retrySetCount >= 1,
      `non-vacuity: validation must produce pendingRetryPrompt at least once ` +
        `during the run (got setCount=${retrySetCount}, consumed=${retryConsumedCount}). ` +
        `| where: ${VALIDATION_TS}:115-126 (FormatValidator failure) + ` +
        `${RUNNER_TS}:602-603 (retryPrompt → pendingRetryPrompt) ` +
        `| how-to-fix: confirm validationSteps[closure.iteration].outputSchema ` +
        `is wired and assistantResponses lack a JSON code block`,
    );
    // Also assert the runner consumed at least one retry prompt — proves
    // the consume site (CompletionLoopProcessor for closure steps; the
    // Flow Loop site at runner.ts:680-684 for non-closure steps) ran,
    // not just the produce site.
    assert(
      retryConsumedCount >= 1,
      `non-vacuity: runner must consume pendingRetryPrompt at least once ` +
        `(got ${retryConsumedCount}) ` +
        `| where: agents/runner/completion-loop-processor.ts:317-325 (closure path) ` +
        `or ${RUNNER_TS}:680-684 (Flow Loop path) ` +
        `| how-to-fix: ensure the post-failure iteration reads pendingRetryPrompt ` +
        `and resets it to null before LLM invocation`,
    );

    // ----- Cursor MUST NOT advance during validation retries ----------
    // Iteration 1 emits a failing summary (validation fails). Iteration 2
    // consumes the retry prompt, emits another failing summary. Iteration
    // 3 emits a passing summary with action="closing" → done. None of
    // these iterations exercise an `intent === "repeat"` routing path
    // that successfully reached cursor.next() — validation failure
    // returns BEFORE Stage 2.5 structured-signal check (the "repeat"
    // branch in completion-loop-processor.ts:219-227 only runs after
    // validation passes).
    //
    // Therefore: zero `adaptation_advance` events across the whole run.
    const advances = h.cursorEvents.filter(
      (e) => e.message === "adaptation_advance",
    );
    assertEquals(
      advances.length,
      0,
      `IF validation produced ${retrySetCount} retry prompt(s) and the ` +
        `runner consumed ${retryConsumedCount}, THEN cursor advances must ` +
        `remain 0 across the run (got ${advances.length}). ` +
        `| where: ${VALIDATION_TS}:325 (returns retryPrompt before Stage 2.5) + ` +
        `${ROUTER_TS}:215 (cursor.next called only on intent === "repeat") ` +
        `| how-to-fix: validation-chain retries must NOT trigger cursor.next() — ` +
        `the two retry layers are orthogonal`,
    );
  },
);

/**
 * Minimal Logger stand-in for ValidationChain construction. The
 * production-built runner-scoped logger is private and not reachable
 * from the test seam; a no-op implementation is sufficient because
 * ValidationChain uses the logger only for diagnostic info/warn/debug
 * calls (no behavioral coupling).
 */
function createNoopLogger(): Logger {
  const noop = () => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    log: () => Promise.resolve(),
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
    addContext: () => {},
    getLogPath: () => "./logs/harness/mock.log",
    logSdkMessage: () => {},
    setToolContext: () => {},
    clearToolContext: () => {},
  } as unknown as Logger;
}
