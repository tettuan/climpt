/**
 * Integration tests for `adaptationChain` end-to-end behavior
 * (T7 — user-implementation-independent verification).
 *
 * Source of truth (per `.claude/rules/test-design.md` and
 * `.claude/rules/docs-writing.md`):
 *   `tmp/audit-precheck-kind-loop/framework-design/01-self-route-termination.md`
 *   §2.4 / §2.5 / §3.1 / §3.2.
 *
 * Independence: this file builds a dummy `StepRegistry` in TypeScript
 * (no `.agent/` user fixture, no filesystem prompt files). The integration
 * sites under test are:
 *   - `WorkflowRouter` (non-closure `intent === "repeat"`) — public surface
 *   - `CompletionLoopProcessor` closure path (`action === "repeat"`) —
 *     exercised at the cursor advance + exhaustion point that the closure
 *     code path inlines (`completion-loop-processor.ts:213-224`).
 *
 * Driving the full LLM Flow Loop is out of scope; both integration sites
 * call `cursor.next(stepId, chain)` and convert the result identically.
 * Tests therefore drive (a) `WorkflowRouter.route(intent="repeat")` for the
 * non-closure path and (b) the equivalent cursor advance for the closure
 * path, asserting both paths reach the same exhaustion contract.
 *
 * Channel independence (Q3 = K1, design §3.3b): `validation-chain.ts`
 * makes no cursor calls. Verified structurally (grep) and asserted in a
 * smoke test below by grep-comparable absence of AdaptationCursor in
 * validation-chain — the runtime invariant is enforced by source code, not
 * by behavioral mock; the smoke test names this boundary explicitly.
 */

import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  AdaptationCursor,
  advanceClosureAdaptation,
} from "./adaptation-cursor.ts";
import { AgentAdaptationChainExhaustedError } from "../shared/errors/flow-errors.ts";
import { WorkflowRouter } from "./workflow-router.ts";
import type { GateInterpretation } from "./step-gate-interpreter.ts";
import { makeStep } from "../common/step-registry/test-helpers.ts";
import type { StepRegistry } from "../common/step-registry.ts";

// =============================================================================
// Dummy registry helpers — independent of `.agent/` user implementation.
// =============================================================================

/**
 * Build a minimal in-memory {@link StepRegistry} that declares one step.
 * No on-disk file is created — the cursor never reads C3L files; chain
 * elements are opaque labels at this layer (Boot validation S9 owns C3L
 * resolvability and is out of scope here).
 */
function dummyRegistryWithStep(
  stepId: string,
  options: {
    kind: "work" | "verification" | "closure";
    adaptationChain?: string[];
  },
): StepRegistry {
  return {
    agentId: "dummy-test-agent",
    version: "1.0.0",
    c1: "steps",
    steps: {
      [stepId]: makeStep({
        stepId,
        kind: options.kind,
        address: {
          c1: "steps",
          c2: options.kind === "closure" ? "closure" : "initial",
          c3: "issue",
          edition: "default",
        },
        ...(options.adaptationChain !== undefined
          ? { adaptationChain: options.adaptationChain }
          : {}),
      }),
    },
  };
}

/**
 * Build a `GateInterpretation` for a given intent. Co-located with router
 * tests (workflow-router_test.ts) — same pattern, terse fixture.
 */
function interp(
  overrides: Partial<GateInterpretation>,
): GateInterpretation {
  return {
    intent: "next",
    usedFallback: false,
    ...overrides,
  };
}

/**
 * Closure-path advance — delegates to the shared production helper
 * `advanceClosureAdaptation` (`adaptation-cursor.ts`). The same
 * function backs the closure code path in
 * `completion-loop-processor.ts`, so this test exercises the EXACT
 * production code (no mirror, no drift).
 */
function closurePathAdvance(
  cursor: AdaptationCursor,
  stepId: string,
  chain: string[] | undefined,
): { adaptation: string } {
  return advanceClosureAdaptation(cursor, stepId, chain);
}

// =============================================================================
// Scenario 1: cursor advance × full chain → exhaustion (non-closure path)
// =============================================================================

