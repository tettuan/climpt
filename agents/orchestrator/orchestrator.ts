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

export type { OrchestratorOptions, OrchestratorResult };

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
          );
        } else {
          tracker = CycleTracker.fromState(existingState, maxCycles);
        }
      } else {
        tracker = new CycleTracker(maxCycles);
      }
    } else {
      tracker = new CycleTracker(maxCycles);
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

      // Step 6: Cycle check
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

      // Step 10: Update labels
      if (!dryRun) {
        try {
          // deno-lint-ignore no-await-in-loop
          await this.#github.updateIssueLabels(
            issueNumber,
            labelsToRemove,
            labelsToAdd,
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          // deno-lint-ignore no-await-in-loop
          await log.warn(
            `Failed to update labels for issue #${issueNumber}: ${msg}`,
            { event: "label_update_failed", issueNumber, error: msg },
          );
          // Label update failure is not fatal; continue to next cycle
        }

        // Step 10b: Update store meta to reflect new labels
        if (store) {
          const newLabels = currentLabels
            .filter((l) => !labelsToRemove.includes(l))
            .concat(labelsToAdd);
          try {
            // deno-lint-ignore no-await-in-loop
            await store.updateMeta(issueNumber, { labels: newLabels });
          } catch {
            // Store update failure is not fatal
          }
        }
      }

      // Step 11: Record cycle
      tracker.record(
        issueNumber,
        phaseId,
        targetPhase,
        agentId,
        dispatchResult.outcome,
      );

      // Step 11b: Persist cycle tracker state
      if (store) {
        // deno-lint-ignore no-await-in-loop
        await store.writeWorkflowState(
          issueNumber,
          tracker.toState(issueNumber, targetPhase),
          wfId,
        );
      }

      // Step 12: Handoff comment
      if (!dryRun && this.#config.handoff) {
        const handoff = new HandoffManager(this.#config.handoff);
        // deno-lint-ignore no-await-in-loop
        await handoff.renderAndPost(
          this.#github,
          issueNumber,
          agentId,
          dispatchResult.outcome,
          { ...dispatchResult.handoffData },
        );
      }

      finalPhase = targetPhase;

      // Check if target phase is terminal or blocking
      const targetPhaseDef = this.#config.phases[targetPhase];
      if (targetPhaseDef) {
        if (targetPhaseDef.type === "terminal") {
          status = "completed";

          // closeOnComplete: close the GitHub issue when agent outcome leads to terminal
          if (!dryRun && agent.closeOnComplete) {
            const shouldClose = agent.closeCondition === undefined ||
              agent.closeCondition === dispatchResult.outcome;
            if (shouldClose) {
              try {
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
              } catch (error) {
                const msg = error instanceof Error
                  ? error.message
                  : String(error);
                // deno-lint-ignore no-await-in-loop
                await log.warn(
                  `Failed to close issue #${issueNumber}: ${msg}`,
                  {
                    event: "issue_close_failed",
                    issueNumber,
                    error: msg,
                  },
                );
                // Non-fatal: label transition succeeded, close is best-effort
              }
            }
          }

          break;
        }
        if (targetPhaseDef.type === "blocking") {
          status = "blocked";
          break;
        }
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
}
