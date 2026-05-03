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
  DEFAULT_SUBJECT_STORE,
  type IssueSource,
  type OrchestratorOptions,
  type OrchestratorResult,
  type WorkflowConfig,
} from "./workflow-types.ts";
import type { GitHubClient } from "./github-client.ts";
import type { AgentDispatcher } from "./dispatcher.ts";
import type { AgentRegistry } from "../boot/types.ts";
import type { CloseEventBus } from "../events/bus.ts";
import { SubjectStore } from "./subject-store.ts";
import { IssueSyncer } from "./issue-syncer.ts";
import { Prioritizer } from "./prioritizer.ts";
import { Queue } from "./queue.ts";
import { SubjectPicker } from "./subject-picker.ts";
import { wfBatchPrioritizeMissingConfig } from "../shared/errors/config-errors.ts";
import { OrchestratorLogger } from "./orchestrator-logger.ts";
import { countdownDelay } from "./countdown.ts";
import { summarizeSync, syncLabels } from "./label-sync.ts";
import { detectRuntimeOrigin } from "../common/runtime-origin.ts";

/** Interface for single-issue workflow execution, used by BatchRunner. */
export interface SingleIssueRunner {
  readonly workflowId: string;
  run(
    subjectId: string | number,
    options?: OrchestratorOptions,
    store?: SubjectStore,
    logger?: OrchestratorLogger,
  ): Promise<OrchestratorResult>;
}

export class BatchRunner {
  #runner: SingleIssueRunner;
  #config: WorkflowConfig;
  #github: GitHubClient;
  #dispatcher: AgentDispatcher;
  #cwd: string;
  #agentRegistry: AgentRegistry | undefined;
  #bus: CloseEventBus | undefined;
  #runId: string | undefined;

  /**
   * Construct a `BatchRunner`.
   *
   * @param runner        Per-issue runner (typically {@link Orchestrator}).
   * @param config        Frozen WorkflowConfig.
   * @param github        GitHub client.
   * @param dispatcher    Pre-constructed dispatcher (already holds the
   *                      frozen `AgentRegistry` when concrete).
   * @param cwd           Working directory.
   * @param agentRegistry Optional frozen `AgentRegistry` reference
   *                      (T2.3). Carried for symmetry with the
   *                      Orchestrator → BatchRunner threading; consumers
   *                      that need to construct a sub-dispatcher in the
   *                      future read it from here. Not used by the batch
   *                      itself today (the dispatcher already encloses
   *                      the registry).
   * @param bus           T3.3 (shadow mode): frozen `CloseEventBus` from
   *                      `BootArtifacts.bus`. Carried for symmetry with
   *                      the Orchestrator threading; the batch loop
   *                      itself does not publish today (every per-issue
   *                      event flows through the `Orchestrator.run`
   *                      child invocation).
   * @param runId         Stable boot correlation id; paired with
   *                      {@link bus}.
   */
  constructor(
    runner: SingleIssueRunner,
    config: WorkflowConfig,
    github: GitHubClient,
    dispatcher: AgentDispatcher,
    cwd: string,
    agentRegistry?: AgentRegistry,
    bus?: CloseEventBus,
    runId?: string,
  ) {
    this.#runner = runner;
    this.#config = config;
    this.#github = github;
    this.#dispatcher = dispatcher;
    this.#cwd = cwd;
    this.#agentRegistry = agentRegistry;
    this.#bus = bus;
    this.#runId = runId;
  }

  /** Frozen bus reference (T3.3) — exposed so future per-batch
   *  observers can read without re-loading. */
  get bus(): CloseEventBus | undefined {
    return this.#bus;
  }

  /** Stable boot correlation id paired with {@link bus}. */
  get runId(): string | undefined {
    return this.#runId;
  }

  /**
   * Frozen `AgentRegistry` (or `undefined` when constructed without
   * Boot artifacts — e.g. StubDispatcher tests). Exposed read-only so
   * downstream subroutines can confirm Layer-4 identity without
   * re-loading config.
   */
  get agentRegistry(): AgentRegistry | undefined {
    return this.#agentRegistry;
  }

  async run(
    source: IssueSource,
    options?: BatchOptions,
  ): Promise<BatchResult> {
    const log = await OrchestratorLogger.create(this.#cwd, {
      verbose: options?.verbose,
    });