Deno.test(
  "Scenario 1a (non-closure): repeat intent walks chain in order then throws AgentAdaptationChainExhaustedError",
  () => {
    const stepId = "initial.issue";
    const chain = ["default", "step1", "step2"];
    const registry = dummyRegistryWithStep(stepId, {
      kind: "work",
      adaptationChain: chain,
    });
    const cursor = new AdaptationCursor();
    const router = new WorkflowRouter(registry, undefined, cursor);

    // Walk the chain one element per repeat. Source of truth = `chain`
    // itself; assertions index into `chain` rather than hardcoding strings.
    for (let i = 0; i < chain.length; i++) {
      const result = router.route(stepId, interp({ intent: "repeat" }));
      assertEquals(
        result.repeatAdaptation,
        chain[i],
        `repeat #${i + 1}: expected repeatAdaptation="${
          chain[i]
        }" (chain[${i}]) | where: WorkflowRouter.route(repeat) | how-to-fix: ensure router calls cursor.next which returns chain[currentPosition] then advances`,
      );
      assertEquals(
        result.signalClosing,
        false,
        `repeat must not signal closing | where: WorkflowRouter.route(repeat)`,
      );
      assertEquals(
        result.nextStepId,
        stepId,
        `repeat keeps nextStepId pointing to current step | where: WorkflowRouter.route(repeat)`,
      );
    }

    // (chain.length + 1)-th repeat must throw with the last-declared adaptation.
    const lastAdaptation = chain[chain.length - 1];
    const err = assertThrows(
      () => router.route(stepId, interp({ intent: "repeat" })),
      AgentAdaptationChainExhaustedError,
    );
    assertStrictEquals(
      err.stepId,
      stepId,
      `error.stepId must match the exhausted step | where: WorkflowRouter.advanceRepeatCursor`,
    );
    assertStrictEquals(
      err.chainLength,
      chain.length,
      `error.chainLength must equal declared chain length=${chain.length} | where: WorkflowRouter.advanceRepeatCursor`,
    );
    assertStrictEquals(
      err.lastAdaptation,
      lastAdaptation,
      `error.lastAdaptation must equal chain[chain.length-1]="${lastAdaptation}" | where: WorkflowRouter.advanceRepeatCursor`,
    );
    // Error code derived from design doc §2.4 — same source-of-truth as
    // adaptation-cursor_test.ts to avoid divergence.
    assertStrictEquals(
      err.code,
      "AGENT_ADAPTATION_CHAIN_EXHAUSTED",
      `error.code must be the design-doc constant | where: flow-errors.ts`,
    );
    assertStrictEquals(
      err.recoverable,
      false,
      `error.recoverable must be false (terminal → blocked phase per §4.3)`,
    );
  },
);

Deno.test(
  "Scenario 1b (closure path): same cursor instance produces same exhaustion contract",
  () => {
    // Closure steps never reach WorkflowRouter; they advance via
    // `completion-loop-processor.ts:213-224`. The advance is performed on
    // the same `AdaptationCursor` instance so closure + non-closure
    // observations of the same step share state. Here we exercise the
    // closure inline via `closurePathAdvance` (helper at top of file).
    const stepId = "closure.issue";
    const chain = ["default", "narrow-scope", "emit-handoff"];
    const cursor = new AdaptationCursor();

    for (let i = 0; i < chain.length; i++) {
      const r = closurePathAdvance(cursor, stepId, chain);
      assertEquals(
        r,
        { adaptation: chain[i] },
        `closure repeat #${i + 1}: expected chain[${i}]="${
          chain[i]
        }" | where: completion-loop-processor.ts:213-224 | how-to-fix: closure code path must mirror the non-closure cursor.next contract`,
      );
    }

    const lastAdaptation = chain[chain.length - 1];
    const err = assertThrows(
      () => closurePathAdvance(cursor, stepId, chain),
      AgentAdaptationChainExhaustedError,
    );
    assertStrictEquals(err.stepId, stepId);
    assertStrictEquals(err.chainLength, chain.length);
    assertStrictEquals(err.lastAdaptation, lastAdaptation);
  },
);

Deno.test(
  "Scenario 1c (cross-path identity): non-closure router and closure path share one cursor instance",
  () => {
    // Per design §3.2 the runner owns a single `AdaptationCursor` instance
    // shared by `WorkflowRouter` and `CompletionLoopProcessor`. Mixing
    // closure and non-closure repeats on the same stepId must therefore
    // observe one cursor advance per call, not two parallel cursors.
    //
    // (In practice closure and non-closure live on different stepIds
    // because step kind is per-step, but the structural contract — single
    // cursor instance — is what we verify here. We use one stepId to make
    // the shared-state observation explicit.)
    const stepId = "shared.step";
    const chain = ["a", "b"];
    const cursor = new AdaptationCursor();
    const registry = dummyRegistryWithStep(stepId, {
      kind: "work",
      adaptationChain: chain,
    });
    const router = new WorkflowRouter(registry, undefined, cursor);

    // Advance via the router (non-closure path) — cursor moves 0 → 1.
    const r1 = router.route(stepId, interp({ intent: "repeat" }));
    assertEquals(r1.repeatAdaptation, chain[0]);

    // Advance via the closure path — same cursor must read chain[1].
    const r2 = closurePathAdvance(cursor, stepId, chain);
    assertEquals(
      r2,
      { adaptation: chain[1] },
      `cross-path: 2nd repeat (closure) must read chain[1]="${
        chain[1]
      }" because router already consumed chain[0] | where: shared cursor instance | how-to-fix: keep one AdaptationCursor instance per AgentRunner`,
    );

    // 3rd repeat (either path) must exhaust.
    assertThrows(
      () => router.route(stepId, interp({ intent: "repeat" })),
      AgentAdaptationChainExhaustedError,
    );
  },
);

