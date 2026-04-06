/**
 * BatchRunner - Batch issue processing extracted from Orchestrator.
 *
 * Handles issue sync, queue building, prioritization, and sequential
 * per-issue dispatch via a SingleIssueRunner (typically Orchestrator).
 */

import { join } from "@std/path";
import {
  type BatchOptions,
  type BatchResult,
  DEFAULT_ISSUE_STORE,
  type IssueCriteria,
  type OrchestratorOptions,
  type OrchestratorResult,
  type WorkflowConfig,
} from "./workflow-types.ts";
import type { GitHubClient } from "./github-client.ts";
import type { AgentDispatcher } from "./dispatcher.ts";
import { IssueStore } from "./issue-store.ts";
import { IssueSyncer } from "./issue-syncer.ts";
import { Prioritizer } from "./prioritizer.ts";
import { Queue } from "./queue.ts";
import { wfBatchPrioritizeMissingConfig } from "../shared/errors/config-errors.ts";
import { OrchestratorLogger } from "./orchestrator-logger.ts";
import { countdownDelay } from "./countdown.ts";

/** Interface for single-issue workflow execution, used by BatchRunner. */
export interface SingleIssueRunner {
  readonly workflowId: string;
  run(
    issueNumber: number,
    options?: OrchestratorOptions,
    store?: IssueStore,
    logger?: OrchestratorLogger,
  ): Promise<OrchestratorResult>;
}

export class BatchRunner {
  #runner: SingleIssueRunner;
  #config: WorkflowConfig;
  #github: GitHubClient;
  #dispatcher: AgentDispatcher;
  #cwd: string;

  constructor(
    runner: SingleIssueRunner,
    config: WorkflowConfig,
    github: GitHubClient,
    dispatcher: AgentDispatcher,
    cwd: string,
  ) {
    this.#runner = runner;
    this.#config = config;
    this.#github = github;
    this.#dispatcher = dispatcher;
    this.#cwd = cwd;
  }

  async run(
    criteria: IssueCriteria,
    options?: BatchOptions,
  ): Promise<BatchResult> {
    const log = await OrchestratorLogger.create(this.#cwd, {
      verbose: options?.verbose,
    });

    try {
      const storeConfig = this.#config.issueStore ?? DEFAULT_ISSUE_STORE;
      const storePath = join(this.#cwd, storeConfig.path);
      const store = new IssueStore(storePath);

      const wfId = this.#runner.workflowId;
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
        return await this.#runInner(store, criteria, options, log);
      } finally {
        await lock.release();
      }
    } finally {
      await log.close();
    }
  }

  async #runInner(
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
        const result = await this.#runner.run(
          item.issueNumber,
          options,
          store,
          log,
        );
        processed.push(result);

        // Countdown between issues (skip after last item)
        if (i < queueItems.length - 1) {
          const delayMs = this.#config.rules.cycleDelayMs;
          if (delayMs > 0) {
            // deno-lint-ignore no-await-in-loop
            await countdownDelay(delayMs, "Next issue");
          }
        }
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
}
