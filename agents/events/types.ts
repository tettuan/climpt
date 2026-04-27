/**
 * Event ADT (design 30 §A "8 EventBus events" + §E "ChannelId closed enum").
 *
 * The 8-event union is the **single source of truth** for inter-component
 * communication in the Realistic architecture. Subscribers (Channel
 * components in P4, diagnostic logger in P3 T3.4) consume only what is on
 * the event payload — no live references, no functions, no mutable state.
 *
 * Design constraints (Realistic anti-list, design 10 §F):
 * - **No 9th event**: the union is closed at 8 variants. Adding a 9th
 *   requires a design revision.
 * - **No 7th channel**: `ChannelId` is a closed string-literal enum of 6
 *   values (D, C, E, M, Cascade, U). The type system rejects any
 *   `IssueClosedEvent` whose `channel` is outside this set.
 * - **No mode information on payload**: `IssueClosedEvent` carries only
 *   the structural channel id. mode-aware branching is structurally
 *   impossible (R5 hard gate, design 11 §C step 5 / 30 §E).
 *
 * Status (T3.1, shadow mode):
 * - Types only — no publishers, no subscribers, no behavior change.
 * - T3.2 implements `CloseEventBus`; T3.3 wires publish; T3.4 wires the
 *   diagnostic subscriber via `BootKernel`.
 *
 * @see agents/docs/design/realistic/30-event-flow.md §A / §E
 * @see agents/docs/design/realistic/tobe/30-event-flow.md §A (8 event ADT)
 */

import type {
  AgentId,
  CloseBinding,
} from "../src_common/types/agent-bundle.ts";
import type { OutboxAction } from "../orchestrator/outbox-processor.ts";
import type { SubjectRef } from "../orchestrator/workflow-types.ts";

// ---------------------------------------------------------------------------
// Channel identity (closed enum — design 30 §E)
// ---------------------------------------------------------------------------

/**
 * `ChannelId` — closed enum of the 6 close routes (design 30 §E).
 *
 * The enumeration is the structural realisation of the anti-list "no new
 * channel". Adding a 7th value requires a deliberate type-system change
 * and would invalidate the R5 hard-gate proof (design 11 §C step 5).
 *
 * | Value     | Channel                                          |
 * | --------- | ------------------------------------------------ |
 * | `"D"`     | DirectClose                                      |
 * | `"C"`     | OutboxClose (Cpre / Cpost share this id;          |
 * |           | sub-discriminator on `OutboxPhase` distinguishes) |
 * | `"E"`     | BoundaryClose                                    |
 * | `"M"`     | MergeClose                                       |
 * | `"Cascade"`| CascadeClose                                    |
 * | `"U"`    | CustomClose                                       |
 *
 * `Cpre` / `Cpost` are **publisher-side component distinctions** — at the
 * event payload level they share `ChannelId === "C"` and disambiguate via
 * `OutboxPhase`. This keeps the closed enum at exactly 6 values.
 */
export type ChannelId = "D" | "C" | "E" | "M" | "Cascade" | "U";

/**
 * `OutboxPhase` — pre/post discriminator for `ChannelId === "C"`.
 *
 * The Outbox channel pipeline has two execution moments: before the issue
 * close (pre) and after it (post). Both publish under the same `ChannelId`
 * "C" but differ on this discriminator. Events that mention "C" carry an
 * optional `OutboxPhase`; events that do not mention "C" never carry it.
 */
export type OutboxPhase = "pre" | "post";

// ---------------------------------------------------------------------------
// Event base + 8 variants (design 30 §A)
// ---------------------------------------------------------------------------

/**
 * Common payload fields shared by all events.
 *
 * `publishedAt` is set by the publisher (clock injection happens at
 * `CloseEventBus.publish` call site, not on construction here). `runId`
 * correlates events to a single boot lifecycle (boot artifacts carry the
 * authoritative value). `subjectId` is present when the event refers to
 * a specific subject (issue / saga); `DispatchPlanned`-style events that
 * pre-date subject resolution may omit it.
 */
export interface BaseEvent {
  readonly publishedAt: number;
  readonly runId: string;
  readonly subjectId?: SubjectRef;
}

/**
 * 1/8 — `DispatchPlanned`: SubjectPicker decided to fan out a step to an
 * agent. Publisher: SubjectPicker (design 30 §B publish-source table).
 */
export interface DispatchPlannedEvent extends BaseEvent {
  readonly kind: "dispatchPlanned";
  readonly agentId: AgentId;
  readonly phase: string;
  readonly source: "workflow" | "argv" | "prePass";
}

/**
 * 2/8 — `DispatchCompleted`: AgentRuntime (FlowLoop or CompletionLoop)
 * finished a dispatch and produced an outcome. Publisher: AgentRuntime
 * (design 30 §B).
 */
export interface DispatchCompletedEvent extends BaseEvent {
  readonly kind: "dispatchCompleted";
  readonly agentId: AgentId;
  readonly phase: string;
  readonly outcome: string;
}

