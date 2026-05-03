/**
 * BootArtifacts — the 5 frozen Layer-4 inputs (design 10 §B + 20 §B).
 *
 * Per design 10 §B and 20 §B/§E, the 5 inputs (WorkflowConfig,
 * AgentBundle list, StepRegistry per agent, SO Schemas, Policy) are
 * loaded + validated + frozen **once** at process start. Every
 * downstream consumer reads from the frozen artifact rather than
 * re-loading per dispatch. T2.3 replaces the per-dispatch
 * `loadConfiguration` with `BootArtifacts.agentRegistry.lookup(id)`.
 *
 * Note on shape vs. design 10 §B "5 inputs":
 *  - `workflow`       — WorkflowConfig (input 1)
 *  - `agentRegistry`  — AgentBundle list, indexed (input 2)
 *  - `schemas`        — SO Schemas, indexed by schemaRef (input 4)
 *  - `policy`         — Policy + Transport (input 5)
 *  - StepRegistry     — Per-agent steps already live inside
 *                       `AgentBundle.steps` (T1.3). The 3-file dispersion
 *                       collapses into AgentBundle so there is no
 *                       top-level `stepRegistry` field; it would be a
 *                       second source of truth (gap matrix Top Risk #3).
 *
 * Design refs:
 *  - `agents/docs/design/realistic/10-system-overview.md` §B
 *  - `agents/docs/design/realistic/20-state-hierarchy.md` §B / §D / §E
 *  - `tmp/realistic-migration/phased-plan.md` §P2
 *
 * @module
 */

import type { WorkflowConfig } from "../orchestrator/workflow-types.ts";
import type { AgentBundle } from "../src_common/types/agent-bundle.ts";
import type { CloseEventBus } from "../events/bus.ts";
import type { BoundaryCloseChannel } from "../channels/boundary-close.ts";
import type { DirectCloseChannel } from "../channels/direct-close.ts";
import type { MergeCloseAdapter } from "../channels/merge-close-adapter.ts";
import type { OutboxClosePostChannel } from "../channels/outbox-close-post.ts";
import type { OutboxClosePreChannel } from "../channels/outbox-close-pre.ts";
import type { GitHubClient } from "../orchestrator/github-client.ts";
import type { CloseTransport } from "../transports/close-transport.ts";
import type { Policy } from "./policy.ts";

/**
 * Frozen registry of agent bundles, keyed by AgentId.
 *
 * Boot rule A1 (id uniqueness across the workflow's agent map) is
 * enforced at construction time — duplicates produce a
 * `Decision = Reject(ValidationError)` returned by
 * {@link BootKernel.boot}. After construction the registry is
 * read-only and stable for the life of the process (Layer 4
 * Run-immutable).
 *
 * `lookup(id)` returns `undefined` when the id is not registered;
 * callers (T2.3 dispatcher rewrite) are expected to surface a
 * dispatcher-level error or a {@link ../shared/validation/mod.ts}
 * Decision for the missing case rather than throw at lookup time.
 */
export interface AgentRegistry {
  /**
   * Look up an `AgentBundle` by id. Returns `undefined` if absent.
   * Bundles returned are deep-frozen members of {@link all}.
   */
  lookup(agentId: string): AgentBundle | undefined;

  /**
   * All registered bundles in registration order.
   *
   * Frozen array — safe to iterate without defensive copy. Iteration
   * order matches the order of `workflow.agents` map keys at Boot.
   */
  readonly all: ReadonlyArray<AgentBundle>;
}

/**
 * The 5 Boot inputs frozen into a single artifact.
 *
 * Per design 20 §D, this is Layer 4 (Run-immutable). All fields are
 * `readonly`; the entire tree is deep-frozen by `BootKernel.boot`
 * before being returned, so `Object.isFrozen` returns `true` for every
 * reachable node (asserted by `agents/boot/kernel_test.ts`).
 *
 * `bootedAt` is included for diagnostics — useful when the same
 * BootArtifacts is observed from different log stages (e.g. session
 * start vs. dispatch) and we need to confirm the artifact is the same
 * boot. Not part of any design rule.
 */
