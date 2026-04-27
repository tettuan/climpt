/**
 * `BoundaryClose` (channel id `"E"`) — observes
 * `ClosureBoundaryReached` and closes the subject when the closure-step
 * verdict resolves to a Close action.
 *
 * Per channels/00 §A row 4 + §B, BoundaryClose fires only on the
 * CompletionLoop sub-driver (FlowLoop never publishes
 * `ClosureBoundaryReached` — design 16 §H anti-list). Mode-invariant
 * by R5 hard gate.
 *
 * Design refs:
 *  - To-Be `agents/docs/design/realistic/tobe/channels/43-channel-E.md`
 *    §A (state machine), §D (full table), §F (responsibility).
 *  - Realistic `channels/00-realistic-binding.md` §A row 4.
 *
 * PR4-3 status:
 *  - The verdict adapter's private `closeIssue` (verdict/external-state-
 *    adapter.ts:383-421) is migrated here. The adapter now drives this
 *    channel via {@link handleBoundary}; direct `gh issue close` shell-
 *    out is gone (W2 acceptance — no direct gh CLI from a verdict
 *    adapter).
 *  - `decide` reads the snapshotted `ChannelContext` and returns
 *    `shouldClose` iff the close action is "close" or "label-and-close"
 *    AND a subjectId is present. Label-only branches stay outside this
 *    channel — they are handled by the adapter's `updateLabels` call
 *    site (no close-write involved).
 *  - `execute` invokes `closeTransport.close(subjectId)`. Success
 *    publishes `IssueClosedEvent(channel: "E")`; failure publishes
 *    `IssueCloseFailedEvent(channel: "E")` and rethrows so the adapter
 *    can decide whether to swallow (the adapter currently does — close
 *    failure is non-fatal for the closure step).
 *
 * @module
 */

import type { CloseEventBus, Unsubscribe } from "../events/bus.ts";
import type {
  ClosureBoundaryReachedEvent,
  EventKind,
} from "../events/types.ts";
import type { SubjectRef } from "../orchestrator/workflow-types.ts";
import type { CloseTransport } from "../transports/close-transport.ts";
import type { Channel, ChannelContext, ChannelDecision } from "./types.ts";
import { createChannelContext } from "./types.ts";

const SUBSCRIBES_TO: ReadonlyArray<EventKind> = ["closureBoundaryReached"];

export class BoundaryCloseChannel
  implements Channel<ClosureBoundaryReachedEvent> {
  readonly id = "E" as const;
  readonly subscribesTo = SUBSCRIBES_TO;

  /** Close-write seam captured at boot (PR4-2a). See `direct-close.ts`. */
  readonly #closeTransport: CloseTransport;
  /**
   * Bus reference captured at boot. `execute` publishes
   * `IssueClosedEvent` / `IssueCloseFailedEvent` (channel "E") here so
   * subscribers (CompensationCommentChannel, OutboxClosePost,
   * CascadeClose) see the close fact in real time.
   */
  readonly #bus: CloseEventBus;
  /** Stable correlation id (BootArtifacts.runId). */
  readonly #runId: string;
  #unsubscribe: Unsubscribe | null = null;

  constructor(deps: {
    readonly closeTransport: CloseTransport;
    readonly bus: CloseEventBus;
    readonly runId: string;
  }) {
    this.#closeTransport = deps.closeTransport;
    this.#bus = deps.bus;
    this.#runId = deps.runId;
  }

  register(bus: CloseEventBus): void {
    if (this.#unsubscribe !== null) return;
    this.#unsubscribe = bus.subscribe<ClosureBoundaryReachedEvent>(
      { kind: "closureBoundaryReached" },
      (_event) => {
        // Observation seat reserved for R5 traceability test (T4.7).
        // The verdict adapter drives decide/execute via
        // `handleBoundary`.
      },
    );
  }

  /**
   * Pure decision function — same `ctx` ⇒ same `ChannelDecision`.
   *
   * Guards (To-Be 43 §A / §D), evaluated short-circuit:
   *  1. `event.subjectId !== undefined` — boundary fires on a specific
   *     subject. The adapter always supplies it.
   *  2. `outcomeMatch === true` — pre-computed `ClosureAction ∈ {close,
   *     label-and-close}` predicate. The publisher (adapter) sets this
   *     true only when the resolved closure action implies a close
   *     write; label-only branches publish `ClosureBoundaryReached`
   *     with `outcomeMatch === false` (or omit it) so this channel
   *     skips.
   *
   * Every Skip carries a short reason for diagnostic readability; no
   * caller branches on the string.
   */
  decide(
    ctx: ChannelContext<ClosureBoundaryReachedEvent>,
  ): ChannelDecision {
    const subjectId = ctx.event.subjectId;
    if (subjectId === undefined) {
      return {
        kind: "skip",
        reason: "BoundaryClose: ClosureBoundaryReached has no subjectId",
      };
    }
    if (ctx.outcomeMatch !== true) {
      return {
        kind: "skip",
        reason: "BoundaryClose: resolved ClosureAction does not imply a close",
      };
    }
    return { kind: "shouldClose", subjectId };
  }

  /**
   * Execute a {@link ChannelDecision}.
   *
   *  - `skip` → no-op.
   *  - `shouldClose` → `transport.close(subjectId)`. Success publishes
   *    `IssueClosedEvent(channel: "E")`; failure publishes
   *    `IssueCloseFailedEvent(channel: "E", reason)` and rethrows.
   */
  async execute(decision: ChannelDecision): Promise<void> {
    if (decision.kind !== "shouldClose") return;
    try {
      await this.#closeTransport.close(decision.subjectId);
      this.#bus.publish({
        kind: "issueClosed",
        publishedAt: Date.now(),
        runId: this.#runId,
        subjectId: decision.subjectId,
        channel: "E",
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      this.#bus.publish({
        kind: "issueCloseFailed",
        publishedAt: Date.now(),
        runId: this.#runId,
        subjectId: decision.subjectId,
        channel: "E",
        reason,
      });
      throw cause;
    }
  }

  /**
   * Verdict-adapter entry point — synchronous decide + execute pair.
   *
   * Wraps a synthetic `ClosureBoundaryReached` payload into a frozen
   * `ChannelContext`, runs `decide`, and (on `shouldClose`) `execute`.
   * Returns `true` iff the close transport ran successfully.
   *
   * The adapter is free to swallow execute errors — it currently does
   * (close failure is non-fatal for the closure step). Errors are
   * propagated by the channel so future call sites can inspect them
   * before deciding to swallow.
   */
  async handleBoundary(
    subjectId: SubjectRef,
    agentId: string,
    stepId: string,
  ): Promise<boolean> {
    const event: ClosureBoundaryReachedEvent = {
      kind: "closureBoundaryReached",
      publishedAt: Date.now(),
      runId: this.#runId,
      subjectId,
      agentId,
      stepId,
    };
    const ctx = createChannelContext<ClosureBoundaryReachedEvent>({
      event,
      // Boundary-driven close has a structural primary `boundary`; the
      // verdict adapter is the one that decided the closure action, so
      // outcomeMatch is `true` (the adapter only invokes this method
      // when the resolved action implies a close write).
      closeBinding: { primary: { kind: "boundary" }, cascade: false },
      outcomeMatch: true,
    });
    const decision = this.decide(ctx);
    if (decision.kind !== "shouldClose") return false;
    await this.execute(decision);
    return true;
  }
}