/**
 * 3/8 — `ClosureBoundaryReached`: CompletionLoop crossed the closure
 * boundary for an agent's closure step. Publisher: AgentRuntime — only
 * the CompletionLoop sub-driver (design 30 §B; FlowLoop never publishes
 * this, design 16 §H anti-list).
 */
export interface ClosureBoundaryReachedEvent extends BaseEvent {
  readonly kind: "closureBoundaryReached";
  readonly agentId: AgentId;
  readonly stepId: string;
}

/**
 * 4/8 — `TransitionComputed`: TransitionRule mapped a verdict to a phase
 * change. Publisher: TransitionRule (design 30 §B).
 *
 * Snapshot fields (PR4-2b — Critique F5 ChannelContext purity):
 *  - `closeBinding` — the originating agent's `CloseBinding` projection
 *    (design 13 §F). Pre-snapshot of the bundle field so DirectClose's
 *    `decide` reads only `ctx`, never the live registry.
 *  - `outcomeMatch` — pre-computed `closeCondition` ↔ `outcome` predicate
 *    (`true` when the agent declared no condition or the outcome equals
 *    the declared `closeCondition`). Channels would otherwise need to
 *    re-derive this from the registry, breaking decide purity.
 *  - `agentId` — the agent that produced the dispatch. Lets diagnostic
 *    subscribers correlate close decisions back to the source agent
 *    without consulting the registry.
 *  - `isTerminal` — `true` iff `toPhase` is a terminal phase per the
 *    frozen workflow. DirectClose uses this as the "should close at all"
 *    guard (To-Be 41 §B `check_terminal`).
 *
 * All four are optional so existing publishers (T3.3 shadow-mode) and
 * pre-PR4-2b tests keep passing while the enriched payload rolls out.
 * Publishers that own the close decision (orchestrator, PR4-2b) MUST
 * populate every field; subscribers that depend on them assert
 * presence at decide time.
 */
export interface TransitionComputedEvent extends BaseEvent {
  readonly kind: "transitionComputed";
  readonly fromPhase: string;
  readonly toPhase: string;
  readonly outcome: string;
  readonly closeBinding?: CloseBinding;
  readonly outcomeMatch?: boolean;
  readonly agentId?: AgentId;
  readonly isTerminal?: boolean;
}

/**
 * 5/8 — `IssueClosedEvent`: a Channel.execute successfully closed an
 * issue. Publisher: Channel.execute (design 30 §B). `channel` is bound
 * to the closed `ChannelId` enum (R5 hard gate, design 30 §E).
 *
 * `outboxPhase` is present iff `channel === "C"` (pre/post sub-component
 * discrimination); other channels do not carry it.
 */
export interface IssueClosedEvent extends BaseEvent {
  readonly kind: "issueClosed";
  readonly channel: ChannelId;
  readonly outboxPhase?: OutboxPhase;
  readonly subjectId: SubjectRef;
}

/**
 * 6/8 — `IssueCloseFailedEvent`: a Channel.execute attempted to close an
 * issue but the transport reported failure. Publisher: Channel.execute
 * (Transport.Failed branch, design 30 §B / §D Failure).
 */
export interface IssueCloseFailedEvent extends BaseEvent {
  readonly kind: "issueCloseFailed";
  readonly channel: ChannelId;
  readonly outboxPhase?: OutboxPhase;
  readonly subjectId: SubjectRef;
  readonly reason: string;
}

/**
 * 7/8 — `SiblingsAllClosedEvent`: every child issue under a parent has
 * reached `IssueClosedEvent`. Publisher: SiblingTracker (design 30 §B,
 * referenced from To-Be 45 §B).
 */
export interface SiblingsAllClosedEvent extends BaseEvent {
  readonly kind: "siblingsAllClosed";
  readonly parentSubjectId: SubjectRef;
  readonly closedChildren: readonly SubjectRef[];
}

/**
 * 8/8 — `OutboxActionDecidedEvent`: OutboxActionMapper decided a typed
 * outbox action (handoff chain hinge — design 30 §D step 2). Publisher:
 * OutboxActionMapper (design 30 §B).
 *
 * `outboxPhase` records whether this is a pre-close or post-close action
 * so OutboxClose-pre / OutboxClose-post subscribers can filter without
 * inspecting `action.kind` semantics.
 */
export interface OutboxActionDecidedEvent extends BaseEvent {
  readonly kind: "outboxActionDecided";
  readonly action: OutboxAction;
  readonly outboxPhase: OutboxPhase;
}

/**
 * Closed union of all 8 event variants — the EventBus contract.
 *
 * Discriminated by `kind`; `EventKind` exposes the discriminator literal
 * union for filter narrowing in subscribers.
 */
export type Event =
  | DispatchPlannedEvent
  | DispatchCompletedEvent
  | ClosureBoundaryReachedEvent
  | TransitionComputedEvent
  | IssueClosedEvent
  | IssueCloseFailedEvent
  | SiblingsAllClosedEvent
  | OutboxActionDecidedEvent;

/**
 * Discriminator literal union.
 *
 * Kept as a derived alias of `Event["kind"]` so adding a 9th variant
 * (which would require a design revision) automatically widens this
 * type — no parallel maintenance needed.
 */
export type EventKind = Event["kind"];