export interface BootArtifacts {
  readonly workflow: WorkflowConfig;
  readonly agentRegistry: AgentRegistry;
  /**
   * SO Schemas keyed by schemaRef (design 14 §SO + 13 §G A5).
   *
   * Phase 2 (T2.1) leaves this as an empty frozen `Map` — Schemas are
   * loaded lazily by `SchemaManager.loadSchemaForStep` per design today.
   * T2.2 populates it eagerly so all SO schemas are validated at Boot.
   * The field is present now so consumers can plumb against the final
   * shape rather than re-typing at T2.2.
   */
  readonly schemas: ReadonlyMap<string, unknown>;
  readonly policy: Policy;
  /**
   * Frozen `CloseEventBus` constructed inside `BootKernel.boot`
   * (T3.4). Run-time publishers (T3.3) call `bus.publish`; the
   * subscriber set is sealed at boot via `bus.freeze()` so no Channel
   * can be added after Layer 4 materialises (Critique F1).
   *
   * Calling `bus.subscribe` on this artifact throws
   * {@link ../events/bus.ts | SubscribeAfterBootError}. Phase 3 boots
   * register exactly one subscriber (the JSONL diagnostic logger);
   * Phase 4 boots additionally register the 6 close channels.
   */
  readonly bus: CloseEventBus;
  /**
   * Boot correlation id — a stable random string assigned per
   * `BootKernel.boot` invocation. Embedded into diagnostic JSONL log
   * filenames (`events-<runId>.jsonl`) and into every `BaseEvent.runId`
   * so cross-process log aggregation can group events by boot.
   *
   * Format is opaque (`crypto.randomUUID()`); consumers must treat it
   * as a string identity.
   */
  readonly runId: string;
  /**
   * Epoch milliseconds at which `BootKernel.boot` completed. Diagnostic
   * only — not used for routing decisions.
   */
  readonly bootedAt: number;
  /**
   * `GitHubClient` constructed inside `BootKernel.boot` (PR4-2a). The
   * single point at which the upstream gh-CLI seam is materialised:
   * Run-time consumers (Orchestrator, channels' close transport,
   * outbox processor) read this reference rather than constructing their
   * own. Tests inject a fixture client via {@link BootOpts.githubClient}.
   *
   * Frozen by `deepFreeze` along with the rest of the artifact tree.
   * The internal cache `Map` reachable through this reference is NOT
   * an enumerable field so it remains mutable for TTL eviction.
   */
  readonly githubClient: GitHubClient;
  /**
   * `CloseTransport` constructed from `githubClient` inside
   * `BootKernel.boot` (PR4-2a). Channels' `execute` calls
   * `transport.close(subjectId)` through this seam. PR4-2b flipped
   * channels' `decide` from `skip` to `shouldClose` so the procedural
   * `orchestrator.ts:820-899` close path is deleted.
   */
  readonly closeTransport: CloseTransport;
  /**
   * Concrete {@link DirectCloseChannel} reference (PR4-2b).
   *
   * Exposed on the artifact so the orchestrator can synchronously
   * invoke `directClose.handleTransition(transitionEvent)` immediately
   * after publishing `TransitionComputed`. The bus-side subscription
   * remains for diagnostic reflection (R5 traceability), but the
   * synchronous call is what preserves the existing post-close +
   * sentinel-cascade ordering until PR4-3 migrates those branches into
   * channel-resident subscribers.
   *
   * Why a concrete channel instead of an opaque `Channel` reference:
   * the orchestrator needs to call `handleTransition` (the
   * channel-public synchronous decide+execute pair) which is not part
   * of the abstract `Channel` interface — that interface keeps
   * `decide` / `execute` as the only public methods so other channels
   * stay observation-only.
   */
  readonly directClose: DirectCloseChannel;
  /**
   * Concrete {@link OutboxClosePreChannel} reference (PR4-3).
   *
   * Exposed on the artifact so the outbox-processor can synchronously
   * invoke `outboxClosePre.handleCloseAction(subjectId, action)` for
   * `close-issue` OutboxActions. Replaces the procedural
   * `github.closeIssue(subjectId)` call site at
   * outbox-processor.ts:469 (T4.4b cutover). Per-file success
   * accounting (issue #486) is preserved by the synchronous return.
   */
  readonly outboxClosePre: OutboxClosePreChannel;
  /**
   * Concrete {@link OutboxClosePostChannel} reference (PR4-3).
   *
   * Exposed on the artifact so the orchestrator can synchronously
   * invoke `outboxClosePost.handlePostClose(subjectId, store)` after a
   * successful close. Replaces the inline `processPostClose` call at
   * orchestrator.ts:1004-1042 (T4.4b cutover).
   */
  readonly outboxClosePost: OutboxClosePostChannel;
  /**
   * Concrete {@link BoundaryCloseChannel} reference (PR4-3).
   *
   * Exposed on the artifact so the closure-step verdict adapter can
   * synchronously invoke `boundaryClose.handleBoundary(subjectId,
   * agentId, stepId)` instead of shelling out to `gh issue close`
   * itself. Replaces the procedural close at
   * verdict/external-state-adapter.ts:383-421 (T4.4c cutover).
   */
  readonly boundaryClose: BoundaryCloseChannel;
  /**
   * Concrete {@link MergeCloseAdapter} reference (PR4-4 T4.5).
   *
   * The adapter is the parent-side IPC consumer for the `merge-pr`
   * subprocess: at every cycle boundary the orchestrator (or a test
   * harness) calls `mergeCloseAdapter.drain()` which reads the
   * subprocess-written `tmp/merge-close-facts/<runId>.jsonl`,
   * publishes one `IssueClosedEvent({ channel: "M" })` per fact, and
   * truncates the file. The adapter is NOT a `Channel` because
   * MergeClose has no event subscription (channels/00 §A row 5
   * "publish のみ、subscribe 無し") — it is the publisher-side
   * bridge for channel id "M".
   *
   * Exposing it on `BootArtifacts` matches the design's "all close
   * paths share one Boot" invariant (10 §B / R5 hard gate). Standalone
   * mode (`bootStandalone`) constructs the same adapter so the
   * (mode × channel) reachability matrix in 11 §E stays uniform.
   */
  readonly mergeCloseAdapter: MergeCloseAdapter;
}