// =============================================================================
// Scenario 2: cursor reset on forward progress
// =============================================================================

Deno.test(
  "Scenario 2: forward-progress intent (next/jump/handoff/escalate/closing) resets cursor for outgoing step",
  () => {
    // Per design §2.2, "异 step 遷移 / 异 intent 遷移" both reset the cursor
    // for the outgoing stepId. The router calls `cursor.reset(currentStepId)`
    // on every forward-progress branch.
    const s1 = "s1";
    const s2 = "s2";
    const chainS1 = ["a", "b", "c"];
    const cursor = new AdaptationCursor();
    const registry: StepRegistry = {
      agentId: "dummy-test-agent",
      version: "1.0.0",
      c1: "steps",
      steps: {
        [s1]: makeStep({
          stepId: s1,
          kind: "work",
          address: {
            c1: "steps",
            c2: "initial",
            c3: "issue",
            edition: "default",
          },
          adaptationChain: chainS1,
          transitions: { next: { target: s2 } },
        }),
        [s2]: makeStep({
          stepId: s2,
          kind: "work",
          address: {
            c1: "steps",
            c2: "continuation",
            c3: "issue",
            edition: "default",
          },
        }),
      },
    };
    const router = new WorkflowRouter(registry, undefined, cursor);

    // Advance s1 by one repeat → cursor for s1 = 1.
    const repeat1 = router.route(s1, interp({ intent: "repeat" }));
    assertEquals(repeat1.repeatAdaptation, chainS1[0]);

    // Now route s1 → s2 via `next` (forward progress). Per §2.2 the cursor
    // for s1 resets to 0.
    const next1 = router.route(s1, interp({ intent: "next" }));
    assertEquals(next1.nextStepId, s2);

    // Re-enter s1 and emit repeat again. If reset worked, the cursor reads
    // chainS1[0]="a" again (not chainS1[1]="b").
    const repeat2 = router.route(s1, interp({ intent: "repeat" }));
    assertEquals(
      repeat2.repeatAdaptation,
      chainS1[0],
      `re-entry into s1 after forward-progress reset must read chain[0]="${
        chainS1[0]
      }" again | where: WorkflowRouter.resolveFromTransitions cursor.reset call | how-to-fix: ensure forward-progress branches call cursor.reset(currentStepId)`,
    );
  },
);

Deno.test(
  "Scenario 2b: jump intent also resets cursor for outgoing step",
  () => {
    const s1 = "s1";
    const s2 = "s2";
    const chainS1 = ["x", "y"];
    const cursor = new AdaptationCursor();
    const registry: StepRegistry = {
      agentId: "dummy-test-agent",
      version: "1.0.0",
      c1: "steps",
      steps: {
        [s1]: makeStep({
          stepId: s1,
          kind: "work",
          address: {
            c1: "steps",
            c2: "initial",
            c3: "issue",
            edition: "default",
          },
          adaptationChain: chainS1,
        }),
        [s2]: makeStep({
          stepId: s2,
          kind: "work",
          address: {
            c1: "steps",
            c2: "continuation",
            c3: "issue",
            edition: "default",
          },
        }),
      },
    };
    const router = new WorkflowRouter(registry, undefined, cursor);

    // Advance s1 once.
    router.route(s1, interp({ intent: "repeat" }));
    // Jump out of s1.
    router.route(s1, interp({ intent: "jump", target: s2 }));
    // Re-enter s1 — cursor must be back to position 0.
    const result = router.route(s1, interp({ intent: "repeat" }));
    assertEquals(
      result.repeatAdaptation,
      chainS1[0],
      `jump must reset cursor for outgoing stepId | where: WorkflowRouter.route(jump) | how-to-fix: ensure jump branch calls cursor.reset(currentStepId)`,
    );
  },
);

// =============================================================================
// Scenario 3: log events (deferred — boundary documented)
// =============================================================================