    try {
      const storeConfig = this.#config.subjectStore ?? DEFAULT_SUBJECT_STORE;
      const storePath = join(this.#cwd, storeConfig.path);
      const store = new SubjectStore(storePath);

      const wfId = this.#runner.workflowId;
      const origin = detectRuntimeOrigin(import.meta.url);
      await log.info(`Batch start workflow "${wfId}"`, {
        event: "batch_start",
        workflowId: wfId,
        issueSource: source,
        climptVersion: origin.version,
        climptSource: origin.source,
        climptModuleUrl: origin.moduleUrl,
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
        return await this.#runInner(store, source, options, log);
      } finally {
        await lock.release();
      }
    } finally {
      await log.close();
    }
  }

  async #runInner(
    store: SubjectStore,
    source: IssueSource,
    options: BatchOptions | undefined,
    log: OrchestratorLogger,
  ): Promise<BatchResult> {
    // 0a. Preflight: reconcile repository labels against workflow.json#labels.
    // Runs once per batch, before any dispatch. Per-label try/catch inside
    // syncLabels ensures a single permission / transport error does not abort
    // the whole batch — aggregate failures are logged and the batch continues.
    // The actual use site (phase transition, gh issue edit) will surface a
    // hard error later if a required label is still missing.
    await this.#preflightLabelSync(log, options?.dryRun ?? false);

    const syncer = new IssueSyncer(this.#github, store);

    // 1. Build SubjectQueue via SubjectPicker (T5.1).
    //    The `source` argv override may differ from `this.#config.issueSource`
    //    when `run-workflow.ts` synthesises a per-invocation IssueSource
    //    (e.g. `--project` / `--all-projects`). Construct a workflow view
    //    that points at the effective source so the picker stays the
    //    single seam (15 §B). Realistic 12 §A constrains run-workflow to
    //    one IssueSource per invocation; argv override happens before
    //    BatchRunner sees the source.
    const pickerWorkflow = source === this.#config.issueSource
      ? this.#config
      : { ...this.#config, issueSource: source };
    const picker = SubjectPicker.fromIssueSyncer(pickerWorkflow, syncer);
    const queueItemsFromPicker = await picker.pick();
    const subjectIds = queueItemsFromPicker.map((item) =>
      Number(item.subjectId)
    );
    await log.info(`Synced ${subjectIds.length} issues`, {
      event: "sync_complete",
      issueCount: subjectIds.length,
      subjectIds,
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
        totalIssues: subjectIds.length,
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
    const queueItems = await queue.buildQueue(subjectIds);

    await log.info(`Queue built: ${queueItems.length} actionable issues`, {
      event: "queue_built",
      queueSize: queueItems.length,
      issues: queueItems.map((q) => q.subjectId),
    });

    // 4. Process each issue
    const processed: OrchestratorResult[] = [];
    const skipped: { subjectId: string | number; reason: string }[] = [];
    let errorCount = 0;

    for (let i = 0; i < queueItems.length; i++) {
      const item = queueItems[i];
      // deno-lint-ignore no-await-in-loop
      await log.info(
        `Processing subject ${item.subjectId} (${i + 1}/${queueItems.length})`,
        {
          event: "issue_start",
          subjectId: item.subjectId,
          index: i + 1,
          total: queueItems.length,
        },
      );
      try {
        // deno-lint-ignore no-await-in-loop
        const result = await this.#runner.run(
          item.subjectId,
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
        skipped.push({ subjectId: item.subjectId, reason });
        // deno-lint-ignore no-await-in-loop
        await log.error(
          `Subject ${item.subjectId} failed: ${reason}`,
          {
            event: "issue_error",
            subjectId: item.subjectId,
            error: reason,
          },
        );
      }
    }

    // Issues in store but not in queue were skipped (normal, not error)
    for (const num of subjectIds) {
      if (!queueItems.some((q) => q.subjectId === num)) {
        skipped.push({ subjectId: num, reason: "not actionable" });
      }
    }

    const batchStatus = errorCount > 0 ? "partial" : "completed";
    await log.info(
      `Batch end: ${processed.length} processed, ${skipped.length} skipped, status=${batchStatus}`,
      {
        event: "batch_end",
        processedCount: processed.length,
        skippedCount: skipped.length,
        totalIssues: subjectIds.length,
        status: batchStatus,
      },
    );

    return {
      processed,
      skipped,
      totalIssues: subjectIds.length,
      status: batchStatus,
    };
  }

  /**
   * One-time label reconciliation before the batch dispatches anything.
   *
   * Failure policy: per-label errors are absorbed by syncLabels and
   * surfaced as a summary + per-failure warn events. The batch then
   * continues — the orchestrator's existing phase-transition logic
   * raises a concrete error at the actual use site if a required
   * label is truly missing, which is preferred over aborting at
   * preflight (a partial sync is often still usable).
   *
   * Bailout: if `workflow.json#labels` is absent or empty, the
   * preflight logs a single info event and returns without touching
   * the repository. This keeps backwards compatibility for configs
   * that have not migrated yet (though the loader already rejects
   * such configs for workflows that reference any label — see
   * WF-LABEL-003).
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
      // listLabelsDetailed failed — no baseline → no safe reconciliation.
      // Log and continue; downstream will surface concrete failures.
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

    // Surface failures individually so they are searchable by label name.
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
