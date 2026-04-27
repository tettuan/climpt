/**
 * Orchestrator - Main workflow execution loop
 *
 * Integrates label-resolver, phase-transition, cycle-tracker,
 * dispatcher, and github-client into a single-issue workflow loop.
 * Corresponds to ADK LoopAgent + SequentialAgent pattern.
 */

import type {
  BatchOptions,
  BatchResult,
  IssueSource,
  OrchestratorOptions,
  OrchestratorResult,
  WorkflowConfig,
} from "./workflow-types.ts";
import type { GitHubClient } from "./github-client.ts";
import type { AgentDispatcher } from "./dispatcher.ts";
import type { ArtifactEmitter } from "./artifact-emitter.ts";
import type { AgentRegistry } from "../boot/types.ts";
import type { CloseEventBus } from "../events/bus.ts";
import type { DirectCloseChannel } from "../channels/direct-close.ts";
import type { OutboxClosePostChannel } from "../channels/outbox-close-post.ts";
import type { OutboxClosePreChannel } from "../channels/outbox-close-pre.ts";
import type { TransitionComputedEvent } from "../events/types.ts";
import { RateLimiter } from "./rate-limiter.ts";
import {
  resolveAgent,
  resolvePhase,
  resolveTerminalOrBlocking,
} from "./label-resolver.ts";
import { computeLabelChanges, computeTransition } from "./phase-transition.ts";
import { HandoffManager } from "./handoff-manager.ts";
import { CycleTracker } from "./cycle-tracker.ts";
import type { SubjectStore } from "./subject-store.ts";
import { OutboxProcessor } from "./outbox-processor.ts";
import { DeferredItemsEmitter } from "./deferred-items-emitter.ts";
import { OrchestratorLogger } from "./orchestrator-logger.ts";
import { BatchRunner } from "./batch-runner.ts";
import { countdownDelay } from "./countdown.ts";
import { summarizeSync, syncLabels } from "./label-sync.ts";
import { detectRuntimeOrigin } from "../common/runtime-origin.ts";

export type { OrchestratorOptions, OrchestratorResult };

/**
 * Legacy idempotency marker — `(subjectId, cycleSeq)` shape.
 *
 * @deprecated PR4-2b — the W13 close cutover replaced this with a
 * `(subjectId, runId)`-keyed marker living in
 * `agents/channels/compensation-marker.ts`. The new
 * {@link CompensationCommentChannel} is the single source of truth for
 * compensation comment posting; the orchestrator no longer registers a
 * pre-close compensation entry. This export remains for one PR so that
 * `orchestrator_test.ts` import statements compile until the test files
 * are migrated; PR4-3 deletes it.
 */
export const compensationMarker = (
  subjectId: string | number,
  cycleSeq: number,
): string => `climpt-compensation:subject-${subjectId}:cycle-${cycleSeq}`;

export class Orchestrator {
  #config: WorkflowConfig;
  #github: GitHubClient;
  #dispatcher: AgentDispatcher;
  #cwd: string;
  #artifactEmitter?: ArtifactEmitter;
  #agentRegistry?: AgentRegistry;
  #bus?: CloseEventBus;
  #runId?: string;
  /**
   * `DirectCloseChannel` instance from `BootArtifacts.directClose`
   * (PR4-2b). When present, the orchestrator publishes
   * `TransitionComputed` and then synchronously calls
   * `directClose.handleTransition(event)` so the channel decides+executes
   * the close write through the frozen `CloseTransport`.
   *
   * When absent (legacy test fixtures that construct the orchestrator
   * without booting), the orchestrator does NOT close issues on its
   * own. The legacy procedural close path is gone (W13 acceptance,
   * PR4-2b) — there is no fallback `github.closeIssue` call site here.
   * Tests that need close behaviour must construct the orchestrator
   * with a {@link DirectCloseChannel} (typically via
   * `BootKernel.boot`).
   */
  #directClose?: DirectCloseChannel;
  /**
   * `OutboxClosePreChannel` reference from `BootArtifacts.outboxClosePre`
   * (PR4-3). Threaded into the `OutboxProcessor` so close-issue
   * OutboxActions go through the channel's `handleCloseAction`
   * (CloseTransport.close + IssueClosed/Failed publish) rather than
   * the direct `github.closeIssue` call site that was deleted in
   * T4.4b. Optional for legacy fixtures that bypass `BootKernel.boot`.
   */
  #outboxClosePre?: OutboxClosePreChannel;
  /**
   * `OutboxClosePostChannel` reference from
   * `BootArtifacts.outboxClosePost` (PR4-3). Drives the post-close
   * outbox drain (comments, label updates, project removals) after a
   * successful close. Replaces the inline `processPostClose` call site
   * that lived in `#runInner` until T4.4b.
   */
  #outboxClosePost?: OutboxClosePostChannel;
  /**
   * `MergeCloseAdapter` reference from `BootArtifacts.mergeCloseAdapter`
   * (PR4-4 T4.5). At every `run()` finally-boundary the orchestrator
   * calls `mergeCloseAdapter.drain()` so any merge-close-fact
   * accumulated by a `merge-pr` subprocess during this run lands on
   * the bus as `IssueClosedEvent({ channel: "M" })` before the run
   * returns — preserving the R5 hard gate that close events surface
   * uniformly across all 6 channels regardless of mode (11 §C step 5).
   *
   * Optional because legacy fixtures that bypass `BootKernel.boot`
   * (StubDispatcher tests) do not construct an adapter; in that case
   * the drain step is skipped.
   */
  #mergeCloseAdapter?:
    import("../channels/merge-close-adapter.ts").MergeCloseAdapter;

