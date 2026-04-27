/**
 * `Channel` interface + `ChannelContext` snapshot + `ChannelDecision` ADT
 * (design 30 §C subscriber contract, To-Be channels/41-46 §A).
 *
 * The Channel ADT is the **decision-and-execution unit** of the close
 * pipeline. Each of the 6 closed `ChannelId` values (D, C, E, M, Cascade,
 * U) is realised by exactly one `Channel` implementation that subscribes
 * to the events declared in the realistic binding table (channels/00 §A).
 *
 * Two-phase contract (design channels/41-46 §A, repeated per channel):
 *
 *  1. **`decide(ctx)` is PURE** (Critique F5 + To-Be P1 referential
 *     transparency). `ctx` is a frozen snapshot taken at event-publish
 *     time. The function MUST NOT:
 *      - read live mutable state (filesystem, network, registries).
 *      - dispatch side effects.
 *      - depend on closure state captured outside `ctx`.
 *     Same `ctx` ⇒ same `ChannelDecision`. The R5 hard-gate proof
 *     (channels/00 §C) rests on this property; `purity_test.ts` is the
 *     mechanical guard.
 *
 *  2. **`execute(decision, transport)` is IMPURE.** It performs the
 *     close-write through the {@link CloseTransport} seam (and only
 *     through that seam — direct gh CLI invocation from a channel
 *     violates P2 polarity, channels/00 §D). Compensation lookups
 *     (e.g. `getRecentComments` for failure reporting) live here, NOT
 *     in `decide`.
 *
 * Subscribe-time contract (Critique F1):
 *  - Channels register their bus subscription **inside** `BootKernel.boot`
 *    before `bus.freeze()`. After freeze the subscriber set is sealed;
 *    any attempt to `subscribe` throws `SubscribeAfterBootError`.
 *  - Each channel publishes its `subscribesTo` list as part of its
 *    interface so a future `r5-traceability_test.ts` (T4.7) can assert
 *    the (mode × channel) coverage matrix without inspecting boot
 *    internals.
 *
 * P4-1 status (this PR):
 *  - The interface and ADT land here. Six concrete channel files
 *    (direct-close.ts, outbox-close-pre.ts, outbox-close-post.ts,
 *    boundary-close.ts, merge-close.ts, cascade-close.ts) provide
 *    skeletons whose `decide` returns `{ kind: "skip", reason: ... }`
 *    and whose `execute` honours `shouldClose` via the transport.
 *    Decision logic is filled in by PR4-2 / PR4-3 / PR4-4.
 *
 * @see agents/docs/design/realistic/channels/00-realistic-binding.md
 * @see agents/docs/design/realistic/30-event-flow.md §C
 * @see tmp/realistic-migration/critique.md F1 / F5 / F15
 *
 * @module
 */

import type {
  ChannelId,
  Event,
  EventKind,
  OutboxPhase,
} from "../events/types.ts";
import type { CloseBinding } from "../src_common/types/agent-bundle.ts";
import type { SubjectRef } from "../orchestrator/workflow-types.ts";
import type { CloseTransport } from "../transports/close-transport.ts";

// ---------------------------------------------------------------------------
// Decision ADT
// ---------------------------------------------------------------------------

/**
 * Closed `ChannelDecision` ADT (design 20 §D).
 *
 * Two variants:
 *  - `shouldClose`: the channel demands a close on `subjectId`. The
 *    optional `outboxPhase` is present iff the channel id will publish
 *    `IssueClosedEvent` with `channel === "C"` (pre/post sub-component
 *    discrimination — see `events/types.ts` `OutboxPhase`).
 *  - `skip`: the channel observed the event but no close action follows.
 *    `reason` is a short human-readable label for diagnostics; it is
 *    NOT machine-consumed (no callers branch on string matching).
 *
 * Adding a third variant requires a design revision (To-Be 20 §D anti-list
 * "no third Decision kind").
 */
export type ChannelDecision =
  | {
    readonly kind: "shouldClose";
    readonly subjectId: SubjectRef;
    readonly outboxPhase?: OutboxPhase;
  }
  | { readonly kind: "skip"; readonly reason: string };

