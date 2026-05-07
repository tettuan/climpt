/**
 * `MergeClose` (channel id `"M"`) — merge-pr subprocess close path.
 *
 * Per channels/00 §A row 5, MergeClose is **publish-only**: it has no
 * bus subscription. The `merge-pr` CLI subprocess runs to completion,
 * its `MergeCloseAdapter` (PR4-4 T4.5 — `merge-close-adapter.ts`)
 * reads the completion fact and publishes `IssueClosedEvent({
 * channel: "M", subjectId })` into the parent process's bus.
 *
 * For the Channel ADT to remain uniform across all 6 ids, this file
 * provides the `Channel` shape with an empty `subscribesTo` array.
 * `register(bus)` is a no-op (no event to subscribe to). `decide`
 * returns `skip` unconditionally because:
 *   - the channel never receives an event the framework owns —
 *     the close happens server-side after `gh pr merge`, and the
 *     bus event is published by `MergeCloseAdapter`, not by this
 *     channel; and
 *   - `execute` is therefore never invoked with `shouldClose`. The
 *     transport seam is held only for parity with sibling channels
 *     (purity test fixture compatibility).
 *
 * Design refs:
 *  - To-Be `agents/docs/design/realistic/tobe/channels/44-channel-M.md`
 *    §F responsibility ("framework は close を呼ばない").
 *  - Realistic `channels/00-realistic-binding.md` §A row 5
 *    ("publish のみ、subscribe 無し").
 *  - `agents/channels/merge-close-adapter.ts` (PR4-4 T4.5) — the
 *    actual bus publisher for channel id "M".
 *
 * @module
 */

import type { CloseEventBus } from "../events/bus.ts";
import type { Event, EventKind } from "../events/types.ts";
import type { AgentRegistry } from "../boot/types.ts";
import type { CloseTransport } from "../transports/close-transport.ts";
import type { Channel, ChannelContext, ChannelDecision } from "./types.ts";

/** Empty list — MergeClose is publish-only (channels/00 §A row 5). */
const SUBSCRIBES_TO: ReadonlyArray<EventKind> = [];

export class MergeCloseChannel implements Channel<Event> {
  readonly id = "M" as const;
  readonly subscribesTo = SUBSCRIBES_TO;

  readonly #agentRegistry: AgentRegistry;
  /** Close-write seam captured at boot (PR4-2a). See `direct-close.ts`. */
  readonly #closeTransport: CloseTransport;

  constructor(deps: {
    readonly agentRegistry: AgentRegistry;
    readonly closeTransport: CloseTransport;
  }) {
    this.#agentRegistry = deps.agentRegistry;
    this.#closeTransport = deps.closeTransport;
    void this.#agentRegistry;
    void this.#closeTransport;
  }

  /**
   * No-op: MergeClose is publish-only. The `MergeCloseAdapter`
   * (`merge-close-adapter.ts`) holds the bus reference and publishes
   * `IssueClosedEvent({ channel: "M" })` after the merge-pr subprocess
   * exits — the adapter does not implement `Channel`, it consumes a
   * fact-file IPC stream written by `merge-pr.ts`.
   */
  register(_bus: CloseEventBus): void {
    // intentionally empty
  }

  /**
   * Always returns `skip`: the framework never closes for this
   * channel. The server's auto-close after `gh pr merge` is observed
   * by `MergeCloseAdapter.drain` and surfaced on the bus there.
   */
  decide(_ctx: ChannelContext<Event>): ChannelDecision {
    return {
      kind: "skip",
      reason:
        "MergeClose: framework never closes (server auto-close + adapter)",
    };
  }

  /**
   * No-op for `shouldClose` is unreachable (decide always returns
   * skip) but the transport seam is invoked when present for parity
   * with sibling channels — defensive fallback so a future
   * publisher-side regression does not silently bypass the seam.
   */
  async execute(decision: ChannelDecision): Promise<void> {
    if (decision.kind === "shouldClose") {
      await this.#closeTransport.close(decision.subjectId);
    }
  }
}