/**
 * In-memory log capture sink conforming to AdaptationCursorLogSink. We
 * implement the sink locally rather than spinning up a real Logger because
 * the source-of-truth for §2.5 is the design doc field shape — recording
 * (level, message, fields) tuples lets the test assert the exact contract
 * without relying on filesystem or JSONL plumbing (test-design rule:
 * source of truth from import; no hardcoded magic strings).
 */
interface CapturedEvent {
  level: "debug" | "warn" | "error";
  message: string;
  data: Record<string, unknown> | undefined;
}

class CaptureSink {
  readonly events: CapturedEvent[] = [];
  debug(message: string, data?: Record<string, unknown>): void {
    this.events.push({ level: "debug", message, data });
  }
  warn(message: string, data?: Record<string, unknown>): void {
    this.events.push({ level: "warn", message, data });
  }
  error(message: string, data?: Record<string, unknown>): void {
    this.events.push({ level: "error", message, data });
  }
}

/**
 * Field shape declared in design §2.5. Co-located here as the source of
 * truth used by all field-shape assertions below.
 */
const REQUIRED_FIELDS = [
  "stepId",
  "fromAdaptation",
  "toAdaptation",
  "chainPosition",
  "chainLength",
  "agentRunId",
] as const;

function assertFieldShape(
  data: Record<string, unknown> | undefined,
  context: string,
): void {
  assert(
    data !== undefined,
    `${context}: event must carry structured fields | where: AdaptationCursor.next | how-to-fix: pass the AdaptationLogFields object as the second arg to the sink call`,
  );
  for (const key of REQUIRED_FIELDS) {
    assert(
      Object.prototype.hasOwnProperty.call(data, key),
      `${context}: missing field "${key}" | where: §2.5 field shape | how-to-fix: include "${key}" in the structured event payload`,
    );
  }
}

Deno.test(
  "Scenario 3a (active): adaptation_advance fires on every cursor++ with §2.5 field shape",
  () => {
    // Per design §2.5: `adaptation_advance` (debug) fires on every cursor++.
    // Source of truth = design doc table; assertions index into the chain
    // itself rather than hardcoding event counts.
    const stepId = "step-3a";
    const chain = ["a", "b", "c"];
    const agentRunId = "run-3a";
    const sink = new CaptureSink();
    const cursor = new AdaptationCursor();
    cursor.setLogSink(sink, agentRunId);

    for (let i = 0; i < chain.length; i++) {
      cursor.next(stepId, chain);
    }

    const advances = sink.events.filter((e) =>
      e.message === "adaptation_advance"
    );
    assertEquals(
      advances.length,
      chain.length,
      `expected ${chain.length} adaptation_advance events (one per cursor++) | where: AdaptationCursor.next | how-to-fix: emit adaptation_advance on every successful advance`,
    );

    // Every advance must be at debug level and carry the full §2.5 field
    // shape with the values derived from the chain itself (no magic strings).
    for (let i = 0; i < advances.length; i++) {
      const ev = advances[i];
      assertEquals(
        ev.level,
        "debug",
        `advance #${
          i + 1
        }: adaptation_advance must be debug-level per §2.5 | where: AdaptationCursor.next`,
      );
      assertFieldShape(ev.data, `advance #${i + 1}`);
      const data = ev.data as Record<string, unknown>;
      assertEquals(data.stepId, stepId, `advance #${i + 1}: stepId field`);
      assertEquals(
        data.toAdaptation,
        chain[i],
        `advance #${i + 1}: toAdaptation must equal chain[${i}]="${
          chain[i]
        }" | where: AdaptationCursor.next | how-to-fix: toAdaptation = chain[cursor]`,
      );
      assertEquals(
        data.fromAdaptation,
        i === 0 ? "<start>" : chain[i - 1],
        `advance #${
          i + 1
        }: fromAdaptation reflects prior chain element (or "<start>" at cursor=0)`,
      );
      assertEquals(
        data.chainPosition,
        i + 1,
        `advance #${i + 1}: chainPosition must equal post-advance position`,
      );
      assertEquals(
        data.chainLength,
        chain.length,
        `advance #${i + 1}: chainLength field`,
      );
      assertEquals(
        data.agentRunId,
        agentRunId,
        `advance #${
          i + 1
        }: agentRunId must equal the value passed to setLogSink`,
      );
    }
  },
);

