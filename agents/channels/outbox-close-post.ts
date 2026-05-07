/**
 * `OutboxClose-post` (channel id `"C"`, `outboxPhase: "post"`) —
 * framework-only subscriber that chains off other channels' close
 * completions. Per channels/00 §A row 3, agent declarations do NOT
 * mention this channel; it auto-fires.
 *
 * Two subscription kinds (channels/00 §A):
 *  - `IssueClosedEvent` — fired after any other channel closes an
 *    issue. The post-close subscriber drains the queued post-close
 *    OutboxActions (comments, label updates, project removals) for
 *    the same subject.
 *  - `OutboxActionDecided` filtered by `outboxPhase === "post"` — the
 *    R5 traceability seat. The actual draining is driven synchronously
 *    by the orchestrator via {@link handlePostClose} so per-cycle
 *    ordering remains deterministic.
 *
 * Note on `ChannelId === "C"` sharing: see `outbox-close-pre.ts`
 * comment.
 *
 * PR4-3 status:
 *  - The orchestrator's inline `processPostClose(subjectId)` call site
 *    (orchestrator.ts:1004-1042) is migrated here. The orchestrator now
 *    invokes `handlePostClose(subjectId, store)` after a successful
 *    close instead of constructing an OutboxProcessor inline.
 *  - The post-close OutboxActions are NOT close-writes themselves —
 *    they are side-effects (comments, label updates, project
 *    removals). This channel does not call `closeTransport.close`; it
 *    runs the post-close outbox queue through the GitHubClient.
 *
 * @module
 */

import type { CloseEventBus, Unsubscribe } from "../events/bus.ts";
import type {
  EventKind,
  IssueClosedEvent,
  OutboxActionDecidedEvent,
} from "../events/types.ts";
import type { GitHubClient } from "../orchestrator/github-client.ts";
import type { SubjectStore } from "../orchestrator/subject-store.ts";
import type { CloseTransport } from "../transports/close-transport.ts";
import type { Channel, ChannelContext, ChannelDecision } from "./types.ts";
import { OutboxProcessor } from "../orchestrator/outbox-processor.ts";
import type { OutboxResult } from "../orchestrator/outbox-processor.ts";

/**
 * Two event kinds — see file header. The R5 traceability test inspects
 * this list to verify the (mode × channel) coverage matrix.
 */
const SUBSCRIBES_TO: ReadonlyArray<EventKind> = [
  "outboxActionDecided",
  "issueClosed",
];

/**
 * Discriminated event union accepted by `OutboxClose-post.decide`.
 * Narrower than the bus's full `Event` union — only the two variants
 * that {@link OutboxClosePostChannel.subscribesTo} declares.
 */
type OutboxClosePostEvent = OutboxActionDecidedEvent | IssueClosedEvent;

export class OutboxClosePostChannel implements Channel<OutboxClosePostEvent> {
  readonly id = "C" as const;
  readonly subscribesTo = SUBSCRIBES_TO;

  /**
   * Close-write seam captured at boot (PR4-2a). Held for parity with
   * sibling channels — post-close actions go through the GitHubClient
   * directly (comment/label/project) so the transport is not consulted
   * here. Retained on the instance so a future revision that
   * normalises post-close write-paths can route through it.
   */
  readonly #closeTransport: CloseTransport;
  /** GitHub seam consumed by post-close OutboxActions. */
  readonly #github: GitHubClient;
  /** Bus reference captured at boot (R5 traceability seat). */
  readonly #bus: CloseEventBus;
  /** Stable correlation id (BootArtifacts.runId). */
  readonly #runId: string;
  #unsubscribes: Unsubscribe[] = [];

  constructor(deps: {
    readonly closeTransport: CloseTransport;
    readonly github: GitHubClient;
    readonly bus: CloseEventBus;
    readonly runId: string;
  }) {
    this.#closeTransport = deps.closeTransport;
    this.#github = deps.github;
    this.#bus = deps.bus;
    this.#runId = deps.runId;
    void this.#closeTransport;
  }

  /**
   * Subscribe to both event kinds. Two `bus.subscribe` calls keep each
   * filter at the bus's native (kind-only) granularity; the per-event
   * `outboxPhase === "post"` check stays inside the handler.
   *
   * Both subscriptions are observation-only — the orchestrator drives
   * `handlePostClose` synchronously after a successful close so that
   * post-close ordering is preserved.
   */
  register(bus: CloseEventBus): void {
    if (this.#unsubscribes.length > 0) return;
    this.#unsubscribes.push(
      bus.subscribe<OutboxActionDecidedEvent>(
        { kind: "outboxActionDecided" },
        (event) => {
          if (event.outboxPhase !== "post") return;
          // Observation seat reserved for R5 traceability.
        },
      ),
      bus.subscribe<IssueClosedEvent>(
        { kind: "issueClosed" },
        (_event) => {
          // Observation seat reserved for R5 traceability.
        },
      ),
    );
  }

  /**
   * Pure decision function. OutboxClose-post never returns
   * `shouldClose` directly — its job is to drain the post-close outbox
   * (comments + label updates + project removals), NOT to close the
   * issue itself. The issue is already closed by the upstream channel
   * (D / Cpre / E / Cascade) that fired the IssueClosedEvent.
   *
   * Kept for the Channel ADT contract. The orchestrator drives the
   * side-effect drain via {@link handlePostClose}; this method exists
   * so the channel still satisfies the Channel<E> shape.
   */
  decide(_ctx: ChannelContext<OutboxClosePostEvent>): ChannelDecision {
    return {
      kind: "skip",
      reason:
        "OutboxClose-post: drains post-close outbox via handlePostClose; " +
        "no direct shouldClose decision",
    };
  }

  async execute(decision: ChannelDecision): Promise<void> {
    // OutboxClose-post never returns shouldClose from `decide`; the
    // post-close drain runs through `handlePostClose` instead. If a
    // future caller fabricates a shouldClose decision we still honour
    // the transport seam to keep the Channel contract consistent.
    if (decision.kind === "shouldClose") {
      await this.#closeTransport.close(decision.subjectId);
    }
  }

  /**
   * Drain the post-close outbox for `subjectId`.
   *
   * Called by the orchestrator after a successful close (any channel)
   * with the per-run `SubjectStore`. Constructs a fresh
   * `OutboxProcessor` bound to the boot bus + runId so the per-action
   * `OutboxActionDecided` events carry the same correlation id as the
   * upstream close.
   *
   * Returns the per-action results so the orchestrator can log
   * succeeded / failed counts. Failures inside post-close are
   * non-fatal: the close already happened.
   */
  async handlePostClose(
    subjectId: string | number,
    store: SubjectStore,
  ): Promise<OutboxResult[]> {
    const processor = new OutboxProcessor(
      this.#github,
      store,
      this.#bus,
      this.#runId,
    );
    return await processor.processPostClose(subjectId);
  }
}
