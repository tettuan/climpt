/**
 * `DirectClose` (channel id `"D"`) — observes `TransitionComputed` and
 * closes the subject when the agent's `closeBinding.primary.kind ===
 * "direct"` and the transition lands on a terminal phase whose outcome
 * matches the close condition.
 *
 * Design refs:
 *  - To-Be `agents/docs/design/realistic/tobe/channels/41-channel-D.md`
 *    §A (decide), §C (transport), §D (full table), §F (responsibility).
 *  - Realistic `agents/docs/design/realistic/channels/00-realistic-binding.md`
 *    §A row 1 (D / `direct` / `TransitionComputed`).
 *  - W13 acceptance: failure compensation is **comment-only** via
 *    `IssueCloseFailedEvent` → `CompensationCommentChannel`. There is no
 *    label rollback at this seam; the orchestrator's saga rollback was
 *    deleted in PR4-2b.
 *
 * PR4-2b status:
 *  - `decide` reads the snapshotted `ChannelContext` (closeBinding,
 *    outcomeMatch, isTerminal pre-computed by the publisher) and returns
 *    `shouldClose` iff every guard passes. No live state read.
 *  - `execute` invokes `closeTransport.close(subjectId)`. On success,
 *    publishes `IssueClosedEvent(channel: "D")`. On transport throw,
 *    publishes `IssueCloseFailedEvent(channel: "D")` and rethrows so the
 *    orchestrator caller can decide whether to record the failure on the
 *    cycle (W13: cycle stays "completed"; close-fail is observable via
 *    bus event log only).
 *
 * The channel-side bus subscription is structural only — the orchestrator
 * drives `decide → execute` synchronously by calling
 * {@link DirectCloseChannel.handleTransition} after publishing
 * `TransitionComputed`. This preserves the synchronous knowledge the
 * orchestrator needs (post-close + sentinel-cascade still live in
 * orchestrator until PR4-3) while keeping the channel ADT pure.
 *
 * @module
 */

import type { CloseEventBus, Unsubscribe } from "../events/bus.ts";
import type { EventKind, TransitionComputedEvent } from "../events/types.ts";
import type { AgentRegistry } from "../boot/types.ts";
import type { CloseTransport } from "../transports/close-transport.ts";
import type { Channel, ChannelContext, ChannelDecision } from "./types.ts";
import { createChannelContext } from "./types.ts";

const SUBSCRIBES_TO: ReadonlyArray<EventKind> = ["transitionComputed"];

/**
 * `DirectClose` channel implementation (PR4-2b — real logic).
 */
export class DirectCloseChannel implements Channel<TransitionComputedEvent> {
  readonly id = "D" as const;
  readonly subscribesTo = SUBSCRIBES_TO;

  /**
   * Frozen agent registry — held for parity with sibling channels.
   * `decide` itself reads only the snapshotted `ChannelContext`, so the
   * registry is not consulted at decision time (purity invariant,
   * channels/types.ts §1).
   */
  readonly #agentRegistry: AgentRegistry;
  /**
   * Close-write seam injected at boot (PR4-2a). `execute` calls
   * `this.#closeTransport.close(subjectId)` exclusively — direct
   * `gh issue close` invocation is forbidden (P2 polarity, channels/00 §D).
   */
  readonly #closeTransport: CloseTransport;
  /**
   * Bus reference captured at boot. `execute` publishes
   * `IssueClosedEvent` / `IssueCloseFailedEvent` here so framework
   * subscribers (CompensationCommentChannel, OutboxClosePost,
   * CascadeClose) see the close fact in real time.
   */
  readonly #bus: CloseEventBus;
  /**
   * Stable correlation id for every event this channel publishes.
   * Threaded through from `BootArtifacts.runId` so subscribers /
   * diagnostic JSONL group events by boot.
   */
  readonly #runId: string;
  #unsubscribe: Unsubscribe | null = null;

  constructor(deps: {
    readonly agentRegistry: AgentRegistry;
    readonly closeTransport: CloseTransport;
    readonly bus: CloseEventBus;
    readonly runId: string;
  }) {
    this.#agentRegistry = deps.agentRegistry;
    this.#closeTransport = deps.closeTransport;
    this.#bus = deps.bus;
    this.#runId = deps.runId;
    void this.#agentRegistry;
  }