Deno.test(
  "Scenario 3b (active): chain_threshold_warn fires once at cursor == ⌊chainLength/2⌋",
  () => {
    // Per design §2.5 (post-P1-4 fix): threshold = Math.floor(chainLength / 2).
    // Verify the three relevant arities: 4 → threshold 2, 3 → threshold 1,
    // 2 → threshold 1. chainLength=1 (floor → 0, never fires) is covered
    // in Scenario 3d as a non-firing case.
    const cases: Array<{ chain: string[]; threshold: number }> = [
      { chain: ["a", "b", "c", "d"], threshold: 2 },
      { chain: ["a", "b", "c"], threshold: 1 },
      { chain: ["a", "b"], threshold: 1 },
    ];

    for (const { chain, threshold } of cases) {
      const stepId = `step-3b-${chain.length}`;
      const sink = new CaptureSink();
      const cursor = new AdaptationCursor();
      cursor.setLogSink(sink, "run-3b");

      // Advance up to (and including) the threshold position.
      for (let i = 0; i < threshold; i++) {
        cursor.next(stepId, chain);
      }

      const warns = sink.events.filter((e) =>
        e.message === "chain_threshold_warn"
      );
      assertEquals(
        warns.length,
        1,
        `chainLength=${chain.length}: expected exactly 1 chain_threshold_warn after reaching cursor=${threshold} | where: AdaptationCursor.next | how-to-fix: emit threshold warn iff newPosition === Math.floor(chainLength/2)`,
      );
      assertEquals(
        warns[0].level,
        "warn",
        `chain_threshold_warn must be warn-level per §2.5`,
      );
      assertFieldShape(warns[0].data, `chainLength=${chain.length} threshold`);
      const data = warns[0].data as Record<string, unknown>;
      assertEquals(
        data.chainPosition,
        threshold,
        `threshold warn fires when chainPosition=⌊${chain.length}/2⌋=${threshold}`,
      );
      assertEquals(
        data.chainLength,
        chain.length,
        `threshold warn carries chainLength=${chain.length}`,
      );
      assertEquals(
        data.toAdaptation,
        chain[threshold - 1],
        `threshold warn's toAdaptation = chain[threshold-1] (the element just consumed)`,
      );

      // Continuing past threshold must NOT emit additional threshold warns
      // (single-shot per cursor advance crossing).
      for (let i = threshold; i < chain.length; i++) {
        cursor.next(stepId, chain);
      }
      const warnsAfter = sink.events.filter((e) =>
        e.message === "chain_threshold_warn"
      );
      assertEquals(
        warnsAfter.length,
        1,
        `chainLength=${chain.length}: threshold warn must not re-fire after first crossing | where: AdaptationCursor.next | how-to-fix: gate on newPosition === threshold (equality, not >=)`,
      );
    }
  },
);

Deno.test(
  "Scenario 3c (active): chain_exhausted fires BEFORE throw at cursor == chainLength",
  () => {
    // Per design §2.5: chain_exhausted (error) fires immediately before the
    // AgentAdaptationChainExhaustedError throw. Verify by capturing events
    // in a router test that exhausts the chain.
    const stepId = "step-3c";
    const chain = ["a", "b"];
    const sink = new CaptureSink();
    const cursor = new AdaptationCursor();
    cursor.setLogSink(sink, "run-3c");
    const registry = dummyRegistryWithStep(stepId, {
      kind: "work",
      adaptationChain: chain,
    });
    const router = new WorkflowRouter(registry, undefined, cursor);

    // Walk the full chain so the next call exhausts.
    for (let i = 0; i < chain.length; i++) {
      router.route(stepId, interp({ intent: "repeat" }));
    }

    // Snapshot event count just before the throw — we use this to prove
    // chain_exhausted is recorded BEFORE the error propagates.
    const eventsBeforeThrow = sink.events.length;

    assertThrows(
      () => router.route(stepId, interp({ intent: "repeat" })),
      AgentAdaptationChainExhaustedError,
    );

    // After the throw, exactly one new event must have been recorded — the
    // chain_exhausted event the cursor emitted before the integration site
    // threw. (No new adaptation_advance, no new threshold warn — the
    // exhausted branch returns "exhausted" without emitting either.)
    assertEquals(
      sink.events.length,
      eventsBeforeThrow + 1,
      `exactly 1 new event between pre-throw snapshot and post-throw observation | where: WorkflowRouter.advanceRepeatCursor + AdaptationCursor.next (exhausted branch) | how-to-fix: emit chain_exhausted exactly once on the exhausted branch (internal to next())`,
    );
    const exhausted = sink.events[sink.events.length - 1];
    assertEquals(
      exhausted.message,
      "chain_exhausted",
      `last event must be chain_exhausted (the throw is preceded by the log)`,
    );
    assertEquals(
      exhausted.level,
      "error",
      `chain_exhausted must be error-level per §2.5`,
    );
    assertFieldShape(exhausted.data, "chain_exhausted");
    const data = exhausted.data as Record<string, unknown>;
    assertEquals(
      data.stepId,
      stepId,
      `chain_exhausted.stepId field`,
    );
    assertEquals(
      data.chainLength,
      chain.length,
      `chain_exhausted.chainLength field`,
    );
    assertEquals(
      data.chainPosition,
      chain.length,
      `chain_exhausted.chainPosition equals chainLength (terminal)`,
    );
    assertEquals(
      data.fromAdaptation,
      chain[chain.length - 1],
      `chain_exhausted.fromAdaptation = last successfully-read element`,
    );
    assertEquals(
      data.toAdaptation,
      "<exhausted>",
      `chain_exhausted.toAdaptation = "<exhausted>" sentinel per §2.5 convention`,
    );
  },
);