  /**
   * Construct an `Orchestrator`.
   *
   * @param config          Frozen WorkflowConfig (Layer 4, design 20 §B).
   * @param github          GitHub client.
   * @param dispatcher      Pre-constructed dispatcher. The orchestrator
   *                        does NOT construct one itself, so the caller
   *                        chooses between {@link RunnerDispatcher}
   *                        (which already holds the frozen
   *                        {@link AgentRegistry}) and
   *                        {@link StubDispatcher} (tests).
   * @param cwd             Working directory; defaults to `Deno.cwd()`.
   * @param artifactEmitter Optional emitter for handoff artifacts.
   * @param agentRegistry   Frozen `AgentRegistry` from
   *                        `BootArtifacts.agentRegistry` (T2.3). Threaded
   *                        through to {@link BatchRunner} so a sub-batch
   *                        path keeps the same Layer-4 reference.
   *                        Optional in T2.3 because StubDispatcher tests
   *                        do not need a registry; T2.4 wires this from
   *                        entry points.
   * @param bus             T3.3 (shadow mode): frozen `CloseEventBus`
   *                        from `BootArtifacts.bus`. The orchestrator
   *                        publishes `dispatchPlanned` /
   *                        `dispatchCompleted` / `transitionComputed` /
   *                        `issueClosed`(channel "D") /
   *                        `issueCloseFailed`(channel "D") /
   *                        `siblingsAllClosed` for each cycle. Optional
   *                        — every existing test fixture (StubDispatcher
   *                        based) constructs without a bus, in which
   *                        case the publish calls short-circuit.
   * @param runId           Stable boot correlation id; paired with
   *                        {@link bus}.
   */
  constructor(
    config: WorkflowConfig,
    github: GitHubClient,
    dispatcher: AgentDispatcher,
    cwd?: string,
    artifactEmitter?: ArtifactEmitter,
    agentRegistry?: AgentRegistry,
    bus?: CloseEventBus,
    runId?: string,
    directClose?: DirectCloseChannel,
    outboxClosePre?: OutboxClosePreChannel,
    outboxClosePost?: OutboxClosePostChannel,
    mergeCloseAdapter?:
      import("../channels/merge-close-adapter.ts").MergeCloseAdapter,
  ) {
    this.#config = config;
    this.#github = github;
    this.#dispatcher = dispatcher;
    this.#cwd = cwd ?? Deno.cwd();
    this.#artifactEmitter = artifactEmitter;
    this.#agentRegistry = agentRegistry;
    this.#bus = bus;
    this.#runId = runId;
    this.#directClose = directClose;
    this.#outboxClosePre = outboxClosePre;
    this.#outboxClosePost = outboxClosePost;
    this.#mergeCloseAdapter = mergeCloseAdapter;
  }

  /** Derive a stable workflow identity from config for state file isolation. */
  get workflowId(): string {
    return this.#config.labelPrefix ?? "default";
  }

  async run(
    subjectId: string | number,
    options?: OrchestratorOptions,
    store?: SubjectStore,
    logger?: OrchestratorLogger,
  ): Promise<OrchestratorResult> {
    const ownsLogger = !logger;
    const log = logger ??
      await OrchestratorLogger.create(this.#cwd, {
        verbose: options?.verbose,
      });

    // Preflight label sync — only when this orchestrator owns the logger,
    // i.e. single-issue mode where BatchRunner has NOT already synced.
    // The BatchRunner passes its own logger in, so we use that as the
    // "running inside a batch" signal to avoid double-syncing.
    if (ownsLogger) {
      await this.#preflightLabelSync(log, options?.dryRun ?? false);
    }

    // Acquire per-issue lock when store is available to prevent
    // concurrent invocations on the same issue.
    const issueLock = store
      ? await store.acquireIssueLock(this.workflowId, subjectId)
      : undefined;

    if (store && issueLock === null) {
      await log.info(
        `Subject #${subjectId} is already being processed, skipping`,
        { event: "issue_locked", subjectId, workflowId: this.workflowId },
      );
      if (ownsLogger) await log.close();
      return {
        subjectId,
        finalPhase: "unknown",
        cycleCount: 0,
        history: [],
        status: "blocked",
      };
    }