  /**
   * Subscribe to `TransitionComputed` on `bus`. Must be called inside
   * `BootKernel.boot` before `bus.freeze()` (Critique F1).
   *
   * The subscription is **observation only**. Orchestrator-side close
   * decisions are driven via the public {@link handleTransition} entry
   * point so the synchronous post-close work (still owned by
   * orchestrator until PR4-3) keeps deterministic ordering. Future PRs
   * may flip this to subscribe-driven once post-close + cascade are also
   * channel-resident.
   */
  register(bus: CloseEventBus): void {
    if (this.#unsubscribe !== null) return;
    this.#unsubscribe = bus.subscribe<TransitionComputedEvent>(
      { kind: "transitionComputed" },
      (_event) => {
        // Observation seat reserved for R5 traceability test (T4.7).
        // The orchestrator drives decide/execute via `handleTransition`.
      },
    );
  }

  /**
   * Pure decision function — same `ctx` ⇒ same `ChannelDecision`.
   *
   * Guards (To-Be 41 §B), evaluated short-circuit:
   *  1. `closeBinding.primary.kind === "direct"` — the agent declares
   *     the direct close path.
   *  2. `isTerminal === true` — the transition lands on a terminal
   *     phase. Pre-computed by the publisher.
   *  3. `outcomeMatch === true` — outcome satisfies `closeCondition`.
   *     Pre-computed by the publisher.
   *  4. `subjectId !== undefined` — the transition refers to a subject.
   *
   * Every Skip carries a short reason for diagnostic readability; no
   * caller branches on the string.
   */
  decide(ctx: ChannelContext<TransitionComputedEvent>): ChannelDecision {
    if (ctx.closeBinding.primary.kind !== "direct") {
      return {
        kind: "skip",
        reason: 'DirectClose: agent does not declare primary.kind === "direct"',
      };
    }
    if (ctx.event.isTerminal !== true) {
      return {
        kind: "skip",
        reason: "DirectClose: target phase is not terminal",
      };
    }
    if (ctx.outcomeMatch !== true) {
      return {
        kind: "skip",
        reason: "DirectClose: outcome does not match closeCondition",
      };
    }
    const subjectId = ctx.event.subjectId;
    if (subjectId === undefined) {
      return {
        kind: "skip",
        reason: "DirectClose: TransitionComputed has no subjectId",
      };
    }
    return { kind: "shouldClose", subjectId };
  }

  /**
   * Execute a {@link ChannelDecision}.
   *
   *  - `skip` → no-op.
   *  - `shouldClose` → `transport.close(subjectId)`. Success publishes
   *    `IssueClosedEvent(channel: "D")`; failure publishes
   *    `IssueCloseFailedEvent(channel: "D", reason)` and rethrows.
   *
   * Why rethrow: the orchestrator's caller (`handleTransition` below)
   * still owns the per-cycle post-close + sentinel-cascade work
   * (orchestrator.ts:1019-1140). It needs to skip those branches when
   * close didn't succeed. PR4-3 migrates that work to channels and the
   * rethrow can disappear.
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
        channel: "D",
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      this.#bus.publish({
        kind: "issueCloseFailed",
        publishedAt: Date.now(),
        runId: this.#runId,
        subjectId: decision.subjectId,
        channel: "D",
        reason,
      });
      throw cause;
    }
  }

  /**
   * Orchestrator-side entry point — synchronous decide + execute pair.
   *
   * Wraps the published `TransitionComputed` payload into a frozen
   * `ChannelContext`, runs `decide`, and (on `shouldClose`) `execute`.
   * Returns `true` iff the close transport ran successfully so the
   * caller can gate post-close work. Returns `false` for `skip` and
   * propagates `execute` errors verbatim.
   *
   * The orchestrator MUST publish `TransitionComputed` first (so the
   * bus event log is complete) and then invoke this method with the
   * same payload. The pair-call structure preserves W13's "close is
   * observable via bus" guarantee while letting the orchestrator
   * synchronously discover whether close succeeded.
   */
  async handleTransition(event: TransitionComputedEvent): Promise<boolean> {
    if (event.closeBinding === undefined) {
      // Publisher did not enrich the snapshot — pre-PR4-2b emission
      // path. Treat as skip; the channel cannot make a pure decision
      // without the closeBinding snapshot.
      return false;
    }
    const ctx = createChannelContext<TransitionComputedEvent>({
      event,
      closeBinding: event.closeBinding,
      outcomeMatch: event.outcomeMatch,
    });
    const decision = this.decide(ctx);
    if (decision.kind !== "shouldClose") return false;
    await this.execute(decision);
    return true;
  }
}