Deno.test(
  "Scenario 3d (active): chainLength=1 — threshold warn never fires (default safe-by-default), exhausted on the next call",
  () => {
    // Per design §2.5 + §E.1 (post-P1-4 fix): threshold = Math.floor(1/2) = 0,
    // and newPosition starts at 1, so chainLength=1 emits NO threshold warn.
    // This honors §E.1's "safe-by-default" framing for the default chain
    // `["default"]` — every default-chain step would otherwise emit a noisy
    // warn-level event on every repeat. Only adaptation_advance fires on
    // the single advance that consumes the chain. chain_exhausted fires on
    // the *next* call (the second repeat) immediately before the throw.
    const stepId = "step-3d";
    const chain = ["only"];
    const sink = new CaptureSink();
    const cursor = new AdaptationCursor();
    cursor.setLogSink(sink, "run-3d");

    // First advance: consumes chain[0]. Threshold is floor(1/2)=0 so warn
    // does NOT fire — the default chain is silent on the threshold channel.
    cursor.next(stepId, chain);

    assertEquals(
      sink.events.length,
      1,
      `chainLength=1 first advance: expected 1 event (advance only, no threshold warn) | where: AdaptationCursor.next | how-to-fix: emit adaptation_advance, but skip chain_threshold_warn because Math.floor(1/2) === 0`,
    );
    assertEquals(
      sink.events[0].message,
      "adaptation_advance",
      `chainLength=1 first advance: only adaptation_advance fires | where: AdaptationCursor.next`,
    );
    // Confirm no threshold warn was emitted.
    assertEquals(
      sink.events.filter((e) => e.message === "chain_threshold_warn").length,
      0,
      `chainLength=1: chain_threshold_warn must NOT fire (Math.floor(1/2)=0 unreachable from newPosition>=1) | where: AdaptationCursor.next | how-to-fix: keep Math.floor formula so default ["default"] chains are silent on the threshold channel (§E.1 safe-by-default)`,
    );
    assertEquals(
      sink.events.filter((e) => e.message === "chain_exhausted").length,
      0,
      `chain_exhausted must NOT fire on the call that consumes the last element; it fires on the *next* call (cursor returns kind: "exhausted") | where: AdaptationCursor.next exhausted branch`,
    );

    // Second call: cursor returns the exhausted variant and emits
    // chain_exhausted internally before returning. The closure-path helper
    // converts that into the throw — mirroring real use.
    const eventsBeforeExhaust = sink.events.length;
    assertThrows(
      () => closurePathAdvance(cursor, stepId, chain),
      AgentAdaptationChainExhaustedError,
    );
    assertEquals(
      sink.events.length,
      eventsBeforeExhaust + 1,
      `closure-path exhaustion records exactly 1 event (chain_exhausted) before throw`,
    );
    assertEquals(
      sink.events[sink.events.length - 1].message,
      "chain_exhausted",
      `chain_exhausted is the recorded event preceding the closure-path throw`,
    );
  },
);

// =============================================================================
// Scenario 4: empty chain & 1-element chain (non-vacuity)
// =============================================================================

Deno.test(
  "Scenario 4a (non-vacuity): empty adaptationChain throws on first repeat (non-closure)",
  () => {
    // Per design §3.1 + cursor contract: empty chain returns "exhausted"
    // immediately. The non-closure router converts that to
    // AgentAdaptationChainExhaustedError with chainLength=0.
    const stepId = "initial.issue";
    const cursor = new AdaptationCursor();
    const registry = dummyRegistryWithStep(stepId, {
      kind: "work",
      adaptationChain: [],
    });
    const router = new WorkflowRouter(registry, undefined, cursor);

    const err = assertThrows(
      () => router.route(stepId, interp({ intent: "repeat" })),
      AgentAdaptationChainExhaustedError,
    );
    assertStrictEquals(
      err.chainLength,
      0,
      `empty chain → chainLength=0 | where: WorkflowRouter.advanceRepeatCursor`,
    );
    // Per §3.2 the lastAdaptation falls back to "default" for a 0-length
    // chain — the framework's structural minimum (§2.3).
    assertStrictEquals(
      err.lastAdaptation,
      "default",
      `0-length chain falls back to lastAdaptation="default" per §2.3 / §3.2`,
    );
  },
);

