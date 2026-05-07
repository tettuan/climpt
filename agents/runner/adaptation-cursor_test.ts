/**
 * Tests for AdaptationCursor (`adaptation-cursor.ts`) and
 * `AgentAdaptationChainExhaustedError` (`agents/shared/errors/flow-errors.ts`).
 *
 * Source of truth (per `.claude/rules/test-design.md`):
 * - Design doc:
 *   `tmp/audit-precheck-kind-loop/framework-design/01-self-route-termination.md`
 *   §2.4 (error contract) and §3.1 (cursor API).
 *
 * Tests cover the 5 branches of `AdaptationCursor.next` plus error class
 * structural assertions. Expected error messages are derived from the same
 * template as the implementation to avoid hardcoded magic strings. The
 * `AdvanceResult` discriminated union is imported from production so the
 * `kind` literal is type-checked rather than inlined.
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import { AdaptationCursor, type AdvanceResult } from "./adaptation-cursor.ts";
import { AgentAdaptationChainExhaustedError } from "../shared/errors/flow-errors.ts";
import { ClimptError } from "../shared/errors/base.ts";

/**
 * Source-of-truth for the `kind` discriminator literals — derived from the
 * production type via `AdvanceResult["kind"]` so a rename in production
 * forces a corresponding rename here (no inlined magic strings).
 */
const ADVANCED: AdvanceResult["kind"] = "advanced";
const EXHAUSTED: AdvanceResult["kind"] = "exhausted";

/**
 * Derive the expected error message from the same template as the
 * implementation. Co-located with the constructor in design doc §2.4 so
 * any divergence is a contract change reviewed jointly.
 */
function expectedExhaustedMessage(
  stepId: string,
  chainLength: number,
  lastAdaptation: string,
): string {
  return `Step "${stepId}" exhausted adaptation chain (length ${chainLength}, last: "${lastAdaptation}"). Self-route limit reached.`;
}

