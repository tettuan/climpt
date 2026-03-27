/**
 * Orchestrator - Main workflow execution loop
 *
 * Integrates label-resolver, phase-transition, cycle-tracker,
 * dispatcher, and github-client into a single-issue workflow loop.
 * Corresponds to ADK LoopAgent + SequentialAgent pattern.
 */

import {
  type BatchOptions,
  type BatchResult,
  type IssueCriteria,
  type OrchestratorOptions,
  type OrchestratorResult,
  type WorkflowConfig,
} from "./workflow-types.ts";
import type { GitHubClient } from "./github-client.ts";
import type { AgentDispatcher } from "./dispatcher.ts";
import { RateLimiter } from "./rate-limiter.ts";
import {
  resolveAgent,
  resolvePhase,
  resolveTerminalOrBlocking,
} from "./label-resolver.ts";
import { computeLabelChanges, computeTransition } from "./phase-transition.ts";
import { HandoffManager } from "./handoff-manager.ts";
import { CycleTracker } from "./cycle-tracker.ts";
import { IssueStore } from "./issue-store.ts";
import { OutboxProcessor } from "./outbox-processor.ts";
import { OrchestratorLogger } from "./orchestrator-logger.ts";
import { BatchRunner } from "./batch-runner.ts";

export type { OrchestratorOptions, OrchestratorResult };

export class Orchestrator {
  #config: WorkflowConfig;
  #github: GitHubClient;
  #dispatcher: AgentDispatcher;
  #cwd: string;

  constructor(
    config: WorkflowConfig,
    github: GitHubClient,
    dispatcher: AgentDispatcher,
    cwd?: string,
  ) {
    this.#config = config;
    this.#github = github;
    this.#dispatcher = dispatcher;
    this.#cwd = cwd ?? Deno.cwd();
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
    try {
      return await this.#runInner(
        issueNumber,
        options,
        store,
        this.workflowId,
        log,
      );
    } finally {
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

    // Restore cycle tracker from persisted state if available
    let tracker: CycleTracker;
    if (store) {
      const existingState = await store.readWorkflowState(issueNumber, wfId);
      tracker = existingState
        ? CycleTracker.fromState(existingState, maxCycles)
        : new CycleTracker(maxCycles);
    } else {
      tracker = new CycleTracker(maxCycles);
    }

    let finalPhase = "unknown";
    let status: OrchestratorResult["status"] = "blocked";

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
      // deno-lint-ignore no-await-in-loop
      const dispatchResult = await this.#dispatcher.dispatch(
        agentId,
        issueNumber,
        {
          verbose: options?.verbose ?? false,
          issueStorePath: store?.storePath,
          outboxPath: store?.getOutboxPath(issueNumber),
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

      // Step 7b: Process outbox after agent dispatch (when store available)
      if (store) {
        const outboxProcessor = new OutboxProcessor(this.#github, store);
        // deno-lint-ignore no-await-in-loop
        await outboxProcessor.process(issueNumber);
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
          {
            session_id: tracker.generateCorrelationId(agentId),
            issue_count: "1",
            summary:
              `Agent "${agentId}" completed with outcome "${dispatchResult.outcome}"`,
          },
        );
      }

      finalPhase = targetPhase;

      // Check if target phase is terminal or blocking
      const targetPhaseDef = this.#config.phases[targetPhase];
      if (targetPhaseDef) {
        if (targetPhaseDef.type === "terminal") {
          status = "completed";
          break;
        }
        if (targetPhaseDef.type === "blocking") {
          status = "blocked";
          break;
        }
      }

      // Step 13: Delay between cycles (skip in dryRun)
      if (!dryRun && this.#config.rules.cycleDelayMs > 0) {
        // deno-lint-ignore no-await-in-loop
        await this.#delay(this.#config.rules.cycleDelayMs);
      }
    }

    const result: OrchestratorResult = {
      issueNumber,
      finalPhase,
      cycleCount: tracker.getCount(issueNumber),
      history: tracker.getHistory(issueNumber),
      status,
    };

    await log.info(
      `Run end issue #${issueNumber}: ${status} at "${finalPhase}" (${result.cycleCount} cycles)`,
      { event: "run_end", ...result },
    );

    return result;
  }

  async runBatch(
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

  #delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
