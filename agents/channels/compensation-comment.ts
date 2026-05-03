/**
 * `CompensationCommentChannel` — framework subscriber that posts a
 * marker-tagged compensation comment when a close-write fails.
 *
 * This is the W13 contract realisation: per To-Be `41-channel-D §D`,
 * the only compensation on a `IssueCloseFailedEvent` is an idempotent
 * `Comment(IssueRef)`. The orchestrator's saga rollback (label LIFO
 * restore + procedural comment post) was deleted in PR4-2b — this
 * channel takes over the comment-only side of that contract.
 *
 * Design refs:
 *  - To-Be `agents/docs/design/realistic/tobe/channels/41-channel-D.md`
 *    §D ("Compensation: 失敗時のみ Comment(IssueRef, body) を Outbox に
 *    enqueue (idempotent)").
 *  - Realistic `channels/00-realistic-binding.md` §A row 3 (C-post is
 *    framework subscriber; this channel piggybacks on the same boot
 *    seat for the comp-comment kind).
 *  - W13 (saga rollback removal): `tmp/realistic-migration/plan-revisions.md`
 *    §"PR4-2 split discovery".
 *
 * Why a dedicated channel and not a method on DirectClose:
 *  - Other channels (BoundaryClose, MergeClose, CascadeClose) also
 *    publish `IssueCloseFailedEvent`. Putting the comp-comment logic
 *    inside DirectClose would either duplicate it across all channels
 *    or couple them. A single subscriber on the failed-event keeps the
 *    compensation centralised and structurally idempotent.
 *  - Channel ChannelId remains in the closed enum: this channel
 *    publishes nothing, so it does not introduce a 7th id (channels/00
 *    §A anti-list).
 *
 * Idempotency:
 *  - Each compensation comment embeds a deterministic marker derived
 *    from `compensationMarker(subjectId, runId)` — see
 *    `compensation-marker.ts`. Before posting, the channel reads
 *    `getRecentComments(subjectId, 20)` and skips when any recent
 *    comment includes the marker. Best-effort: lookup failure proceeds
 *    to post (network blips must not silently suppress the comment).
 *  - Marker scope is `(subjectId, runId)`. Per-run uniqueness avoids
 *    cross-run dedup that would suppress legitimately re-attempted
 *    closes after operator intervention.
 *
 * @module
 */

import type { CloseEventBus, Unsubscribe } from "../events/bus.ts";
import type { EventKind, IssueCloseFailedEvent } from "../events/types.ts";
import type { GitHubClient } from "../orchestrator/github-client.ts";
import { compensationCommentBody } from "./compensation-marker.ts";

const SUBSCRIBES_TO: ReadonlyArray<EventKind> = ["issueCloseFailed"];

/**
 * Bind the `IssueCloseFailed` subscriber that posts a comp comment.
 *
 * Returns the unsubscribe handle for symmetry with other channels'
 * `register()` (tests may use it for cleanup). Production code never
 * calls the unsubscribe — boot freeze seals the subscriber set.
 *
 * The handler is deliberately *async without await on the bus side*:
 * `bus.publish` is fire-and-forget and the bus's `.catch(() => {})` on
 * returned promises (events/bus.ts F7) keeps any post failure from
 * propagating to publishers. This matches the contract in
 * `compensation-comment_test.ts` (PR4-2b).
 */
export class CompensationCommentChannel {
  /**
   * Sentinel id — not a `ChannelId`. CompensationCommentChannel does
   * not publish `IssueClosedEvent`, so the closed 6-value enum is not
   * widened. The id surfaces only in diagnostic JSONL.
   */
  readonly id = "CompensationComment" as const;
  readonly subscribesTo = SUBSCRIBES_TO;

  readonly #github: GitHubClient;
  readonly #runId: string;
  #unsubscribe: Unsubscribe | null = null;

  constructor(deps: {
    readonly github: GitHubClient;
    readonly runId: string;
  }) {
    this.#github = deps.github;
    this.#runId = deps.runId;
  }

  /**
   * Subscribe to `issueCloseFailed` on `bus`. Must run inside
   * `BootKernel.boot` before `bus.freeze()` (Critique F1).
   */
  register(bus: CloseEventBus): void {
    if (this.#unsubscribe !== null) return;
    this.#unsubscribe = bus.subscribe<IssueCloseFailedEvent>(
      { kind: "issueCloseFailed" },
      (event) => this.#handle(event),
    );
  }

  async #handle(event: IssueCloseFailedEvent): Promise<void> {
    try {
      const subjectId = event.subjectId;
      const body = compensationCommentBody({
        subjectId,
        runId: this.#runId,
        reason: event.reason,
      });
      const marker = body.marker;
      try {
        const recent = await this.#github.getRecentComments(subjectId, 20);
        if (recent.some((c) => c.body.includes(marker))) return;
      } catch {
        // Best-effort idempotency check — proceed to post on lookup
        // failure. The marker still permits a manual retry to dedup.
      }
      await this.#github.addIssueComment(subjectId, body.text);
    } catch {
      // Compensation post is best-effort. F7: handler must not throw
      // back to the publisher (the bus already swallows but we wrap
      // explicitly so a future direct-call path also stays safe).
    }
  }
}