Deno.test("AdaptationCursor", async (t) => {
  await t.step(
    "cursor advances through chain in declared order, then exhausts",
    () => {
      // Branch 1: cursor advance
      // Per §3.1, repeated `next(stepId, chain)` reads chain[0], chain[1], ...
      // and returns `kind: "exhausted"` once cursor reaches chain.length.
      const cursor = new AdaptationCursor();
      const chain = ["a", "b", "c"];
      const stepId = "step1";

      for (let i = 0; i < chain.length; i++) {
        const result = cursor.next(stepId, chain);
        assertEquals(
          result,
          { kind: ADVANCED, adaptation: chain[i] },
          `position ${i}: expected adaptation "${
            chain[i]
          }" at cursor=${i} | where: AdaptationCursor.next | how-to-fix: ensure cursor reads chain[currentPosition] then increments`,
        );
      }

      // After chain is fully read, next call must return the exhausted
      // variant carrying the last adaptation and chain length.
      const after = cursor.next(stepId, chain);
      assertEquals(
        after,
        {
          kind: EXHAUSTED,
          lastAdaptation: chain[chain.length - 1],
          chainLength: chain.length,
        },
        `expected kind: "exhausted" with chain-end metadata once cursor reaches chain.length=${chain.length} | where: AdaptationCursor.next | how-to-fix: return { kind: "exhausted", lastAdaptation: chain[chain.length-1], chainLength: chain.length } when stored cursor >= chain.length`,
      );
    },
  );

  await t.step(
    "reset(stepId) only affects the targeted step, leaves other cursors intact",
    () => {
      // Branch 2: reset(stepId) isolation
      // Per §3.1, `reset(stepId)` brings only the named step's cursor to 0.
      const cursor = new AdaptationCursor();
      const chain1 = ["a1", "a2", "a3"];
      const chain2 = ["b1", "b2", "b3"];

      cursor.next("step1", chain1); // -> a1, cursor=1
      cursor.next("step1", chain1); // -> a2, cursor=2
      cursor.next("step2", chain2); // -> b1, cursor=1

      cursor.reset("step1");

      assertEquals(
        cursor.next("step1", chain1),
        { kind: ADVANCED, adaptation: chain1[0] },
        `after reset("step1"), next must read chain[0]="${
          chain1[0]
        }" | where: AdaptationCursor.reset | how-to-fix: ensure reset deletes the cursor entry so default 0 applies`,
      );

      assertEquals(
        cursor.next("step2", chain2),
        { kind: ADVANCED, adaptation: chain2[1] },
        `step2 cursor must NOT be reset by reset("step1"); expected chain[1]="${
          chain2[1]
        }" | where: AdaptationCursor.reset | how-to-fix: reset must delete only the keyed entry, never iterate the map`,
      );
    },
  );

  await t.step(
    "resetAll() returns every cursor to position 0",
    () => {
      // Branch 3: resetAll()
      // Per §2.2, resetAll is invoked at the entry of a new run/dispatch.
      const cursor = new AdaptationCursor();
      const chainA = ["a0", "a1", "a2"];
      const chainB = ["b0", "b1", "b2"];

      cursor.next("stepA", chainA); // cursor=1
      cursor.next("stepA", chainA); // cursor=2
      cursor.next("stepB", chainB); // cursor=1

      cursor.resetAll();

      assertEquals(
        cursor.next("stepA", chainA),
        { kind: ADVANCED, adaptation: chainA[0] },
        `after resetAll(), stepA must read chain[0]="${
          chainA[0]
        }" | where: AdaptationCursor.resetAll | how-to-fix: ensure resetAll clears the entire map`,
      );
      assertEquals(
        cursor.next("stepB", chainB),
        { kind: ADVANCED, adaptation: chainB[0] },
        `after resetAll(), stepB must read chain[0]="${
          chainB[0]
        }" | where: AdaptationCursor.resetAll | how-to-fix: ensure resetAll clears the entire map`,
      );
    },
  );

  await t.step(
    "empty chain returns exhausted immediately and writes no cursor entry",
    () => {
      // Branch 4: non-vacuity contract
      // Per §3.1, an empty chain has no readable adaptation; the cursor
      // returns the exhausted variant without writing a map entry. Verify
      // by confirming a subsequent non-empty call still reads chain[0].
      // Per §2.3 / §3.2, the empty-chain `lastAdaptation` is `"default"`
      // (framework structural minimum).
      const cursor = new AdaptationCursor();

      const result = cursor.next("stepEmpty", []);
      assertEquals(
        result,
        { kind: EXHAUSTED, lastAdaptation: "default", chainLength: 0 },
        `empty chain must return exhausted with lastAdaptation="default" (§2.3 / §3.2) and chainLength=0 without advancing | where: AdaptationCursor.next (empty-chain branch) | how-to-fix: short-circuit when chain.length === 0`,
      );

      const followup = cursor.next("stepEmpty", ["only"]);
      assertEquals(
        followup,
        { kind: ADVANCED, adaptation: "only" },
        `after empty-chain exhausted, a non-empty chain must still start at chain[0] (no stale cursor entry written) | where: AdaptationCursor.next | how-to-fix: do not call #cursors.set on the empty-chain branch`,
      );
    },
  );

  await t.step(
    "same stepId with a different chain reads chain[currentCursor] (caller responsibility)",
    () => {
      // Branch 5: chain identity is caller's responsibility
      // Per §3.1, the cursor stores only stepId → position. It does not
      // verify that the chain passed across calls is the same array.
      const cursor = new AdaptationCursor();

      assertEquals(
        cursor.next("step1", ["a"]),
        { kind: ADVANCED, adaptation: "a" },
        `first call reads chain[0]="a" | where: AdaptationCursor.next | how-to-fix: cursor 0 must read first element`,
      );

      // Second call with a DIFFERENT chain. Cursor is at 1, so it reads
      // ["x", "y"][1] = "y". The cursor knows nothing about chain identity;
      // the caller is responsible for either:
      //   (a) passing the same chain across repeats, or
      //   (b) calling reset(stepId) on chain change.
      assertEquals(
        cursor.next("step1", ["x", "y"]),
        { kind: ADVANCED, adaptation: "y" },
        `cursor=1 reads chain[1]="y" of the newly-passed chain (caller responsibility per §3.1) | where: AdaptationCursor.next | how-to-fix: this asserts the documented boundary; if caller wants chain[0] of the new chain, caller must reset`,
      );
    },
  );

  await t.step(
    "exhaustion via prior-cursor-overflow returns chain[chain.length-1] as lastAdaptation",
    () => {
      // Targeted assertion of the cursor-overflow branch (cursor >= chain.length).
      // After draining a chain, the next call's exhausted variant must carry
      // the chain end as `lastAdaptation`.
      const cursor = new AdaptationCursor();
      const chain = ["alpha", "beta"];
      cursor.next("s", chain);
      cursor.next("s", chain);

      const exhausted = cursor.next("s", chain);
      assertEquals(
        exhausted,
        {
          kind: EXHAUSTED,
          lastAdaptation: chain[chain.length - 1],
          chainLength: chain.length,
        },
        `cursor overflow: exhausted variant carries chain[chain.length-1] as lastAdaptation and chainLength | where: AdaptationCursor.next overflow branch`,
      );
    },
  );
});

