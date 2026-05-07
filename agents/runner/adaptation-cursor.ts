/**
 * AdaptationCursor - Self-route termination via C3L adaptation chain
 *
 * Per design doc `tmp/audit-precheck-kind-loop/framework-design/01-self-route-termination.md`
 * §3.1, this module provides a counter-based cursor that advances over a
 * declarative `adaptationChain: readonly string[]` for each `intent === "repeat"`
 * occurrence on a given step. When the cursor reaches `chain.length`, the
 * caller must terminate the run by throwing
 * `AgentAdaptationChainExhaustedError` (see `agents/shared/errors/flow-errors.ts`).
 *
 * Design principles (§1, §2.2):
 * - Framework guarantees self-route termination structurally (no opinionated
 *   numeric default; the chain length itself bounds repeats).
 * - Cursor scope is `stepId` only — `intent` is NOT part of the key. The
 *   cursor lives for the duration of an `AgentRunner` lifecycle (run scope).
 * - Reset triggers (§2.2): different-step transition, different-intent
 *   transition on same step, new run/dispatch (full reset).
 *
 * The cursor itself does not interpret `chain` semantics — it only tracks
 * position. Validating that `chain` elements resolve to C3L files is the
 * responsibility of Boot validation S9 (out of scope for this module).
 *
 * Observability (§2.5): on every successful advance, the cursor emits
 * structured log events through an injected sink:
 * - `adaptation_advance` (debug) — every cursor++.
 * - `chain_threshold_warn` (warn) — when the new cursor position equals
 *   `⌊chainLength/2⌋` (mid-chain warning).
 * - `chain_exhausted` (error) — emitted internally from {@link AdaptationCursor.next}
 *   on the exhausted branch (before returning the discriminated result).
 *   Both integration sites (router + closure path) therefore produce
 *   identical events without each having to call a separate emit method.
 */

// Type-only reference for JSDoc {@link} — avoids no-unused-vars on
// imports that exist purely for documentation links.
import type { Logger as _Logger } from "../src_common/logger.ts";
import { AgentAdaptationChainExhaustedError } from "../shared/errors/flow-errors.ts";

/**
 * Sink for the three structured log events declared in §2.5.
 *
 * The sink is intentionally typed against {@link Logger}'s minimal surface
 * (debug/warn/error with structured data) so any conforming logger can be
 * injected — the runner's per-agent `Logger` instance is the production
 * implementation.
 */