Deno.test(
  'Scenario 4b (Q1=B framework default): 1-element chain ["default"] reads once then throws on second repeat',
  () => {
    // Per design §2.3 (Q1 = B): registry author's structural minimum.
    // First repeat reads chain[0]="default" successfully, second repeat
    // exhausts. This is the contract that lets registry authors ship a
    // "no longer-recovery declared" step without unbounded repeat.
    const stepId = "initial.issue";
    const chain = ["default"];
    const cursor = new AdaptationCursor();
    const registry = dummyRegistryWithStep(stepId, {
      kind: "work",
      adaptationChain: chain,
    });
    const router = new WorkflowRouter(registry, undefined, cursor);

    // 1st repeat: success.
    const r1 = router.route(stepId, interp({ intent: "repeat" }));
    assertEquals(
      r1.repeatAdaptation,
      chain[0],
      `1-element chain: 1st repeat reads chain[0]="${
        chain[0]
      }" | where: WorkflowRouter.advanceRepeatCursor`,
    );

    // 2nd repeat: exhausted.
    const err = assertThrows(
      () => router.route(stepId, interp({ intent: "repeat" })),
      AgentAdaptationChainExhaustedError,
    );
    assertStrictEquals(err.chainLength, chain.length);
    assertStrictEquals(err.lastAdaptation, chain[0]);
  },
);

Deno.test(
  'Scenario 4c (default behavior): undefined adaptationChain defaults to ["default"] (Q1=B safe-by-default)',
  () => {
    // Per design §2.3 (Q1 = B): when a step omits `adaptationChain`, the
    // framework treats it as `["default"]`. Verifies the implicit default
    // matches the explicit `["default"]` declaration in 4b.
    const stepId = "initial.issue";
    const cursor = new AdaptationCursor();
    const registry = dummyRegistryWithStep(stepId, {
      kind: "work",
      // adaptationChain intentionally omitted — Q1=B default applies.
    });
    const router = new WorkflowRouter(registry, undefined, cursor);

    // 1st repeat: success on implicit "default".
    const r1 = router.route(stepId, interp({ intent: "repeat" }));
    assertEquals(
      r1.repeatAdaptation,
      "default",
      `undefined chain → ["default"] (§2.3) → 1st repeat reads "default"`,
    );

    // 2nd repeat: exhausted.
    const err = assertThrows(
      () => router.route(stepId, interp({ intent: "repeat" })),
      AgentAdaptationChainExhaustedError,
    );
    assertStrictEquals(err.chainLength, 1, `default chain length is 1`);
    assertStrictEquals(err.lastAdaptation, "default");
  },
);

// =============================================================================
// Scenario 5: orchestrator → blocked phase egress (deferred)
// =============================================================================

Deno.test(
  "Scenario 5 (deferred): orchestrator routes AgentAdaptationChainExhaustedError to blocked phase",
  () => {
    // Per design §4.3: AgentAdaptationChainExhaustedError is
    // ExecutionError-class and must route the issue to `blocked` phase
    // via IssueCloseFailedEvent.
    //
    // BOUNDARY: orchestrator-level routing of this error is verified in
    // orchestrator integration tests (when added). This file scopes to
    // T7 (cursor + error contract at the runner integration sites). The
    // structural egress contract — that the error is `ExecutionError`-
    // shaped (recoverable=false, code=AGENT_ADAPTATION_CHAIN_EXHAUSTED) —
    // is asserted in Scenario 1a above.
    //
    // Documentation pin for discoverability.
    const err = new AgentAdaptationChainExhaustedError("s", 1, "x");
    assertStrictEquals(
      err.recoverable,
      false,
      `error must be terminal so orchestrator routes to blocked (per §4.3)`,
    );
    assertStrictEquals(
      err.code,
      "AGENT_ADAPTATION_CHAIN_EXHAUSTED",
      `error code is the orchestrator's routing key`,
    );
  },
);

// =============================================================================
// Channel-independence smoke test (Q3 = K1, design §3.3b)
// =============================================================================

