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
  IssueCriteria,
  OrchestratorOptions,
  OrchestratorResult,
  WorkflowConfig,
} from "./workflow-types.ts";
import type { GitHubClient } from "./github-client.ts";
import type { AgentDispatcher } from "./dispatcher.ts";
import type { ArtifactEmitter } from "./artifact-emitter.ts";
import { RateLimiter } from "./rate-limiter.ts";
import {
  resolveAgent,
  resolvePhase,
  resolveTerminalOrBlocking,
} from "./label-resolver.ts";
import { computeLabelChanges, computeTransition } from "./phase-transition.ts";
import { HandoffManager } from "./handoff-manager.ts";
import { CycleTracker } from "./cycle-tracker.ts";
import type { IssueStore } from "./issue-store.ts";
import { OutboxProcessor } from "./outbox-processor.ts";
import { OrchestratorLogger } from "./orchestrator-logger.ts";
import { BatchRunner } from "./batch-runner.ts";
import { countdownDelay } from "./countdown.ts";
import { TransactionScope } from "./transaction-scope.ts";
import { summarizeSync, syncLabels } from "./label-sync.ts";

export type { OrchestratorOptions, OrchestratorResult };

/**
 * Idempotency marker for T6 compensation comments. Both producer
 * (rollback emits the comment) and consumer (pre-post dedup check via
 * `getRecentComments`) must route through this factory so the string
 * has a single source of truth. Used as idempotencyKey in the
 * CompensationRegistry as well.
 */
export const compensationMarker = (
  issueNumber: number,
  cycleSeq: number,
): string => `climpt-compensation:issue-${issueNumber}:cycle-${cycleSeq}`;

export class Orchestrator {
  #config: WorkflowConfig;
  #github: GitHubClient;
  #dispatcher: AgentDispatcher;
  #cwd: string;
  #artifactEmitter?: ArtifactEmitter;

  constructor(
    config: WorkflowConfig,
    github: GitHubClient,
    dispatcher: AgentDispatcher,
    cwd?: string,
    artifactEmitter?: ArtifactEmitter,
  ) {
    this.#config = config;
    this.#github = github;
    this.#dispatcher = dispatcher;
    this.#cwd = cwd ?? Deno.cwd();
    this.#artifactEmitter = artifactEmitter;
  }

  /** Derive a stable workflow identity from config for state file isolation. */
  get workflowId(): string {
    return this.#config.labelPrefix ?? "default";
  }