    try {
      return await this.#runInner(
        subjectId,
        options,
        store,
        this.workflowId,
        log,
      );
    } finally {
      // PR4-4 T4.5: drain merge-close-facts so any merge-pr subprocess
      // that completed during this run surfaces its
      // `IssueClosedEvent({ channel: "M" })` on the bus before the
      // orchestrator returns. drain() is fail-soft (missing fact file
      // returns zero published) so the absence of merge-pr in this
      // run is harmless. Errors from drain do not propagate — the
      // primary run result stays authoritative.
      if (this.#mergeCloseAdapter !== undefined) {
        try {
          await this.#mergeCloseAdapter.drain();
        } catch (cause) {
          const msg = cause instanceof Error ? cause.message : String(cause);
          await log.warn(
            `MergeCloseAdapter.drain failed: ${msg}`,
            { event: "merge_close_drain_failed", error: msg },
          );
        }
      }
      issueLock?.release();
      if (ownsLogger) await log.close();
    }
  }

  /**
   * Single-shot dispatch entry point (T5.3, R2b cutover).
   *
   * Wraps `run(item.subjectId, ...)` with the `SubjectQueueItem.source`
   * forwarded into `OrchestratorOptions.dispatchSource` so the
   * `dispatchPlanned` event payload reflects the picker mode (design
   * 11 §B / 30 §B). Callers (e.g. `run-agent.ts` after the R2b cutover
   * or any other consumer holding a `SubjectPicker`) call `pick()` once
   * and pass the resulting length-1 / length-N item through here so the
   * close path is structurally identical to workflow mode (R5 hard
   * gate, 11 §C).
   *
   * The method does NOT short-circuit any of `run()`'s steps —
   * preflight label sync, lock acquisition, mergeCloseAdapter drain are
   * all unchanged. The only difference is `dispatchSource` defaults to
   * `item.source` so events surface the argv-lifted vs IssueSyncer
   * provenance.
   */
  runOne(
    item: import("./subject-picker.ts").SubjectQueueItem,
    options?: OrchestratorOptions,
    store?: SubjectStore,
    logger?: OrchestratorLogger,
  ): Promise<OrchestratorResult> {
    return this.run(
      item.subjectId,
      { ...options, dispatchSource: options?.dispatchSource ?? item.source },
      store,
      logger,
    );
  }

  async #runInner(
    subjectId: string | number,
    options: OrchestratorOptions | undefined,
    store: SubjectStore | undefined,
    workflowId: string | undefined,
    log: OrchestratorLogger,
  ): Promise<OrchestratorResult> {
    const dryRun = options?.dryRun ?? false;
    const maxCycles = this.#config.rules.maxCycles;
    const maxConsecutivePhases = this.#config.rules.maxConsecutivePhases ?? 0;
    const wfId = workflowId ?? this.workflowId;

    const origin = detectRuntimeOrigin(import.meta.url);
    await log.info(`Run start subject #${subjectId}`, {
      event: "run_start",
      subjectId,
      workflowId: wfId,
      dryRun,
      climptVersion: origin.version,
      climptSource: origin.source,
      climptModuleUrl: origin.moduleUrl,
    });

    // Restore cycle tracker from persisted state if available.
    //
    // Staleness detection: labels are the source of truth for the current
    // phase. If a user manually relabels an issue (e.g. removes `done`,
    // adds `kind:consider` to retry), the persisted `currentPhase` will
    // lag behind the live labels. Treat that divergence as explicit retry
    // intent and drop the cycle history so `maxCycles` doesn't block the
    // new run. This is a one-way regression detection — label state wins.
    //
    // Synthesized (argv-lift) mode is single-shot by design (design 11 §B
    // "queue 長 1、cycle 1 回"). It does not consult or persist
    // workflow-state — every `--agent <id> --issue N` invocation is a
    // fresh single-cycle run. Persistence is workflow-mode semantics.
    let tracker: CycleTracker;
    if (store && !this.#config.synthesized) {
      const existingState = await store.readWorkflowState(subjectId, wfId);
      if (existingState) {
        const livePhaseId = await this.#resolveLivePhaseId(
          subjectId,
          store,
          log,
        );
        if (
          livePhaseId !== null &&
          existingState.currentPhase !== livePhaseId
        ) {
          await log.info(
            `State reset for subject #${subjectId}: persisted phase ` +
              `"${existingState.currentPhase}" was regressed to ` +
              `"${livePhaseId}" via labels`,
            {
              event: "state_reset_by_label_regression",
              subjectId,
              workflowId: wfId,
              persistedPhase: existingState.currentPhase,
              resolvedPhase: livePhaseId,
            },
          );
          tracker = CycleTracker.fromState(
            { ...existingState, history: [], cycleCount: 0 },
            maxCycles,
            maxConsecutivePhases,
          );
        } else {
          tracker = CycleTracker.fromState(
            existingState,
            maxCycles,
            maxConsecutivePhases,
          );
        }
      } else {
        tracker = new CycleTracker(maxCycles, maxConsecutivePhases);
      }
    } else {
      tracker = new CycleTracker(maxCycles, maxConsecutivePhases);
    }

    let finalPhase = "unknown";
    let status: OrchestratorResult["status"] = "blocked";
    let issueClosed = false;

    // Each cycle depends on the previous: labels are read, agent dispatched,
    // labels updated, then re-read. Awaits must be sequential.
    while (true) {
      // Step 3: Get current labels (prefer store when available)
      let currentLabels: string[];
      try {
        if (store) {
          // deno-lint-ignore no-await-in-loop
          const meta = await store.readMeta(subjectId);
          currentLabels = meta.labels;
        } else {
          // deno-lint-ignore no-await-in-loop
          currentLabels = await this.#github.getIssueLabels(subjectId);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-await-in-loop
        await log.error(
          `Failed to get labels for subject #${subjectId}: ${msg}`,
          {
            event: "labels_error",
            subjectId,
            error: msg,
          },
        );
        status = "blocked";
        break;
      }

      // deno-lint-ignore no-await-in-loop
      await log.info(`Labels: [${currentLabels.join(", ")}]`, {
        event: "labels",
        subjectId,
        labels: currentLabels,
      });

      // Step 4: Resolve phase
      // First check for terminal/blocking phases before resolving actionable
      const terminalOrBlocking = resolveTerminalOrBlocking(
        currentLabels,
        this.#config,
      );
      if (terminalOrBlocking) {
        finalPhase = terminalOrBlocking.phaseId;
        status = terminalOrBlocking.phase.type === "terminal"
          ? "completed"
          : "blocked";
        // deno-lint-ignore no-await-in-loop
        await log.info(`Phase "${finalPhase}" is ${status}`, {
          event: "phase_terminal_or_blocked",
          subjectId,
          phase: finalPhase,
          status,
        });
        break;
      }

      // argv-lift mode (design 11 §B): synthesised workflows have
      // exactly one actionable phase, fixed at boot from `--agent`.
      // Phase resolution does not consult issue labels — the mode
      // differs from run-workflow only in input source, not in
      // label-gate semantics.
      let resolved: ReturnType<typeof resolvePhase>;
      if (this.#config.synthesized) {
        const actionable = Object.entries(this.#config.phases).find(
          ([, p]) => p.type === "actionable",
        );
        resolved = actionable
          ? { phaseId: actionable[0], phase: actionable[1] }
          : null;
      } else {
        resolved = resolvePhase(currentLabels, this.#config);
      }
      if (resolved === null) {
        finalPhase = "unknown";
        status = "blocked";
        // deno-lint-ignore no-await-in-loop
        await log.info("No actionable phase found, blocking", {
          event: "phase_unresolved",
          subjectId,
        });
        break;
      }

      const { phaseId } = resolved;
      finalPhase = phaseId;

      // deno-lint-ignore no-await-in-loop
      await log.info(`Resolved phase: "${phaseId}"`, {
        event: "phase_resolved",
        subjectId,
        phase: phaseId,
      });

      // Step 5: Resolve agent
      const agentResolution = resolveAgent(phaseId, this.#config);
      if (agentResolution === null) {
        status = "blocked";
        // deno-lint-ignore no-await-in-loop
        await log.warn(`No agent found for phase "${phaseId}"`, {
          event: "agent_unresolved",
          subjectId,
          phase: phaseId,
        });
        break;
      }

      const { agentId, agent } = agentResolution;

      // Step 6a: Phase repetition check (L3) — evaluated before L1 maxCycles
      // so stuck patterns surface a specific status / event rather than
      // being absorbed by the generic cycle_exceeded path.
      if (tracker.isPhaseRepetitionExceeded(subjectId)) {
        status = "phase_repetition_exceeded";
        // deno-lint-ignore no-await-in-loop
        await log.warn(
          `Same phase repeated ${
            tracker.getConsecutiveCount(subjectId)
          } times consecutively (limit ${maxConsecutivePhases})`,
          {
            event: "consecutive_phase_exceeded",
            subjectId,
            phase: phaseId,
            consecutiveCount: tracker.getConsecutiveCount(subjectId),
            maxConsecutivePhases,
          },
        );
        break;
      }

      // Step 6b: Cycle check
      if (tracker.isExceeded(subjectId)) {
        status = "cycle_exceeded";
        // deno-lint-ignore no-await-in-loop
        await log.warn(
          `Cycle limit exceeded (${tracker.getCount(subjectId)}/${maxCycles})`,
          {
            event: "cycle_exceeded",
            subjectId,
            cycleCount: tracker.getCount(subjectId),
            maxCycles,
          },
        );
        break;
      }

      // dry-run: log what would happen, skip dispatch
      if (dryRun) {
        // deno-lint-ignore no-await-in-loop
        await log.info(
          `[dry-run] Would dispatch agent "${agentId}" for subject #${subjectId}`,
          { event: "dry_run", subjectId, agent: agentId },
        );
        status = "dry-run";
        break;
      }

      // deno-lint-ignore no-await-in-loop
      await log.info(
        `Dispatching agent "${agentId}" for subject #${subjectId}`,
        { event: "dispatch", subjectId, agent: agentId },
      );

      // Step 7: Dispatch agent
      // Load any previously-persisted workflow payload so the agent can
      // observe prior handoff outputs via issuePayload / runnerArgs.
      // Standalone mode (T5.3 R2b cutover) has no store but the entry
      // point already projected argv → `options.initialPayload`; use it
      // when the store-backed lookup is absent or returns nothing.
      let payload;
      if (store) {
        // deno-lint-ignore no-await-in-loop
        payload = await store.readWorkflowPayload(subjectId, wfId);
      }
      if (payload === undefined && options?.initialPayload !== undefined) {
        payload = options.initialPayload;
      }

      // T3.3 + T5.3: publish DispatchPlanned just before the dispatcher
      // runs. The `source` field discriminates the picker mode (design
      // 11 §B / 30 §B):
      //   - "workflow" — fed by IssueSyncer (BatchRunner / single-issue
      //     `--issue` invoked through `Orchestrator.run`).
      //   - "argv"     — argv-lifted SubjectQueue (run-agent standalone
      //     via `Orchestrator.runOne`, T5.3 R2b cutover).
      // Defaults to "workflow" so legacy callers keep their event shape.
      this.#bus?.publish({
        kind: "dispatchPlanned",
        publishedAt: Date.now(),
        runId: this.#runId ?? "",
        subjectId,
        agentId,
        phase: phaseId,
        source: options?.dispatchSource ?? "workflow",
      });

      // deno-lint-ignore no-await-in-loop
      const dispatchResult = await this.#dispatcher.dispatch(
        agentId,
        subjectId,
        {
          verbose: options?.verbose ?? false,
          issueStorePath: store?.storePath,
          outboxPath: store?.getOutboxPath(subjectId),
          payload,
        },
      );

      // T3.3 (shadow mode): publish DispatchCompleted on the success
      // path. A dispatcher exception escapes the cycle entirely (no
      // catch around `dispatch`); F7 keeps this publish symmetric
      // because failures surface elsewhere (issueCloseFailed, log
      // events). T4 channels can subscribe and reason about successful
      // dispatches without inspecting the error path.
      this.#bus?.publish({
        kind: "dispatchCompleted",
        publishedAt: Date.now(),
        runId: this.#runId ?? "",
        subjectId,
        agentId,
        phase: phaseId,
        outcome: dispatchResult.outcome,
      });

      // deno-lint-ignore no-await-in-loop
      await log.info(
        `Agent "${agentId}" outcome: "${dispatchResult.outcome}" (${dispatchResult.durationMs}ms)`,
        {
          event: "dispatch_result",
          subjectId,
          agent: agentId,
          outcome: dispatchResult.outcome,
          durationMs: dispatchResult.durationMs,
        },
      );

      // Step 7a: Handoff emission
      // Filter declarative handoffs by source agent id and outcome, then
      // let the emitter resolve payload + write artifact + optionally
      // persist to issue store. Fail-fast on any error per design §3.2.
      if (
        this.#artifactEmitter && this.#config.handoffs &&
        dispatchResult.structuredOutput
      ) {
        const matching = this.#config.handoffs.filter((h) =>
          h.when.fromAgent === agentId &&
          h.when.outcome === dispatchResult.outcome
        );
        for (const handoff of matching) {
          try {
            // deno-lint-ignore no-await-in-loop
            const { artifactPath } = await this.#artifactEmitter.emit({
              workflowId: wfId,
              subjectId,
              sourceAgent: agentId,
              sourceOutcome: dispatchResult.outcome,
              agentResult: dispatchResult.structuredOutput,
              handoff,
            });
            // deno-lint-ignore no-await-in-loop
            await log.info(
              `Handoff "${handoff.id}" emitted → ${artifactPath}`,
              {
                event: "handoff_emitted",
                subjectId,
                handoffId: handoff.id,
                artifactPath,
              },
            );
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            // deno-lint-ignore no-await-in-loop
            await log.error(
              `Handoff "${handoff.id}" failed: ${msg}`,
              {
                event: "handoff_error",
                subjectId,
                handoffId: handoff.id,
                error: msg,
              },
            );
            throw error;
          }
        }
      }

      // Step 7a.5: Expand agent-declared `deferred_items[]` into outbox
      // `create-issue` actions, so the follow-up issues are filed before
      // the current issue closes in T6. See issue #480.
      // Idempotency: already-confirmed items are skipped (issue #484).
      //
      // C2 guard (issue #485): deferred_items are emitted ONLY when the
      // issue will close in this cycle (closeIntent === true). Emitting on
      // non-close paths (e.g. verdict:"blocked") causes duplicate creation
      // when the issue is re-dispatched after blocker resolution, even with
      // C1 idempotency keys — the structuredOutput may differ between
      // cycles, producing distinct keys for semantically identical items.
      const { targetPhase: earlyTargetPhase } = computeTransition(
        agent,
        dispatchResult.outcome,
      );
      const earlyIsTerminal =
        this.#config.phases[earlyTargetPhase]?.type === "terminal";
      // closeBinding-driven close intent (design 13 §F):
      // - primary.kind === "direct" enables close on terminal-bound transitions
      // - primary.kind === "none" disables close
      // - condition (when set) gates close on outcome equality
      const closeBinding = agent.closeBinding;
      const wantsClose = closeBinding?.primary.kind === "direct";
      const conditionMatch = closeBinding?.condition === undefined ||
        closeBinding.condition === dispatchResult.outcome;
      const closeIntentForDeferred = !dryRun && earlyIsTerminal &&
        wantsClose && conditionMatch;

      const deferredEmitter = store
        ? new DeferredItemsEmitter(store)
        : undefined;
      let deferredEmittedKeys: readonly string[] = [];
      let deferredEmittedPaths: readonly string[] = [];
      if (
        deferredEmitter && dispatchResult.structuredOutput &&
        closeIntentForDeferred
      ) {
        // Hook O2: Project inheritance for deferred child issues (§2.4 / §6.3)
        // When projectBinding.inheritProjectsForCreateIssue is enabled,
        // resolve parent project memberships and pass them to the emitter
        // so child issues inherit the parent's projects.
        // On failure, skip silently and emit without project context.
        let parentProjects:
          | readonly { owner: string; number: number }[]
          | undefined;
        if (this.#config.projectBinding?.inheritProjectsForCreateIssue) {
          try {
            // deno-lint-ignore no-await-in-loop
            parentProjects = await this.#github.getIssueProjects(
              Number(subjectId),
            );
            if (parentProjects.length > 0) {
              // deno-lint-ignore no-await-in-loop
              await log.info(
                `O2: Parent projects resolved for #${subjectId}: ${
                  parentProjects.map((p) => `${p.owner}/${p.number}`).join(
                    ", ",
                  )
                }`,
                {
                  event: "o2_parent_projects_resolved",
                  subjectId,
                  projects: parentProjects.map((p) => `${p.owner}/${p.number}`),
                },
              );
            }
          } catch (o2Error) {
            const o2Msg = o2Error instanceof Error
              ? o2Error.message
              : String(o2Error);
            // deno-lint-ignore no-await-in-loop
            await log.warn(
              `O2: Project inheritance skipped for #${subjectId}: ${o2Msg}`,
              {
                event: "o2_project_inheritance_skipped",
                subjectId,
              },
            );
            // Continue emission without parent projects (§6.3).
          }
        }

        try {
          // deno-lint-ignore no-await-in-loop
          const deferredResult = await deferredEmitter.emit(
            subjectId,
            dispatchResult.structuredOutput,
            parentProjects,
          );
          deferredEmittedKeys = deferredResult.emittedKeys;
          deferredEmittedPaths = deferredResult.paths;
          if (deferredResult.count > 0) {
            // deno-lint-ignore no-await-in-loop
            await log.info(
              `Deferred items emitted: ${deferredResult.count} create-issue actions queued`,
              {
                event: "deferred_items_emitted",
                subjectId,
                count: deferredResult.count,
              },
            );
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          // deno-lint-ignore no-await-in-loop
          await log.error(
            `Deferred items emission failed: ${msg}`,
            {
              event: "deferred_items_error",
              subjectId,
              error: msg,
            },
          );
          throw error;
        }
      } else if (
        deferredEmitter && dispatchResult.structuredOutput &&
        !closeIntentForDeferred
      ) {
        // C2: log suppression so operator can trace the guard in action.
        // deno-lint-ignore no-await-in-loop
        await log.info(
          `Deferred items skipped: issue will not close this cycle ` +
            `(outcome="${dispatchResult.outcome}", ` +
            `targetPhase="${earlyTargetPhase}")`,
          {
            event: "deferred_items_skipped",
            subjectId,
            outcome: dispatchResult.outcome,
            targetPhase: earlyTargetPhase,
            reason: "close_intent_false",
          },
        );
      }

      // Step 7b: Process outbox after agent dispatch (when store available)
      if (store) {
        const outboxProcessor = new OutboxProcessor(
          this.#github,
          store,
          this.#bus,
          this.#runId,
          this.#outboxClosePre,
        );
        // deno-lint-ignore no-await-in-loop
        const outboxResults = await outboxProcessor.process(subjectId);

        if (outboxResults.length > 0) {
          const succeeded = outboxResults.filter((r) => r.success);
          const failed = outboxResults.filter((r) => !r.success);

          // deno-lint-ignore no-await-in-loop
          await log.info(
            `Outbox: ${outboxResults.length} actions (${succeeded.length} ok, ${failed.length} failed)`,
            {
              event: "outbox_processed",
              subjectId,
              total: outboxResults.length,
              succeeded: succeeded.length,
              failed: failed.length,
            },
          );

          for (const fail of failed) {
            // deno-lint-ignore no-await-in-loop
            await log.warn(
              `Outbox action failed: ${fail.action} (seq ${fail.sequence}): ${fail.error}`,
              {
                event: "outbox_action_failed",
                subjectId,
                action: fail.action,
                sequence: fail.sequence,
                error: fail.error,
              },
            );
          }

          if (failed.length > 0) {
            // deno-lint-ignore no-await-in-loop
            await log.warn(
              `Outbox not cleared: ${failed.length} failed actions remain for retry`,
              {
                event: "outbox_not_cleared",
                subjectId,
                failedCount: failed.length,
              },
            );
          }

          // Step 7b.1: Confirm deferred-item idempotency keys for
          // individually succeeded items. Previously all-or-nothing: keys
          // were persisted only when every outbox action succeeded, causing
          // the emitter to re-emit succeeded items on the next cycle after
          // partial failure. Now confirms per-succeeded-item so the emitter
          // skips them. See issues #484, #486.
          if (
            deferredEmitter && deferredEmittedKeys.length > 0 &&
            deferredEmittedPaths.length === deferredEmittedKeys.length
          ) {
            // Build filename→key map from emitter paths.
            const filenameToKey = new Map<string, string>();
            for (let i = 0; i < deferredEmittedPaths.length; i++) {
              const path = deferredEmittedPaths[i];
              const slash = path.lastIndexOf("/");
              const basename = slash >= 0 ? path.slice(slash + 1) : path;
              filenameToKey.set(basename, deferredEmittedKeys[i]);
            }
            const succeededKeys: string[] = [];
            for (const result of succeeded) {
              const key = filenameToKey.get(result.filename);
              if (key !== undefined) {
                succeededKeys.push(key);
              }
            }
            if (succeededKeys.length > 0) {
              // deno-lint-ignore no-await-in-loop
              await deferredEmitter.confirmEmitted(
                subjectId,
                succeededKeys,
              );
            }
          }
        }
      }

      // Step 7c: Rate limit throttle check
      if (dispatchResult.rateLimitInfo) {
        const rateLimiter = new RateLimiter(
          this.#config.rules.rateLimitThreshold ?? 0.95,
          this.#config.rules.rateLimitPollIntervalMs ?? 300_000,
        );
        // deno-lint-ignore no-await-in-loop
        await rateLimiter.checkAndThrottle(
          dispatchResult.rateLimitInfo,
          log,
        );
      }

      // Step 8: Compute transition
      const { targetPhase } = computeTransition(
        agent,
        dispatchResult.outcome,
      );

      // PR4-2b: enrich the TransitionComputed snapshot with the inputs
      // DirectClose.decide needs (closeBinding, outcomeMatch,
      // isTerminal, agentId). The publisher does the pre-computation
      // because the channel's `decide` is required to be pure
      // (channels/types.ts §1; Critique F5).
      const targetPhaseDef = this.#config.phases[targetPhase];
      const isTerminal = targetPhaseDef?.type === "terminal";
      const isBlocking = targetPhaseDef?.type === "blocking";
      // T6.2: closeBinding is the source-of-truth on disk; the snapshot
      // is just a defensive copy plus a default for absence.
      const closeBindingSnapshot:
        import("../src_common/types/agent-bundle.ts").CloseBinding =
          agent.closeBinding ??
            { primary: { kind: "none" }, cascade: false };
      const outcomeMatch = closeBindingSnapshot.primary.kind === "direct" &&
        (closeBindingSnapshot.condition === undefined ||
          closeBindingSnapshot.condition === dispatchResult.outcome);
      const transitionEvent: TransitionComputedEvent = {
        kind: "transitionComputed",
        publishedAt: Date.now(),
        runId: this.#runId ?? "",
        subjectId,
        fromPhase: phaseId,
        toPhase: targetPhase,
        outcome: dispatchResult.outcome,
        closeBinding: closeBindingSnapshot,
        outcomeMatch,
        agentId,
        isTerminal,
      };
      this.#bus?.publish(transitionEvent);

      // Step 9: Compute label changes
      const { labelsToRemove, labelsToAdd } = computeLabelChanges(
        currentLabels,
        targetPhase,
        this.#config,
      );

      // deno-lint-ignore no-await-in-loop
      await log.info(
        `Transition: "${phaseId}" -> "${targetPhase}" ` +
          `(remove: [${labelsToRemove.join(", ")}], add: [${
            labelsToAdd.join(", ")
          }])`,
        {
          event: "transition",
          subjectId,
          fromPhase: phaseId,
          toPhase: targetPhase,
          labelsToRemove,
          labelsToAdd,
        },
      );

      // PR4-2b — close cutover (W13 acceptance).
      //
      // The legacy saga-with-rollback was deleted. The new flow is a
      // straight-line sequence:
      //   T3  add-labels   (no compensation)
      //   T4  remove-labels (no compensation)
      //   T5  handoff comment (no compensation)
      //   T6  DirectClose channel (publishes IssueClosed/IssueCloseFailed;
      //       compensation is comment-only via CompensationCommentChannel)
      //   T6.post  outbox post-close (kept here pending PR4-3 migration)
      //   T6.eval  sentinel-cascade detection + evaluator trigger
      //            (kept here pending PR4-3 migration to CascadeClose)
      //   T7  local persist (best-effort)
      //
      // Why no rollback:
      //   - W13 (To-Be 41 §D) replaces the LIFO label rollback with a
      //     comment-only compensation. Labels written before a close
      //     fail are observable next cycle; the next-cycle re-read
      //     self-heals divergence.
      //   - The cycle status no longer flips to "blocked" on close
      //     failure. Close success/failure is observable only via the
      //     bus event log (IssueClosedEvent / IssueCloseFailedEvent
      //     with `channel: "D"`).
      if (!dryRun) {
        const preImage = [...currentLabels];
        let issueCloseAttemptedFailed = false;

        // T3: add-labels
        if (labelsToAdd.length > 0) {
          try {
            // deno-lint-ignore no-await-in-loop
            await this.#github.updateIssueLabels(subjectId, [], labelsToAdd);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            // deno-lint-ignore no-await-in-loop
            await log.warn(
              `T3 add-labels failed for subject #${subjectId}: ${msg}`,
              {
                event: "phase_transition_failed",
                subjectId,
                fromPhase: phaseId,
                toPhase: targetPhase,
                error: msg,
              },
            );
            status = "blocked";
            finalPhase = phaseId;
            break;
          }
        }

        // T4: remove-labels
        if (labelsToRemove.length > 0) {
          try {
            // deno-lint-ignore no-await-in-loop
            await this.#github.updateIssueLabels(
              subjectId,
              labelsToRemove,
              [],
            );
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            // deno-lint-ignore no-await-in-loop
            await log.warn(
              `T4 remove-labels failed for subject #${subjectId}: ${msg}`,
              {
                event: "phase_transition_failed",
                subjectId,
                fromPhase: phaseId,
                toPhase: targetPhase,
                error: msg,
              },
            );
            status = "blocked";
            finalPhase = phaseId;
            break;
          }
        }

        // T5: handoff comment
        if (this.#config.handoff) {
          const handoff = new HandoffManager(this.#config.handoff);
          try {
            // deno-lint-ignore no-await-in-loop
            await handoff.renderAndPost(
              this.#github,
              subjectId,
              agentId,
              dispatchResult.outcome,
              { ...dispatchResult.handoffData },
            );
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            // deno-lint-ignore no-await-in-loop
            await log.warn(
              `T5 handoff comment failed for subject #${subjectId}: ${msg}`,
              {
                event: "phase_transition_failed",
                subjectId,
                fromPhase: phaseId,
                toPhase: targetPhase,
                error: msg,
              },
            );
            status = "blocked";
            finalPhase = phaseId;
            break;
          }
        }

        // T6: DirectClose channel decides + executes the close write.
        // The orchestrator does NOT call gh.closeIssue itself anymore.
        // `handleTransition` returns true iff the channel actually
        // executed a close (decide → shouldClose → transport.close ok).
        // Per W13 we still proceed even on close failure: the channel
        // published IssueCloseFailed → CompensationCommentChannel
        // posted a marker comment → operator intervenes.
        if (this.#directClose !== undefined) {
          try {
            // deno-lint-ignore no-await-in-loop
            issueClosed = await this.#directClose.handleTransition(
              transitionEvent,
            );
          } catch (error) {
            // Close transport threw. The channel already published
            // IssueCloseFailed; CompensationCommentChannel handled the
            // comment side. We log and continue — cycle stays
            // "completed" if the target phase is terminal (W13).
            issueCloseAttemptedFailed = true;
            const msg = error instanceof Error ? error.message : String(error);
            // deno-lint-ignore no-await-in-loop
            await log.warn(
              `DirectClose execute failed for subject #${subjectId}: ${msg}`,
              {
                event: "issue_close_failed",
                subjectId,
                fromPhase: phaseId,
                toPhase: targetPhase,
                error: msg,
              },
            );
          }

          if (issueClosed) {
            // deno-lint-ignore no-await-in-loop
            await log.info(
              `Closed subject #${subjectId} (closeBinding, outcome="${dispatchResult.outcome}")`,
              {
                event: "issue_closed",
                subjectId,
                agent: agentId,
                outcome: dispatchResult.outcome,
              },
            );
          }
        }

        // T6.post: drain post-close outbox via OutboxClose-post channel
        // (PR4-3 / T4.4b cutover). The orchestrator hands the
        // per-cycle store to the channel; the channel constructs an
        // OutboxProcessor bound to the boot bus + runId and drains
        // actions tagged `trigger: "post-close"`. Replaces the inline
        // `new OutboxProcessor(...).processPostClose(subjectId)` site.
        if (issueClosed && store && this.#outboxClosePost) {
          // deno-lint-ignore no-await-in-loop
          const postCloseResults = await this.#outboxClosePost.handlePostClose(
            subjectId,
            store,
          );
          if (postCloseResults.length > 0) {
            const pcSucceeded = postCloseResults.filter((r) => r.success);
            const pcFailed = postCloseResults.filter((r) => !r.success);
            // deno-lint-ignore no-await-in-loop
            await log.info(
              `Post-close outbox: ${postCloseResults.length} actions ` +
                `(${pcSucceeded.length} ok, ${pcFailed.length} failed)`,
              {
                event: "post_close_outbox_processed",
                subjectId,
                total: postCloseResults.length,
                succeeded: pcSucceeded.length,
                failed: pcFailed.length,
              },
            );
            for (const fail of pcFailed) {
              // deno-lint-ignore no-await-in-loop
              await log.warn(
                `Post-close action failed: ${fail.action} (seq ${fail.sequence}): ${fail.error}`,
                {
                  event: "post_close_action_failed",
                  subjectId,
                  action: fail.action,
                  sequence: fail.sequence,
                  error: fail.error,
                },
              );
            }
          }
        }

        // T6.eval: sentinel-cascade detection + project completion check.
        // PR4-3 / T4.4b cutover: migrated to CascadeCloseChannel which
        // subscribes to `IssueClosedEvent` on the bus. The channel
        // queries `getIssueProjects` / `listProjectItems` /
        // `getIssueLabels`, publishes `SiblingsAllClosedEvent` when
        // every non-sentinel child is done, and applies the eval-label
        // transition on the sentinel. The orchestrator no longer
        // queries the project graph itself for completion eval.
        //
        // The DirectClose execute path already published
        // `IssueClosedEvent(channel: "D")` (PR4-2b), so the cascade
        // subscriber fires automatically. No synchronous orchestrator
        // call is needed here.

        // Record the cycle now that the forward operations are done.
        // Close failure (W13: comment-only compensation) does not
        // suppress the record — labels are committed on disk.
        tracker.record(
          subjectId,
          phaseId,
          targetPhase,
          agentId,
          dispatchResult.outcome,
        );
        void issueCloseAttemptedFailed;

        // T7: local persist — best-effort.
        // Synthesized mode skips persistence (design 11 §B: single-shot,
        // no re-run loop reads the state — symmetric with the read gate
        // above).
        if (store && !this.#config.synthesized) {
          const newLabels = preImage
            .filter((l) => !labelsToRemove.includes(l))
            .concat(labelsToAdd);
          try {
            // deno-lint-ignore no-await-in-loop
            await store.updateMeta(subjectId, { labels: newLabels });
          } catch {
            // non-fatal
          }
          try {
            // deno-lint-ignore no-await-in-loop
            await store.writeWorkflowState(
              subjectId,
              tracker.toState(subjectId, targetPhase),
              wfId,
            );
          } catch {
            // non-fatal
          }
        }
      } else {
        // dry-run: skip side-effects but still record the planned cycle so
        // history reflects the intended transition.
        tracker.record(
          subjectId,
          phaseId,
          targetPhase,
          agentId,
          dispatchResult.outcome,
        );
      }

      finalPhase = targetPhase;

      if (isTerminal) {
        status = "completed";
        break;
      }
      if (isBlocking) {
        status = "blocked";
        break;
      }

      // Step 13: Countdown between cycles (skip in dryRun)
      if (!dryRun && this.#config.rules.cycleDelayMs > 0) {
        // deno-lint-ignore no-await-in-loop
        await countdownDelay(this.#config.rules.cycleDelayMs, "Next cycle");
      }
    }

    const result: OrchestratorResult = {
      subjectId,
      finalPhase,
      cycleCount: tracker.getCount(subjectId),
      history: tracker.getHistory(subjectId),
      status,
    };

    await log.info(
      `Run end subject #${subjectId}: ${status} at "${finalPhase}" (${result.cycleCount} cycles)`,
      { event: "run_end", ...result },
    );

    return result;
  }

  /**
   * Resolve the current phase id from live labels for staleness detection.
   *
   * Prefers store meta (already the agreed source of truth for labels in
   * store-backed runs); falls back to github on read failure so the
   * regression check degrades gracefully rather than crashing the run.
   * Returns the phase id for terminal/blocking labels as well as
   * actionable ones so that any divergence from persisted state is
   * detected. Returns null when no mapped label is present or label
   * reads fail entirely — the caller keeps persisted state intact in
   * that case (conservative: never drop history without evidence).
   */
  async #resolveLivePhaseId(
    subjectId: string | number,
    store: SubjectStore,
    log: OrchestratorLogger,
  ): Promise<string | null> {
    let labels: string[];
    try {
      const meta = await store.readMeta(subjectId);
      labels = meta.labels;
    } catch {
      try {
        labels = await this.#github.getIssueLabels(subjectId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await log.warn(
          `Staleness check: failed to read labels for subject #${subjectId}: ${msg}`,
          { event: "staleness_check_skipped", subjectId, error: msg },
        );
        return null;
      }
    }

    // Staleness check uses a different precedence than the main loop.
    // Main loop is terminal-first to honour `closeBinding` close semantics;
    // here we want regression detection to fire when an actionable label
    // coexists with a terminal one (user retry intent), so the order is:
    //   1. blocking  — preserve manual stop intent
    //   2. actionable — treat as regression / retry intent
    //   3. terminal  — only when nothing else is set
    const terminalOrBlocking = resolveTerminalOrBlocking(
      labels,
      this.#config,
    );
    if (
      terminalOrBlocking && terminalOrBlocking.phase.type === "blocking"
    ) {
      return terminalOrBlocking.phaseId;
    }

    const actionable = resolvePhase(labels, this.#config);
    if (actionable) return actionable.phaseId;

    if (terminalOrBlocking) return terminalOrBlocking.phaseId;
    return null;
  }

  runBatch(
    source: IssueSource,
    options?: BatchOptions,
  ): Promise<BatchResult> {
    const runner = new BatchRunner(
      this,
      this.#config,
      this.#github,
      this.#dispatcher,
      this.#cwd,
      this.#agentRegistry,
      this.#bus,
      this.#runId,
    );
    return runner.run(source, options);
  }

  /**
   * Single-issue preflight sync. Mirrors BatchRunner.#preflightLabelSync
   * but runs only when no batch logger was passed in (i.e. the user
   * invoked `--issue` directly). Kept as an instance method so the
   * orchestrator can reconcile labels without callers reaching into
   * BatchRunner internals.
   */
  async #preflightLabelSync(
    log: OrchestratorLogger,
    dryRun: boolean,
  ): Promise<void> {
    const specs = this.#config.labels;
    if (!specs || Object.keys(specs).length === 0) {
      await log.info(
        "Label sync preflight skipped: no labels[] declared in workflow.json",
        { event: "label_sync_skipped" },
      );
      return;
    }

    await log.info(
      `Label sync preflight: ${Object.keys(specs).length} declared specs${
        dryRun ? " (dry-run)" : ""
      }`,
      { event: "label_sync_start", declaredCount: Object.keys(specs).length },
    );

    let results;
    try {
      results = await syncLabels(this.#github, specs, { dryRun });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await log.error(
        `Label sync preflight failed to read label state: ${msg}`,
        { event: "label_sync_baseline_failed", error: msg },
      );
      return;
    }

    await log.info(summarizeSync(results), {
      event: "label_sync_summary",
      dryRun,
      results,
    });

    for (const r of results) {
      if (r.action === "failed") {
        // deno-lint-ignore no-await-in-loop -- sequential log emission preserves per-label error ordering
        await log.error(
          `Label sync failed for "${r.name}": ${r.error ?? "unknown error"}`,
          { event: "label_sync_failed", label: r.name, error: r.error },
        );
      }
    }
  }
}