Deno.test(
  "Channel independence (Q3=K1): validation-chain has no cursor coupling (structural)",
  async () => {
    // Per design §3.3b (Q3 = K1): `failurePatterns` (validator-driven
    // retry) and `adaptationChain` (LLM-driven `intent=repeat`) are
    // independent channels. The cursor must NOT advance on
    // validator-driven retries.
    //
    // The runtime invariant is enforced structurally: `validation-chain.ts`
    // contains zero references to `AdaptationCursor`. We assert this by
    // reading the source file and checking for the symbol — a behavioral
    // mock would be weaker because validation-chain's retry path can be
    // changed without breaking a behavioral assertion that happens to
    // miss the new code path. Reading the source is the source-of-truth.
    const url = new URL("./validation-chain.ts", import.meta.url);
    const source = await Deno.readTextFile(url);
    assertEquals(
      source.includes("AdaptationCursor"),
      false,
      `validation-chain.ts must not reference AdaptationCursor (Q3=K1 channel independence) | where: agents/runner/validation-chain.ts | how-to-fix: keep validator-driven retries on the validation-chain channel; never call cursor.next from validator code`,
    );
    assertEquals(
      source.includes("adaptation-cursor"),
      false,
      `validation-chain.ts must not import adaptation-cursor module | where: agents/runner/validation-chain.ts`,
    );
  },
);

// =============================================================================
// Contract test: closure-path advance is the production helper (P1-5)
// =============================================================================

Deno.test(
  "Contract (P1-5): closurePathAdvance is the production helper, behaviorally",
  () => {
    // P1-5 contract: the literal-grep contract test is replaced with a
    // behavioral assertion. The test-side `closurePathAdvance` (above)
    // delegates to the production `advanceClosureAdaptation` helper
    // co-located with `AdaptationCursor`. This exercises the EXACT
    // production code that `CompletionLoopProcessor.runClosureLoop`
    // also calls — so contract drift is impossible by construction.
    //
    // What we verify behaviorally:
    //   (a) Q1 = B default — `chain === undefined` resolves to one
    //       advance (`adaptation === "default"`) then exhausts on the
    //       next call. This is the closure-path semantics for steps
    //       that omit `adaptationChain`.
    //   (b) `chain_exhausted` event fires immediately before the throw
    //       (timeline ordering — §2.5).
    //   (c) The thrown error class is `AgentAdaptationChainExhaustedError`
    //       and carries the chain length / last adaptation as
    //       constructor-supplied invariants.
    const stepId = "closure.contract";
    const sink = new CaptureSink();
    const cursor = new AdaptationCursor();
    cursor.setLogSink(sink, "run-contract");

    // (a) First call with undefined chain returns "default" (Q1=B).
    const first = closurePathAdvance(cursor, stepId, undefined);
    assertEquals(
      first.adaptation,
      "default",
      `(a) Q1=B default: undefined chain must resolve to "default" on first advance | where: advanceClosureAdaptation in adaptation-cursor.ts | how-to-fix: keep ["default"] as the chain when undefined`,
    );

    // (b) and (c): second call exhausts. chain_exhausted must precede throw.
    const eventsBeforeThrow = sink.events.length;
    const err = assertThrows(
      () => closurePathAdvance(cursor, stepId, undefined),
      AgentAdaptationChainExhaustedError,
    );
    // Source-of-truth: read fields from the thrown error itself.
    assertEquals(
      err.stepId,
      stepId,
      `(c) error.stepId must equal the exhausted step | where: AgentAdaptationChainExhaustedError ctor`,
    );
    assertEquals(
      err.chainLength,
      1,
      `(c) error.chainLength must equal default chain length=1 | where: advanceClosureAdaptation`,
    );
    assertEquals(
      err.lastAdaptation,
      "default",
      `(c) error.lastAdaptation must equal "default" (single-element default chain) | where: advanceClosureAdaptation`,
    );

    // (b) chain_exhausted MUST be the most recent event (precedes throw).
    const newEvents = sink.events.slice(eventsBeforeThrow);
    assertEquals(
      newEvents.length,
      1,
      `(b) exactly 1 event must fire on the exhausted call | where: AdaptationCursor.next emits chain_exhausted before returning the exhausted variant; advanceClosureAdaptation throws after | how-to-fix: keep the emit-then-return-then-throw ordering`,
    );
    assertEquals(
      newEvents[0].message,
      "chain_exhausted",
      `(b) the pre-throw event must be chain_exhausted | where: §2.5 ordering invariant`,
    );
    assertEquals(
      newEvents[0].level,
      "error",
      `(b) chain_exhausted must be error-level per §2.5`,
    );
  },
);
