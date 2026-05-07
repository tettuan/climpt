/**
 * `CustomClose` (channel id `"U"`) — user-supplied close path declared
 * by an `AgentBundle.closeBinding.primary.kind === "custom"` carrying a
 * `ContractDescriptor`.
 *
 * Per channels/00 §A row 7, CustomClose subscribes to
 * `ClosureBoundaryReached` plus whatever the contract descriptor's
 * `subscribesTo` declares (full descriptor surface promoted by P3+).
 *
 * P4-1 status: minimal stub. The descriptor extension fields
 * (`subscribesTo`, `decide`, `schemaVersion`) on
 * `ContractDescriptor` are not yet promoted (Future T1.5 expansion);
 * the constructor accepts the registry only and registers a no-op
 * subscriber on `closureBoundaryReached`. Decision logic + descriptor
 * dispatch lands in PR4-4 / T4.5 region per phased plan.
 *
 * Design refs:
 *  - To-Be `agents/docs/design/realistic/tobe/channels/46-channel-U.md`.
 *  - Realistic `channels/00-realistic-binding.md` §A row 7.
 *
 * @module
 */

import type { CloseEventBus, Unsubscribe } from "../events/bus.ts";
import type {
  ClosureBoundaryReachedEvent,
  EventKind,
} from "../events/types.ts";
import type { AgentRegistry } from "../boot/types.ts";
import type { CloseTransport } from "../transports/close-transport.ts";
import type { Channel, ChannelContext, ChannelDecision } from "./types.ts";

const SUBSCRIBES_TO: ReadonlyArray<EventKind> = ["closureBoundaryReached"];

export class CustomCloseChannel
  implements Channel<ClosureBoundaryReachedEvent> {
  readonly id = "U" as const;
  readonly subscribesTo = SUBSCRIBES_TO;

  readonly #agentRegistry: AgentRegistry;
  /** Close-write seam captured at boot (PR4-2a). See `direct-close.ts`. */
  readonly #closeTransport: CloseTransport;
  #unsubscribe: Unsubscribe | null = null;

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
   * Subscribes to `ClosureBoundaryReached` only in P4-1. PR4-4 expands
   * this to also wire each `ContractDescriptor.subscribesTo` entry from
   * agents whose `closeBinding.primary.kind === "custom"`.
   *
   * If no agent declares custom close, the subscription is still
   * registered (cheap, observe-only). The `decide` skeleton skips so
   * the bus never sees a close action from this channel until PR4-4.
   */
  register(bus: CloseEventBus): void {
    if (this.#unsubscribe !== null) return;
    this.#unsubscribe = bus.subscribe<ClosureBoundaryReachedEvent>(
      { kind: "closureBoundaryReached" },
      (_event) => {
        // P4-1 skeleton: observe-only.
      },
    );
  }

  decide(
    _ctx: ChannelContext<ClosureBoundaryReachedEvent>,
  ): ChannelDecision {
    return {
      kind: "skip",
      reason: "PR4-1 skeleton: CustomClose decide not yet implemented",
    };
  }

  async execute(decision: ChannelDecision): Promise<void> {
    if (decision.kind === "shouldClose") {
      await this.#closeTransport.close(decision.subjectId);
    }
  }
}
