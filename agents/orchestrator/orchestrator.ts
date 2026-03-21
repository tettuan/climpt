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
  ): Promise<OrchestratorResult> {
    return await this.#runInner(
      issueNumber,
      options,
      store,
      this.workflowId,
    );
  }

  async #runInner(
    issueNumber: number,
    options?: OrchestratorOptions,
    store?: IssueStore,
    workflowId?: string,
  ): Promise<OrchestratorResult> {
    const verbose = options?.verbose ?? false;
    const dryRun = options?.dryRun ?? false;
    const maxCycles = this.#config.rules.maxCycles;
    const wfId = workflowId ?? this.workflowId;

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
        if (verbose) {
          this.#log(
            `Failed to get labels for issue #${issueNumber}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        status = "blocked";
        break;
      }

      if (verbose) {
        this.#log(`Labels: [${currentLabels.join(", ")}]`);
      }

      // Step 4: Resolve phase
      // First check for terminal/blocking phases before resolving actionable
      const terminalOrBlocking = this.#resolveTerminalOrBlocking(currentLabels);
      if (terminalOrBlocking) {
        finalPhase = terminalOrBlocking.phaseId;
        status = terminalOrBlocking.phase.type === "terminal"
          ? "completed"
          : "blocked";
        if (verbose) {
          this.#log(`Phase "${finalPhase}" is ${status}`);
        }
        break;
      }

      const resolved = resolvePhase(currentLabels, this.#config);
      if (resolved === null) {
        finalPhase = "unknown";
        status = "blocked";
        if (verbose) {
          this.#log("No actionable phase found, blocking");
        }
        break;
      }

      const { phaseId } = resolved;
      finalPhase = phaseId;

      if (verbose) {
        this.#log(`Resolved phase: "${phaseId}"`);
      }

      // Step 5: Resolve agent
      const agentResolution = resolveAgent(phaseId, this.#config);
      if (agentResolution === null) {
        status = "blocked";
        if (verbose) {
          this.#log(`No agent found for phase "${phaseId}"`);
        }
        break;
      }

      const { agentId, agent } = agentResolution;

      // Step 6: Cycle check
      if (tracker.isExceeded(issueNumber)) {
        status = "cycle_exceeded";
        if (verbose) {
          this.#log(
            `Cycle limit exceeded (${
              tracker.getCount(issueNumber)
            }/${this.#config.rules.maxCycles})`,
          );
        }
        break;
      }

      // dry-run: log what would happen, skip dispatch
      if (dryRun) {
        if (verbose) {
          this.#log(
            `[dry-run] Would dispatch agent "${agentId}" for issue #${issueNumber}`,
          );
        }
        status = "dry-run";
        break;
      }

      if (verbose) {
        this.#log(`Dispatching agent "${agentId}" for issue #${issueNumber}`);
      }

      // Step 7: Dispatch agent
      // deno-lint-ignore no-await-in-loop
      const dispatchResult = await this.#dispatcher.dispatch(
        agentId,
        issueNumber,
        {
          verbose,
          issueStorePath: store?.storePath,
          outboxPath: store?.getOutboxPath(issueNumber),
        },
      );

      if (verbose) {
        this.#log(
          `Agent "${agentId}" outcome: "${dispatchResult.outcome}" (${dispatchResult.durationMs}ms)`,
        );
      }

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

      if (verbose) {
        this.#log(
          `Transition: "${phaseId}" -> "${targetPhase}" ` +
            `(remove: [${labelsToRemove.join(", ")}], add: [${
              labelsToAdd.join(", ")
            }])`,
        );
      }

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
          if (verbose) {
            this.#log(
              `Failed to update labels for issue #${issueNumber}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
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

    return {
      issueNumber,
      finalPhase,
      cycleCount: tracker.getCount(issueNumber),
      history: tracker.getHistory(issueNumber),
      status,
    };
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

  #log(message: string): void {
    // deno-lint-ignore no-console
    console.log(`[orchestrator] ${message}`);
  }

  async runBatch(
    criteria: IssueCriteria,
    options?: BatchOptions,
  ): Promise<BatchResult> {
    const storeConfig = this.#config.issueStore ?? { path: ".agent/issues" };
    const storePath = join(this.#cwd, storeConfig.path);
    const store = new IssueStore(storePath);

    // 0. Workflow-level lock -- prevents concurrent batches from
    //    breaking priority ordering. Different workflows (different
    //    labelPrefix) use separate locks and never block each other.
    const wfId = this.workflowId;
    const lock = await store.acquireLock(wfId);
    if (lock === null) {
      if (options?.verbose) {
        this.#log(
          `Workflow "${wfId}" is already running, aborting batch`,
        );
      }
      return {
        processed: [],
        skipped: [],
        totalIssues: 0,
        status: "failed",
      };
    }

    try {
      return await this.#runBatchInner(store, criteria, options);
    } finally {
      await lock.release();
    }
  }

  async #runBatchInner(
    store: IssueStore,
    criteria: IssueCriteria,
    options?: BatchOptions,
  ): Promise<BatchResult> {
    const syncer = new IssueSyncer(this.#github, store);

    // 1. Sync issues from gh to local store
    const issueNumbers = await syncer.sync(criteria);

    // 2. If --prioritize mode
    if (options?.prioritizeOnly && this.#config.prioritizer) {
      const prioritizer = new Prioritizer(
        this.#config.prioritizer,
        store,
        this.#dispatcher,
      );
      const priorityResult = await prioritizer.run();
      // Update meta.json for each assignment
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

    // 4. Process each issue
    const processed: OrchestratorResult[] = [];
    const skipped: { issueNumber: number; reason: string }[] = [];

    for (const item of queueItems) {
      try {
        // Use existing run() with store for single-truth-source processing
        // deno-lint-ignore no-await-in-loop
        const result = await this.run(item.issueNumber, options, store);
        processed.push(result);
      } catch (error) {
        skipped.push({
          issueNumber: item.issueNumber,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Issues in store but not in queue were skipped
    for (const num of issueNumbers) {
      if (!queueItems.some((q) => q.issueNumber === num)) {
        skipped.push({ issueNumber: num, reason: "not actionable" });
      }
    }

    return {
      processed,
      skipped,
      totalIssues: issueNumbers.length,
      status: processed.length > 0 ? "completed" : "partial",
    };
  }

  #delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