// ---------------------------------------------------------------------------
// Snapshot context
// ---------------------------------------------------------------------------

/**
 * Frozen snapshot consumed by `Channel.decide` (Critique F5).
 *
 * Per design channels/00 §C, every input that the decide function may
 * legally consume is captured here at event-publish time. The publisher
 * (or the channel's own bus subscription wrapper) is responsible for
 * pre-computing derived predicates so `decide` performs only structural
 * checks.
 *
 * Field-by-field rationale:
 *  - `event` — the published event verbatim. Discriminator narrowing on
 *    `event.kind` is how channel implementations switch on payload.
 *  - `closeBinding` — the relevant `AgentBundle.closeBinding`. Pre-snapshot
 *    of bundle field; the channel never re-reads from
 *    `BootArtifacts.agentRegistry`.
 *  - `outcomeMatch` — pre-computed `closeBinding.primary` ↔ outcome match
 *    predicate. Used by DirectClose / BoundaryClose. Optional because not
 *    every channel observes outcome semantics.
 *  - `siblingsAllResolved` — pre-computed sibling-tracker result for
 *    CascadeClose. Optional for the same reason.
 *
 * Structural freeze (`Object.freeze`) is applied at construction time so
 * even a future bug that aliases the context outside Channel.decide
 * cannot mutate it. The freeze is shallow on the wrapper — inner
 * `event` / `closeBinding` references inherit immutability from their
 * own deep-frozen Layer-4 origin.
 */
export interface ChannelContext<E extends Event = Event> {
  readonly event: E;
  readonly closeBinding: CloseBinding;
  readonly outcomeMatch?: boolean;
  readonly siblingsAllResolved?: boolean;
}

/**
 * Construct a frozen `ChannelContext`.
 *
 * Pulled out of channel implementations so the freeze contract is
 * applied consistently and is testable in isolation
 * (`purity_test.ts`).
 */
export const createChannelContext = <E extends Event>(
  init: ChannelContext<E>,
): ChannelContext<E> => Object.freeze({ ...init });

// ---------------------------------------------------------------------------
// Channel interface
// ---------------------------------------------------------------------------

/**
 * Channel ADT — one implementation per closed {@link ChannelId} value.
 *
 * Implementations register their bus subscription inside
 * `BootKernel.boot` (the constructor + `register()` pattern is the
 * convention used by the six P4-1 channel files). After
 * `bus.freeze()`, `subscribesTo` is a stable structural fact that
 * downstream consumers (R5 test, diagnostic tooling) can reflect on.
 */
export interface Channel<E extends Event = Event> {
  /**
   * Closed `ChannelId` discriminator. Multiple channel implementations
   * MAY share an id when they form publisher-side sub-components of
   * a single channel (`OutboxClose-pre` and `OutboxClose-post` both
   * carry `id === "C"`, distinguished by `OutboxPhase`).
   */
  readonly id: ChannelId;

  /**
   * Event kinds this channel subscribes to. Used by the R5 traceability
   * test (T4.7) and by diagnostic logging; does NOT replace the actual
   * `bus.subscribe` call in the constructor — the subscription itself is
   * what makes the channel observe events.
   */
  readonly subscribesTo: ReadonlyArray<EventKind>;

  /**
   * PURE function: snapshotted `ctx` ⇒ deterministic `ChannelDecision`.
   * Same input MUST yield equal output (deep equality). Implementations
   * MUST NOT read mutable state captured outside `ctx`.
   */
  decide(ctx: ChannelContext<E>): ChannelDecision;

  /**
   * Execute a {@link ChannelDecision}. `shouldClose` calls
   * `closeTransport.close(decision.subjectId)` through the seam
   * captured at construction (PR4-2a — boot threads `closeTransport`
   * into every channel constructor); `skip` is a no-op. Channels MAY
   * perform additional auxiliary I/O here (logging, comment
   * compensation) but MUST funnel the close-write through the
   * constructor-captured transport exclusively (P2 polarity).
   */
  execute(decision: ChannelDecision): Promise<void>;
}
