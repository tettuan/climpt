/**
 * `OutboxClose-pre` (channel id `"C"`, `outboxPhase: "pre"`) — observes
 * `OutboxActionDecided` events filtered to the `pre` phase. The agent's
 * `closeBinding.primary.kind === "outboxPre"` selects this channel as
 * primary close path.
 *
 * Design refs:
 *  - To-Be `agents/docs/design/realistic/tobe/channels/42-channel-C.md`
 *    §A (decide), §C (Cpre subscriber), §G (1-line responsibility).
 *  - Realistic `channels/00-realistic-binding.md` §A row 2.
 *
 * Note on `ChannelId === "C"` sharing: both `OutboxClosePreChannel`
 * (this file) and `OutboxClosePostChannel` carry `id = "C"`. The closed
 * enum keeps 6 values; the publisher-side distinction lives on
 * `OutboxPhase` (`"pre"` here).
 *
 * PR4-3 status:
 *  - `decide` reads the snapshotted `ChannelContext` (the decoded
 *    OutboxAction + outboxPhase pre-baked by the publisher) and returns
 *    `shouldClose` iff every guard passes. No live state read.
 *  - `execute` invokes `closeTransport.close(subjectId)`. On success
 *    publishes `IssueClosedEvent(channel: "C", outboxPhase: "pre")`. On
 *    failure publishes `IssueCloseFailedEvent(channel: "C", outboxPhase:
 *    "pre")` and rethrows so the outbox-processor caller can decide
 *    whether to remove the action file or keep it for retry.
 *
 * The bus subscription is structural only (R5 traceability seat). The
 * outbox-processor drives `decide → execute` synchronously by calling
 * {@link OutboxClosePreChannel.handleCloseAction} after publishing
 * `OutboxActionDecided`. This preserves the synchronous knowledge the
 * processor needs (per-file success tracking — issue #486) while keeping
 * the channel ADT pure.
 *
 * @module
 */

import type { CloseEventBus, Unsubscribe } from "../events/bus.ts";
import type { EventKind, OutboxActionDecidedEvent } from "../events/types.ts";
import type { OutboxAction } from "../orchestrator/outbox-processor.ts";
import type { SubjectRef } from "../orchestrator/workflow-types.ts";
import type { CloseTransport } from "../transports/close-transport.ts";
import type { Channel, ChannelContext, ChannelDecision } from "./types.ts";
import { createChannelContext } from "./types.ts";

const SUBSCRIBES_TO: ReadonlyArray<EventKind> = ["outboxActionDecided"];

/**
 * `OutboxClose-pre` channel implementation (PR4-3 — real logic).
 */