Deno.test("AgentAdaptationChainExhaustedError", async (t) => {
  await t.step("extends ClimptError", () => {
    const error = new AgentAdaptationChainExhaustedError("s", 1, "x");
    assertEquals(
      error instanceof ClimptError,
      true,
      `AgentAdaptationChainExhaustedError must extend ClimptError per design doc §2.4 | where: flow-errors.ts | how-to-fix: ensure 'extends ClimptError' in class declaration`,
    );
    assertEquals(
      error instanceof Error,
      true,
      `must be a subclass of Error (transitively via ClimptError) | where: flow-errors.ts | how-to-fix: ensure ClimptError extends Error`,
    );
  });

  await t.step("code is the design doc constant", () => {
    // Per §2.4, code MUST equal "AGENT_ADAPTATION_CHAIN_EXHAUSTED" verbatim.
    const error = new AgentAdaptationChainExhaustedError("s", 1, "x");
    assertStrictEquals(
      error.code,
      "AGENT_ADAPTATION_CHAIN_EXHAUSTED",
      `code must match design doc §2.4 verbatim | where: flow-errors.ts | how-to-fix: keep readonly code = "AGENT_ADAPTATION_CHAIN_EXHAUSTED"`,
    );
  });

  await t.step("recoverable is false (terminal)", () => {
    // Per §2.4 + §4.3, this error is unrecoverable (issue → blocked).
    const error = new AgentAdaptationChainExhaustedError("s", 1, "x");
    assertStrictEquals(
      error.recoverable,
      false,
      `recoverable must be false per design doc §2.4 (terminal: issue → blocked) | where: flow-errors.ts | how-to-fix: keep readonly recoverable = false`,
    );
  });

  await t.step(
    "message contains stepId, chainLength, and lastAdaptation",
    () => {
      const stepId = "closure-step-7";
      const chainLength = 3;
      const lastAdaptation = "narrow-scope";
      const error = new AgentAdaptationChainExhaustedError(
        stepId,
        chainLength,
        lastAdaptation,
      );

      assertEquals(
        error.message,
        expectedExhaustedMessage(stepId, chainLength, lastAdaptation),
        `message template must match design doc §2.4 verbatim | where: flow-errors.ts AgentAdaptationChainExhaustedError constructor | how-to-fix: keep super(\`Step "\${stepId}" exhausted adaptation chain (length \${chainLength}, last: "\${lastAdaptation}"). Self-route limit reached.\`)`,
      );
    },
  );

  await t.step("toJSON exposes stepId, chainLength, lastAdaptation", () => {
    const stepId = "step-x";
    const chainLength = 5;
    const lastAdaptation = "fallback";
    const error = new AgentAdaptationChainExhaustedError(
      stepId,
      chainLength,
      lastAdaptation,
    );
    const json = error.toJSON();

    assertEquals(
      json.stepId,
      stepId,
      `toJSON must expose stepId | where: flow-errors.ts toJSON override | how-to-fix: spread super.toJSON() and add stepId field`,
    );
    assertEquals(
      json.chainLength,
      chainLength,
      `toJSON must expose chainLength | where: flow-errors.ts toJSON override | how-to-fix: add chainLength to returned object`,
    );
    assertEquals(
      json.lastAdaptation,
      lastAdaptation,
      `toJSON must expose lastAdaptation | where: flow-errors.ts toJSON override | how-to-fix: add lastAdaptation to returned object`,
    );
    assertEquals(
      json.code,
      "AGENT_ADAPTATION_CHAIN_EXHAUSTED",
      `toJSON must include parent 'code' field via spread | where: flow-errors.ts toJSON override | how-to-fix: spread ...super.toJSON()`,
    );
    assertEquals(
      json.recoverable,
      false,
      `toJSON must include parent 'recoverable' field via spread | where: flow-errors.ts toJSON override | how-to-fix: spread ...super.toJSON()`,
    );
  });

  await t.step("preserves cause and iteration via options", () => {
    const cause = new Error("root cause");
    const iteration = 7;
    const error = new AgentAdaptationChainExhaustedError(
      "s",
      2,
      "x",
      { cause, iteration },
    );

    assertStrictEquals(
      error.cause,
      cause,
      `cause must propagate to Error.cause via super(message, { cause }) | where: ClimptError constructor | how-to-fix: pass options through to super`,
    );
    assertStrictEquals(
      error.iteration,
      iteration,
      `iteration must be stored on the error via ClimptError constructor | where: ClimptError constructor | how-to-fix: ensure options.iteration is forwarded to super`,
    );
  });
});