  async run(
    issueNumber: number,
    options?: OrchestratorOptions,
    store?: IssueStore,
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
      ? await store.acquireIssueLock(this.workflowId, issueNumber)
      : undefined;

    if (store && issueLock === null) {
      await log.info(
        `Issue #${issueNumber} is already being processed, skipping`,
        { event: "issue_locked", issueNumber, workflowId: this.workflowId },
      );
      if (ownsLogger) await log.close();
      return {
        issueNumber,
        finalPhase: "unknown",
        cycleCount: 0,
        history: [],
        status: "blocked",
      };
    }

    try {
      return await this.#runInner(
        issueNumber,
        options,
        store,
        this.workflowId,
        log,
      );
    } finally {
      issueLock?.release();
      if (ownsLogger) await log.close();
    }
  }

  async #runInner(
    issueNumber: number,
    options: OrchestratorOptions | undefined,
    store: IssueStore | undefined,
    workflowId: string | undefined,
    log: OrchestratorLogger,
  ): Promise<OrchestratorResult> {
    const dryRun = options?.dryRun ?? false;
    const maxCycles = this.#config.rules.maxCycles;
    const maxConsecutivePhases = this.#config.rules.maxConsecutivePhases ?? 0;
    const wfId = workflowId ?? this.workflowId;

    await log.info(`Run start issue #${issueNumber}`, {
      event: "run_start",
      issueNumber,
      workflowId: wfId,
      dryRun,
    });

    // Restore cycle tracker from persisted state if available.
    //
    // Staleness detection: labels are the source of truth for the current
    // phase. If a user manually relabels an issue (e.g. removes `done`,
    // adds `kind:consider` to retry), the persisted `currentPhase` will
    // lag behind the live labels. Treat that divergence as explicit retry
    // intent and drop the cycle history so `maxCycles` doesn't block the
    // new run. This is a one-way regression detection — label state wins.
    let tracker: CycleTracker;
    if (store) {
      const existingState = await store.readWorkflowState(issueNumber, wfId);
      if (existingState) {
        const livePhaseId = await this.#resolveLivePhaseId(
          issueNumber,
          store,
          log,
        );
        if (
          livePhaseId !== null &&
          existingState.currentPhase !== livePhaseId
        ) {
          await log.info(
            `State reset for issue #${issueNumber}: persisted phase ` +
              `"${existingState.currentPhase}" was regressed to ` +
              `"${livePhaseId}" via labels`,
            {
              event: "state_reset_by_label_regression",
              issueNumber,
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
          const meta = await store.readMeta(issueNumber);
          currentLabels = meta.labels;
        } else {
          // deno-lint-ignore no-await-in-loop
          currentLabels = await this.#github.getIssueLabels(issueNumber);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // deno-lint-ignore no-await-in-loop
        await log.error(
          `Failed to get labels for issue #${issueNumber}: ${msg}`,
          {
            event: "labels_error",
            issueNumber,
            error: msg,
          },
        );
        status = "blocked";
        break;
      }

      // deno-lint-ignore no-await-in-loop
      await log.info(`Labels: [${currentLabels.join(", ")}]`, {
        event: "labels",
        issueNumber,
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
          issueNumber,
          phase: finalPhase,
          status,
        });
        break;
      }

      const resolved = resolvePhase(currentLabels, this.#config);
      if (resolved === null) {
        finalPhase = "unknown";
        status = "blocked";
        // deno-lint-ignore no-await-in-loop
        await log.info("No actionable phase found, blocking", {
          event: "phase_unresolved",
          issueNumber,
        });
        break;
      }

      const { phaseId } = resolved;
      finalPhase = phaseId;

      // deno-lint-ignore no-await-in-loop
      await log.info(`Resolved phase: "${phaseId}"`, {
        event: "phase_resolved",
        issueNumber,
        phase: phaseId,
      });

      // Step 5: Resolve agent
      const agentResolution = resolveAgent(phaseId, this.#config);
      if (agentResolution === null) {
        status = "blocked";
        // deno-lint-ignore no-await-in-loop
        await log.warn(`No agent found for phase "${phaseId}"`, {
          event: "agent_unresolved",
          issueNumber,
          phase: phaseId,
        });
        break;
      }

      const { agentId, agent } = agentResolution;

      // Step 6a: Phase repetition check (L3) — evaluated before L1 maxCycles
      // so stuck patterns surface a specific status / event rather than
      // being absorbed by the generic cycle_exceeded path.
      if (tracker.isPhaseRepetitionExceeded(issueNumber)) {
        status = "phase_repetition_exceeded";
        // deno-lint-ignore no-await-in-loop
        await log.warn(
          `Same phase repeated ${
            tracker.getConsecutiveCount(issueNumber)
          } times consecutively (limit ${maxConsecutivePhases})`,
          {
            event: "consecutive_phase_exceeded",
            issueNumber,
            phase: phaseId,
            consecutiveCount: tracker.getConsecutiveCount(issueNumber),
            maxConsecutivePhases,
          },
        );
        break;
      }

      // Step 6b: Cycle check
      if (tracker.isExceeded(issueNumber)) {
        status = "cycle_exceeded";
        // deno-lint-ignore no-await-in-loop
        await log.warn(
          `Cycle limit exceeded (${
            tracker.getCount(issueNumber)
          }/${maxCycles})`,
          {
            event: "cycle_exceeded",
            issueNumber,
            cycleCount: tracker.getCount(issueNumber),
            maxCycles,
          },
        );
        break;
      }

      // dry-run: log what would happen, skip dispatch
      if (dryRun) {
        // deno-lint-ignore no-await-in-loop
        await log.info(
          `[dry-run] Would dispatch agent "${agentId}" for issue #${issueNumber}`,
          { event: "dry_run", issueNumber, agent: agentId },
        );
        status = "dry-run";
        break;
      }

      // deno-lint-ignore no-await-in-loop
      await log.info(
        `Dispatching agent "${agentId}" for issue #${issueNumber}`,
        { event: "dispatch", issueNumber, agent: agentId },
      );

      // Step 7: Dispatch agent
      // Load any previously-persisted workflow payload so the agent can
      // observe prior handoff outputs via issuePayload / runnerArgs.
      let payload;
      if (store) {
        // deno-lint-ignore no-await-in-loop
        payload = await store.readWorkflowPayload(issueNumber, wfId);
      }

      // deno-lint-ignore no-await-in-loop
      const dispatchResult = await this.#dispatcher.dispatch(
        agentId,
        issueNumber,
        {
          verbose: options?.verbose ?? false,
          issueStorePath: store?.storePath,
          outboxPath: store?.getOutboxPath(issueNumber),
          payload,
        },
      );

      // deno-lint-ignore no-await-in-loop
      await log.info(
        `Agent "${agentId}" outcome: "${dispatchResult.outcome}" (${dispatchResult.durationMs}ms)`,
        {
          event: "dispatch_result",
          issueNumber,
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
              issueNumber,
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
                issueNumber,
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
                issueNumber,
                handoffId: handoff.id,
                error: msg,
              },
            );
            throw error;
          }
        }
      }

      // Step 7b: Process outbox after agent dispatch (when store available)
      if (store) {
        const outboxProcessor = new OutboxProcessor(this.#github, store);
        // deno-lint-ignore no-await-in-loop
        const outboxResults = await outboxProcessor.process(issueNumber);

        if (outboxResults.length > 0) {
          const succeeded = outboxResults.filter((r) => r.success);
          const failed = outboxResults.filter((r) => !r.success);

          // deno-lint-ignore no-await-in-loop
          await log.info(
            `Outbox: ${outboxResults.length} actions (${succeeded.length} ok, ${failed.length} failed)`,
            {
              event: "outbox_processed",
              issueNumber,
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
                issueNumber,
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
                issueNumber,
                failedCount: failed.length,
              },
            );
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
          issueNumber,
          fromPhase: phaseId,
          toPhase: targetPhase,
          labelsToRemove,
          labelsToAdd,
        },
      );

      // Steps 10-12 (T1..T7): phase transition as a saga.
      // Contract: tmp/transaction-rollback/investigation/design.md §2.2.
      //   T1  pure plan (already computed above as labelsToRemove/labelsToAdd)
      //   T2  snapshot preImage = currentLabels
      //   T3  label add (compensation: remove the just-added labels)
      //   T4  label remove (compensation: restore preImage labels)
      //   T5  handoff comment (compensation: restore preImage labels — shares
      //       idempotency key with T4 so future dedup can collapse both)
      //   T6  close issue (compensation: post a marker-tagged comment so
      //       humans can intervene; label preImage restore is optional per
      //       §3.1 and elided here — next cycle's re-read self-heals labels)
      //   T7  local persist (store.updateMeta + writeWorkflowState) —
      //       best-effort, runs only after commit
      //
      // cycleTracker.record fires only on full T3..T6 success (before commit),
      // closing a latent bug where S2 failures still recorded a transition.
      const targetPhaseDef = this.#config.phases[targetPhase];
      const isTerminal = targetPhaseDef?.type === "terminal";
      const isBlocking = targetPhaseDef?.type === "blocking";
      const closeIntent = !dryRun && isTerminal && agent.closeOnComplete &&
        (agent.closeCondition === undefined ||
          agent.closeCondition === dispatchResult.outcome);

      if (!dryRun) {
        const preImage = [...currentLabels];
        const cycleSeq = tracker.getCount(issueNumber) + 1;
        const restoreLabelsKey = `restore-labels:${issueNumber}:${cycleSeq}`;
        const marker = compensationMarker(issueNumber, cycleSeq);
        const scope = new TransactionScope({ logger: log });

        try {
          // T3: add-labels (idempotent, reversible by removal)
          if (labelsToAdd.length > 0) {
            // deno-lint-ignore no-await-in-loop
            await scope.step(
              "add-labels",
              () =>
                this.#github.updateIssueLabels(issueNumber, [], labelsToAdd),
              () => ({
                label: "restore-labels",
                idempotencyKey: restoreLabelsKey,
                run: () =>
                  this.#github.updateIssueLabels(
                    issueNumber,
                    labelsToAdd,
                    [],
                  ),
              }),
            );
          }

          // T4: remove-labels (reversing T4 restores preImage, which
          //     re-adds anything we removed)
          if (labelsToRemove.length > 0) {
            // deno-lint-ignore no-await-in-loop
            await scope.step(
              "remove-labels",
              () =>
                this.#github.updateIssueLabels(
                  issueNumber,
                  labelsToRemove,
                  [],
                ),
              () => ({
                label: "restore-labels",
                idempotencyKey: restoreLabelsKey,
                run: () =>
                  this.#github.updateIssueLabels(
                    issueNumber,
                    [],
                    labelsToRemove,
                  ),
              }),
            );
          }

          // T5: handoff comment. Compensation is label-restore (same key
          //     as T4) — we rely on gh label ops being idempotent rather
          //     than deduping compensations in TransactionScope.
          if (this.#config.handoff) {
            const handoff = new HandoffManager(this.#config.handoff);
            // deno-lint-ignore no-await-in-loop
            await scope.step(
              "handoff-comment",
              () =>
                handoff.renderAndPost(
                  this.#github,
                  issueNumber,
                  agentId,
                  dispatchResult.outcome,
                  { ...dispatchResult.handoffData },
                ),
              () => ({
                label: "restore-labels",
                idempotencyKey: restoreLabelsKey,
                run: () =>
                  this.#github.updateIssueLabels(
                    issueNumber,
                    labelsToAdd, // undo T3
                    labelsToRemove, // undo T4
                  ),
              }),
            );
          }

          // T6: close issue. Compensation posts a marker-tagged comment
          //     requesting manual intervention; the marker is checked
          //     against recent comments to make the compensation idempotent
          //     across retries (design §3.3).
          //
          // Pre-register pattern (vs scope.step): TransactionScope.step()
          // only records a compensation *after* the action resolves, so a
          // step() whose action throws would never register its own
          // compensation. T6 is the one step where compensation-on-failure
          // is the entire contract (design §3.1 row 4), so we register the
          // compensation *before* the action and rely on commit() clearing
          // the stack on success / rollback() running it on failure.
          if (closeIntent) {
            scope.record({
              label: "compensation-comment",
              idempotencyKey: marker,
              run: async () => {
                try {
                  const recent = await this.#github.getRecentComments(
                    issueNumber,
                    20,
                  );
                  if (recent.some((c) => c.body.includes(marker))) {
                    return;
                  }
                } catch {
                  // Marker lookup is best-effort; proceed to post.
                }
                const body = `⚠️ 自動遷移失敗: 手動確認をお願いします\n\n` +
                  `phase 遷移 (${phaseId} → ${targetPhase}) で issue close ` +
                  `に失敗しました。\nラベルは元に戻されています。\n\n` +
                  `---\n<sub>🤖 ${marker}</sub>`;
                await this.#github.addIssueComment(issueNumber, body);
              },
            });
            // deno-lint-ignore no-await-in-loop
            await this.#github.closeIssue(issueNumber);
            issueClosed = true;
            // deno-lint-ignore no-await-in-loop
            await log.info(
              `Closed issue #${issueNumber} (closeOnComplete, outcome="${dispatchResult.outcome}")`,
              {
                event: "issue_closed",
                issueNumber,
                agent: agentId,
                outcome: dispatchResult.outcome,
              },
            );
          }

          // All T3..T6 steps succeeded. Record the cycle *before* commit
          // so a crash between tracker.record and commit still surfaces
          // the registered compensations on the next run. (commit()
          // itself is synchronous in effect, so the window is negligible.)
          tracker.record(
            issueNumber,
            phaseId,
            targetPhase,
            agentId,
            dispatchResult.outcome,
          );

          // deno-lint-ignore no-await-in-loop
          await scope.commit();
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          // deno-lint-ignore no-await-in-loop
          await log.warn(
            `Phase transition failed for issue #${issueNumber}: ${msg}`,
            {
              event: "phase_transition_failed",
              issueNumber,
              fromPhase: phaseId,
              toPhase: targetPhase,
              error: msg,
            },
          );
          // deno-lint-ignore no-await-in-loop
          const report = await scope.rollback(error);
          if (report.attempted > 0) {
            // deno-lint-ignore no-await-in-loop
            await log.warn(
              `Compensation ran for issue #${issueNumber}: ` +
                `${report.succeeded}/${report.attempted} succeeded` +
                (report.partial ? " (partial)" : ""),
              {
                event: "compensation_ran",
                issueNumber,
                attempted: report.attempted,
                succeeded: report.succeeded,
                failed: report.failed.map((f) => ({
                  label: f.label,
                  idempotencyKey: f.idempotencyKey,
                  error: f.error.message,
                })),
                partial: report.partial,
              },
            );
          }
          status = "blocked";
          finalPhase = phaseId;
          break;
        } finally {
          // Safety net: if neither commit nor rollback ran (e.g. exception
          // escaped outside the try), ensure compensations are flushed.
          if (!scope.isCommitted() && !scope.isRolledBack()) {
            // deno-lint-ignore no-await-in-loop
            await scope.rollback(new Error("scope not finalised"));
          }
        }

        // T7: local persist — best-effort. Next cycle re-reads labels from
        // the source of truth (gh / store meta) so any divergence here is
        // self-healed (design §3.1 row G5 / T7).
        if (store) {
          const newLabels = preImage
            .filter((l) => !labelsToRemove.includes(l))
            .concat(labelsToAdd);
          try {
            // deno-lint-ignore no-await-in-loop
            await store.updateMeta(issueNumber, { labels: newLabels });
          } catch {
            // non-fatal
          }
          try {
            // deno-lint-ignore no-await-in-loop
            await store.writeWorkflowState(
              issueNumber,
              tracker.toState(issueNumber, targetPhase),
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
          issueNumber,
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
      issueNumber,
      finalPhase,
      cycleCount: tracker.getCount(issueNumber),
      history: tracker.getHistory(issueNumber),
      status,
      ...(issueClosed ? { issueClosed } : {}),
    };

    await log.info(
      `Run end issue #${issueNumber}: ${status} at "${finalPhase}" (${result.cycleCount} cycles)`,
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
    issueNumber: number,
    store: IssueStore,
    log: OrchestratorLogger,
  ): Promise<string | null> {
    let labels: string[];
    try {
      const meta = await store.readMeta(issueNumber);
      labels = meta.labels;
    } catch {
      try {
        labels = await this.#github.getIssueLabels(issueNumber);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await log.warn(
          `Staleness check: failed to read labels for issue #${issueNumber}: ${msg}`,
          { event: "staleness_check_skipped", issueNumber, error: msg },
        );
        return null;
      }
    }

    // Staleness check uses a different precedence than the main loop.
    // Main loop is terminal-first to honour `closeOnComplete` semantics;
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
    criteria: IssueCriteria,
    options?: BatchOptions,
  ): Promise<BatchResult> {
    const runner = new BatchRunner(
      this,
      this.#config,
      this.#github,
      this.#dispatcher,
      this.#cwd,
    );
    return runner.run(criteria, options);
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
        await log.error(
          `Label sync failed for "${r.name}": ${r.error ?? "unknown error"}`,
          { event: "label_sync_failed", label: r.name, error: r.error },
        );
      }
    }
  }
}