export interface AdaptationCursorLogSink {
  debug(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Field shape for the three §2.5 events. Matches the design doc table
 * verbatim so log analysis can match on a stable key set. The index
 * signature is required because the sink accepts `Record<string, unknown>`
 * — the named properties enforce the contract while the signature lets us
 * pass the value through without a cast.
 *
 * `agentRunId` is `undefined` for standalone runs (no runner-supplied
 * runId). The structured event still carries the key (so log filters can
 * see "missing" explicitly) — the sink renders `undefined` per its own
 * convention.
 */
export interface AdaptationLogFields {
  stepId: string;
  fromAdaptation: string;
  toAdaptation: string;
  chainPosition: number;
  chainLength: number;
  agentRunId: string | undefined;
  [key: string]: string | number | undefined;
}

/**
 * Discriminated result of {@link AdaptationCursor.next}. The `exhausted`
 * variant carries the data the caller needs to construct
 * `AgentAdaptationChainExhaustedError` — `lastAdaptation` is derived inside
 * the cursor (chain end, or `"default"` for the empty-chain §2.3 / §3.2
 * minimum), so callers do not re-derive it.
 */
export type AdvanceResult =
  | { kind: "advanced"; adaptation: string }
  | { kind: "exhausted"; lastAdaptation: string; chainLength: number };

export class AdaptationCursor {
  /**
   * Map from `stepId` to current cursor position.
   * Absent key means cursor=0 (initial state).
   * Per §2.2, `intent` is NOT part of the key — one cursor per step.
   */
  #cursors = new Map<string, number>();

  /**
   * Optional log sink (§2.5). When unset, `next` is silent — telemetry is
   * opt-in so unit tests and constructors that run before logger
   * initialization remain non-coupled to a logger instance.
   */
  #logSink: AdaptationCursorLogSink | undefined;

  /**
   * `agentRunId` carried into every emitted event's `agentRunId` field.
   * `undefined` when the runner has not received a `runId` (standalone runs).
   */
  #agentRunId: string | undefined = undefined;

  /**
   * Late-bind the §2.5 telemetry sink + agent run id. Called by the runner
   * after `Logger.create` resolves and `RunnerOptions.runId` is captured.
   * The setter is idempotent — repeated calls overwrite the prior wiring,
   * which lets a re-initializing runner refresh its sink without leaking
   * state.
   */
  setLogSink(
    sink: AdaptationCursorLogSink,
    agentRunId: string | undefined,
  ): void {
    this.#logSink = sink;
    this.#agentRunId = agentRunId;
  }

  /**
   * Test seam (P1-3 contract): exposes whether `setLogSink` has run.
   * Production code does not branch on this; the public read-only lets
   * runner-wiring contract tests assert that `AgentRunner.initialize`
   * actually called `setLogSink` without inspecting private fields.
   *
   * Returns `true` iff `setLogSink` has been called at least once with
   * a non-null sink. Independent of `agentRunId` (which may be `undefined`
   * for standalone runs by design).
   */
  get hasLogSink(): boolean {
    return this.#logSink !== undefined;
  }

  /**
   * Returns the adaptation at the current cursor position and advances cursor,
   * or signals exhaustion via the discriminated `AdvanceResult`.
   *
   * Behavior:
   * - If `chain.length === 0`: emits `chain_exhausted` and returns
   *   `{ kind: "exhausted", lastAdaptation: "default", chainLength: 0 }`.
   *   Per §2.3 / §3.2, the empty-chain fallback name is `"default"` (the
   *   framework's structural minimum). No cursor entry is written.
   * - If cursor `>= chain.length`: emits `chain_exhausted` and returns
   *   `{ kind: "exhausted", lastAdaptation: chain[chain.length - 1],
   *      chainLength: chain.length }`.
   * - Otherwise: reads `adaptation = chain[cursor]`, increments cursor by 1,
   *   emits `adaptation_advance` and (when threshold reached)
   *   `chain_threshold_warn`, returns `{ kind: "advanced", adaptation }`.
   *
   * Threshold rule: warn fires when post-advance cursor equals
   * `⌊chainLength/2⌋`. `Math.floor` (not `ceil`) keeps the warn strictly
   * midway for odd lengths and silences chainLength=1 entirely (floor
   * yields 0, never reachable since newPosition starts at 1). The
   * default chain `["default"]` (§E.1 safe-by-default) therefore emits
   * no threshold warn.
   *
   * Caller responsibility (§3.1): the cursor does not validate that `chain`
   * is the same array across successive calls for the same `stepId`. If the
   * caller passes different chains for the same stepId without `reset()`,
   * the cursor reads `chain[currentPosition]` of whatever chain was passed.
   * The caller converts an `exhausted` result into
   * `AgentAdaptationChainExhaustedError`; the cursor has already emitted
   * `chain_exhausted` so the timeline shows the diagnostic before the throw.
   */
  next(
    stepId: string,
    chain: readonly string[],
  ): AdvanceResult {
    if (chain.length === 0) {
      const lastAdaptation = "default";
      this.#emitExhausted(stepId, 0, lastAdaptation);
      return { kind: "exhausted", lastAdaptation, chainLength: 0 };
    }
    const cursor = this.#cursors.get(stepId) ?? 0;
    if (cursor >= chain.length) {
      const lastAdaptation = chain[chain.length - 1];
      this.#emitExhausted(stepId, chain.length, lastAdaptation);
      return {
        kind: "exhausted",
        lastAdaptation,
        chainLength: chain.length,
      };
    }
    const adaptation = chain[cursor];
    const newPosition = cursor + 1;
    this.#cursors.set(stepId, newPosition);

    // §2.5 event emission. `fromAdaptation` is the prior position's chain
    // element (or "<start>" when cursor was 0 — no prior adaptation read);
    // `toAdaptation` is the element just consumed.
    const fromAdaptation = cursor === 0 ? "<start>" : chain[cursor - 1];
    const fields: AdaptationLogFields = {
      stepId,
      fromAdaptation,
      toAdaptation: adaptation,
      chainPosition: newPosition,
      chainLength: chain.length,
      agentRunId: this.#agentRunId,
    };
    this.#logSink?.debug("adaptation_advance", fields);

    const threshold = Math.floor(chain.length / 2);
    if (newPosition === threshold) {
      this.#logSink?.warn("chain_threshold_warn", fields);
    }

    return { kind: "advanced", adaptation };
  }

  /**
   * Emit the `chain_exhausted` event (§2.5). Internal: invoked by `next`
   * on the two exhausted branches so the diagnostic precedes the
   * discriminated return (and therefore precedes the caller's throw).
   *
   * `chainPosition` and `chainLength` both equal `chainLength` on
   * exhaustion (terminal). `fromAdaptation` is the last successfully-read
   * element (the chain end, or `"default"` for empty chain). `toAdaptation`
   * is the §2.5 sentinel `"<exhausted>"` so log filters can pick out
   * terminal events without parsing chain length.
   */
  #emitExhausted(
    stepId: string,
    chainLength: number,
    lastAdaptation: string,
  ): void {
    const fields: AdaptationLogFields = {
      stepId,
      fromAdaptation: lastAdaptation,
      toAdaptation: "<exhausted>",
      chainPosition: chainLength,
      chainLength,
      agentRunId: this.#agentRunId,
    };
    this.#logSink?.error("chain_exhausted", fields);
  }

  /**
   * Reset cursor for a specific step. Call on:
   * - different-step transition (`prev step != current step`)
   * - different-intent transition on the same step (e.g. `repeat` → `next`)
   *
   * After reset, the next `next(stepId, ...)` call reads `chain[0]`.
   */
  reset(stepId: string): void {
    this.#cursors.delete(stepId);
  }

  /**
   * Reset all cursors. Call at the entry of a new run/dispatch
   * (per §2.2: "new run (new dispatch) → 全 reset").
   */
  resetAll(): void {
    this.#cursors.clear();
  }
}

/**
 * Closure-path adaptation advance — single source-of-truth for the
 * `action === "repeat"` branch in `CompletionLoopProcessor.runClosureLoop`
 * and the equivalent assertion site in
 * `adaptation-chain_integration_test.ts`.
 *
 * Behavior:
 * - `chain` undefined → defaults to `["default"]` (Q1 = B, design §2.3
 *   safe-by-default).
 * - cursor advance returns adaptation → returned to caller.
 * - cursor returns `kind: "exhausted"` → throw
 *   `AgentAdaptationChainExhaustedError`. The cursor has already emitted
 *   `chain_exhausted` (§2.5 ordering invariant: emit before throw).
 */
export function advanceClosureAdaptation(
  cursor: AdaptationCursor,
  stepId: string,
  chain: readonly string[] | undefined,
): { adaptation: string } {
  // Q1 = B (design §2.3) — undefined chain defaults to ["default"].
  const effectiveChain: readonly string[] = chain ?? ["default"];
  const result = cursor.next(stepId, effectiveChain);
  if (result.kind === "exhausted") {
    throw new AgentAdaptationChainExhaustedError(
      stepId,
      result.chainLength,
      result.lastAdaptation,
    );
  }
  return { adaptation: result.adaptation };
}
