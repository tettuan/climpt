/**
 * Orchestrator - Main workflow execution loop
 *
 * Integrates label-resolver, phase-transition, cycle-tracker,
 * dispatcher, and github-client into a single-issue workflow loop.
 * Corresponds to ADK LoopAgent + SequentialAgent pattern.
 */

import { join } from "@std/path";
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
import { resolveAgent, resolvePhase, stripPrefix } from "./label-resolver.ts";
import {
  computeLabelChanges,
  computeTransition,
  renderTemplate,
} from "./phase-transition.ts";
import { CycleTracker } from "./cycle-tracker.ts";
import { IssueStore } from "./issue-store.ts";
import { IssueSyncer } from "./issue-syncer.ts";
import { OutboxProcessor } from "./outbox-processor.ts";
import { Prioritizer } from "./prioritizer.ts";
import { Queue } from "./queue.ts";
import { wfBatchPrioritizeMissingConfig } from "../shared/errors/config-errors.ts";
import { OrchestratorLogger } from "./orchestrator-logger.ts";

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
      const terminalOrBlocking = this.#resolveTerminalOrBlocking(currentLabels);
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
      if (!dryRun && this.#config.handoff?.commentTemplates) {
        const templateKey = this.#findHandoffTemplate(
          agentId,
          dispatchResult.outcome,
        );
        if (templateKey) {
          const template = this.#config.handoff.commentTemplates[templateKey];
          if (template) {
            const comment = renderTemplate(template, {
              session_id: tracker.generateCorrelationId(agentId),
              issue_count: "1",
              summary:
                `Agent "${agentId}" completed with outcome "${dispatchResult.outcome}"`,
            });
            // deno-lint-ignore no-await-in-loop
            await this.#github.addIssueComment(issueNumber, comment);
          }
        }
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

  /**
   * Check if any current label maps to a terminal or blocking phase.
   * Returns the highest-priority terminal/blocking match, or null.
   */
  #resolveTerminalOrBlocking(
    labels: string[],
  ): { phaseId: string; phase: { type: string } } | null {
    const prefix = this.#config.labelPrefix;
    for (const label of labels) {
      const bare = stripPrefix(label, prefix);
      if (bare === null) continue;

      const phaseId = this.#config.labelMapping[bare];
      if (phaseId === undefined) continue;

      const phase = this.#config.phases[phaseId];
      if (phase === undefined) continue;

      if (phase.type === "terminal" || phase.type === "blocking") {
        return { phaseId, phase };
      }
    }
    return null;
  }

  /**
   * Find matching handoff template key based on agent ID and outcome.
   * Convention: "{agentId}To{NextAgent}" for success, "{agentId}{Outcome}" otherwise.
   */
  #findHandoffTemplate(agentId: string, outcome: string): string | null {
    const templates = this.#config.handoff?.commentTemplates;
    if (!templates) return null;

    // Try exact match patterns
    const candidates = [
      `${agentId}${this.#capitalize(outcome)}`,
      `${agentId}To${this.#capitalize(outcome)}`,
    ];

    for (const key of candidates) {
      if (key in templates) return key;
    }

    return null;
  }

  #capitalize(s: string): string {
    if (s.length === 0) return s;
    return s[0].toUpperCase() + s.slice(1);
  }

  async runBatch(
    criteria: IssueCriteria,
    options?: BatchOptions,
  ): Promise<BatchResult> {
    const log = await OrchestratorLogger.create(this.#cwd, {
      verbose: options?.verbose,
    });

    try {
      const storeConfig = this.#config.issueStore ?? { path: ".agent/issues" };
      const storePath = join(this.#cwd, storeConfig.path);
      const store = new IssueStore(storePath);

      const wfId = this.workflowId;
      await log.info(`Batch start workflow "${wfId}"`, {
        event: "batch_start",
        workflowId: wfId,
        criteria,
      });

      // 0. Workflow-level lock
      const lock = await store.acquireLock(wfId);
      if (lock === null) {
        await log.warn(
          `Workflow "${wfId}" is already running, aborting batch`,
          { event: "lock_failed", workflowId: wfId },
        );
        return {
          processed: [],
          skipped: [],
          totalIssues: 0,
          status: "failed",
        };
      }

      await log.info("Lock acquired", {
        event: "lock_acquired",
        workflowId: wfId,
      });

      try {
        return await this.#runBatchInner(store, criteria, options, log);
      } finally {
        await lock.release();
      }
    } finally {
      await log.close();
    }
  }

  async #runBatchInner(
    store: IssueStore,
    criteria: IssueCriteria,
    options: BatchOptions | undefined,
    log: OrchestratorLogger,
  ): Promise<BatchResult> {
    const syncer = new IssueSyncer(this.#github, store);

    // 1. Sync issues from gh to local store
    const issueNumbers = await syncer.sync(criteria);
    await log.info(`Synced ${issueNumbers.length} issues`, {
      event: "sync_complete",
      issueCount: issueNumbers.length,
      issueNumbers,
    });

    // 2. If --prioritize mode
    if (options?.prioritizeOnly) {
      if (!this.#config.prioritizer) {
        throw wfBatchPrioritizeMissingConfig();
      }
      await log.info("Running prioritizer", { event: "prioritize_start" });
      const prioritizer = new Prioritizer(
        this.#config.prioritizer,
        store,
        this.#dispatcher,
      );
      const priorityResult = await prioritizer.run();
      // Update meta.json for each assignment (skip in dryRun)
      if (!options.dryRun) {
        for (const { issue, priority } of priorityResult.assignments) {
          // deno-lint-ignore no-await-in-loop
          const meta = await store.readMeta(issue);
          const priorityLabels = this.#config.prioritizer.labels;
          const newLabels = meta.labels.filter((l) =>
            !priorityLabels.includes(l)
          );
          newLabels.push(priority);
          // deno-lint-ignore no-await-in-loop
          await store.updateMeta(issue, { labels: newLabels });
          // Sync to gh
          const oldPriorityLabels = meta.labels.filter((l) =>
            priorityLabels.includes(l)
          );
          // deno-lint-ignore no-await-in-loop
          await syncer.pushLabels(issue, oldPriorityLabels, [priority]);
        }
      }
      await log.info(
        `Prioritization complete: ${priorityResult.assignments.length} assignments`,
        {
          event: "prioritize_end",
          assignmentCount: priorityResult.assignments.length,
        },
      );
      return {
        processed: [],
        skipped: [],
        totalIssues: issueNumbers.length,
        status: "completed",
      };
    }

    // 3. Build queue
    const priorityConfig = this.#config.prioritizer
      ? {
        labels: this.#config.prioritizer.labels,
        defaultLabel: this.#config.prioritizer.defaultLabel,
      }
      : { labels: [], defaultLabel: undefined };
    const queue = new Queue(this.#config, store, priorityConfig);
    const queueItems = await queue.buildQueue(issueNumbers);

    await log.info(`Queue built: ${queueItems.length} actionable issues`, {
      event: "queue_built",
      queueSize: queueItems.length,
      issues: queueItems.map((q) => q.issueNumber),
    });

    // 4. Process each issue
    const processed: OrchestratorResult[] = [];
    const skipped: { issueNumber: number; reason: string }[] = [];
    let errorCount = 0;

    for (let i = 0; i < queueItems.length; i++) {
      const item = queueItems[i];
      // deno-lint-ignore no-await-in-loop
      await log.info(
        `Processing issue #${item.issueNumber} (${i + 1}/${queueItems.length})`,
        {
          event: "issue_start",
          issueNumber: item.issueNumber,
          index: i + 1,
          total: queueItems.length,
        },
      );
      try {
        // deno-lint-ignore no-await-in-loop
        const result = await this.run(
          item.issueNumber,
          options,
          store,
          log,
        );
        processed.push(result);
      } catch (error) {
        errorCount++;
        const reason = error instanceof Error ? error.message : String(error);
        skipped.push({ issueNumber: item.issueNumber, reason });
        // deno-lint-ignore no-await-in-loop
        await log.error(
          `Issue #${item.issueNumber} failed: ${reason}`,
          {
            event: "issue_error",
            issueNumber: item.issueNumber,
            error: reason,
          },
        );
      }
    }

    // Issues in store but not in queue were skipped (normal, not error)
    for (const num of issueNumbers) {
      if (!queueItems.some((q) => q.issueNumber === num)) {
        skipped.push({ issueNumber: num, reason: "not actionable" });
      }
    }

    const batchStatus = errorCount > 0 ? "partial" : "completed";
    await log.info(
      `Batch end: ${processed.length} processed, ${skipped.length} skipped, status=${batchStatus}`,
      {
        event: "batch_end",
        processedCount: processed.length,
        skippedCount: skipped.length,
        totalIssues: issueNumbers.length,
        status: batchStatus,
      },
    );

    return {
      processed,
      skipped,
      totalIssues: issueNumbers.length,
      status: batchStatus,
    };
  }

  #delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