export class OutboxClosePreChannel
  implements Channel<OutboxActionDecidedEvent> {
  readonly id = "C" as const;
  readonly subscribesTo = SUBSCRIBES_TO;

  /** Close-write seam captured at boot (PR4-2a). See `direct-close.ts`. */
  readonly #closeTransport: CloseTransport;
  /**
   * Bus reference captured at boot. `execute` publishes
   * `IssueClosedEvent` / `IssueCloseFailedEvent` (channel "C", outboxPhase
   * "pre") here so subscribers (CompensationCommentChannel,
   * OutboxClosePost, CascadeClose) see the close fact in real time.
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

  /**
   * Subscribe + filter on `event.outboxPhase === "pre"`. The bus's
   * `kind` filter narrows by event variant; the per-event `outboxPhase`
   * check stays inside the handler so the bus contract remains the
   * minimal kind filter (design 30 §C).
   *
   * The subscription is **observation only** (R5 traceability seat). The
   * outbox-processor drives decide+execute via `handleCloseAction` so
   * per-file success accounting stays deterministic.
   */
  register(bus: CloseEventBus): void {
    if (this.#unsubscribe !== null) return;
    this.#unsubscribe = bus.subscribe<OutboxActionDecidedEvent>(
      { kind: "outboxActionDecided" },
      (_event) => {
        // Observation seat reserved for R5 traceability test (T4.7).
        // The outbox-processor drives decide/execute via
        // `handleCloseAction`.
      },
    );
  }

  /**
   * Pure decision function — same `ctx` ⇒ same `ChannelDecision`.
   *
   * Guards (To-Be 42 §C), evaluated short-circuit:
   *  1. `event.outboxPhase === "pre"` — only fire on the pre phase.
   *  2. `event.action.action === "close-issue"` — only the close-issue
   *     OutboxAction triggers a close-write.
   *  3. `event.subjectId !== undefined` — the OutboxAction must carry
   *     a subject (the outbox-processor always supplies it).
   *
   * Every Skip carries a short reason for diagnostic readability; no
   * caller branches on the string.
   */
  decide(ctx: ChannelContext<OutboxActionDecidedEvent>): ChannelDecision {
    if (ctx.event.outboxPhase !== "pre") {
      return {
        kind: "skip",
        reason: 'OutboxClose-pre: outboxPhase is not "pre"',
      };
    }
    if (ctx.event.action.action !== "close-issue") {
      return {
        kind: "skip",
        reason: "OutboxClose-pre: action.kind is not close-issue",
      };
    }
    const subjectId = ctx.event.subjectId;
    if (subjectId === undefined) {
      return {
        kind: "skip",
        reason: "OutboxClose-pre: OutboxActionDecided has no subjectId",
      };
    }
    return { kind: "shouldClose", subjectId, outboxPhase: "pre" };
  }

  /**
   * Execute a {@link ChannelDecision}.
   *
   *  - `skip` → no-op.
   *  - `shouldClose` → `transport.close(subjectId)`. Success publishes
   *    `IssueClosedEvent(channel: "C", outboxPhase: "pre")`; failure
   *    publishes `IssueCloseFailedEvent(channel: "C", outboxPhase:
   *    "pre", reason)` and rethrows.
   *
   * Why rethrow: the outbox-processor caller needs to know whether to
   * remove the action file (issue #486 per-file success tracking).
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
        channel: "C",
        outboxPhase: "pre",
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      this.#bus.publish({
        kind: "issueCloseFailed",
        publishedAt: Date.now(),
        runId: this.#runId,
        subjectId: decision.subjectId,
        channel: "C",
        outboxPhase: "pre",
        reason,
      });
      throw cause;
    }
  }

  /**
   * Outbox-processor entry point — synchronous decide + execute pair.
   *
   * Wraps the published `OutboxActionDecided` payload into a frozen
   * `ChannelContext`, runs `decide`, and (on `shouldClose`) `execute`.
   * Returns `true` iff the close transport ran successfully so the
   * caller can remove the action file. Returns `false` for `skip` and
   * propagates `execute` errors verbatim.
   *
   * The outbox-processor MUST publish `OutboxActionDecided` first (so
   * the bus event log is complete) and then invoke this method with the
   * same payload. The pair-call structure preserves the per-file
   * success-tracking contract (issue #486) while letting the channel
   * own the close-write through `closeTransport`.
   *
   * The `closeBinding` parameter is the synthetic placeholder used for
   * outbox-driven closes — channels/types.ts requires every
   * ChannelContext to carry a closeBinding even when the close path is
   * outbox-pre rather than direct (the discriminator semantically lives
   * on the OutboxAction.kind, not the binding).
   */
  async handleCloseAction(
    subjectId: SubjectRef,
    action: OutboxAction,
  ): Promise<boolean> {
    const event: OutboxActionDecidedEvent = {
      kind: "outboxActionDecided",
      publishedAt: Date.now(),
      runId: this.#runId,
      subjectId,
      action,
      outboxPhase: "pre",
    };
    const ctx = createChannelContext<OutboxActionDecidedEvent>({
      event,
      // OutboxAction-driven close has no agent-declared CloseBinding —
      // the binding is structural ("outbox enqueued a close"). We pass a
      // synthetic `outboxPre` primary so the snapshot honours the
      // ChannelContext shape requirement.
      closeBinding: { primary: { kind: "outboxPre" }, cascade: false },
    });
    const decision = this.decide(ctx);
    if (decision.kind !== "shouldClose") return false;
    await this.execute(decision);
    return true;
  }
}
