/**
 * Outbox Processor
 *
 * Reads queued outbox actions from the issue store and executes
 * them against GitHub in sequence order.
 *
 * Per-file success tracking: each action file is deleted immediately
 * after successful execution. Failed action files remain on disk for
 * retry in the next cycle. This replaces the previous all-or-nothing
 * `clearOutbox` strategy that left succeeded files for re-execution
 * on partial failure (see issue #486).
 *
 * Late-binding contract (issue #487 Gap 1):
 * `add-to-project` actions with `issueNumber` absent are resolved
 * using the most recently succeeded `create-issue` result within the
 * same process() call. This enables deferred_items inheritance where
 * a newly created issue is automatically added to the parent's projects.
 *
 * Post-close trigger (issue #487 Gap 2):
 * Actions with `trigger: "post-close"` are skipped by `process()` and
 * executed separately via `processPostClose()` after the saga T6 close.
 * This ensures correct ordering for operations that must follow issue
 * close (e.g. Status=Done field updates).
 */

import type { GitHubClient } from "./github-client.ts";
import type { SubjectStore } from "./subject-store.ts";
import type { ProjectRef, SubjectRef } from "./workflow-types.ts";
import type { CloseEventBus } from "../events/bus.ts";
import type { OutboxPhase } from "../events/types.ts";
import type { OutboxClosePreChannel } from "../channels/outbox-close-pre.ts";

export type { ProjectRef };

/** Value types for project field updates. */
export type ProjectFieldValue =
  | string
  | number
  | { optionId: string }
  | { date: string };

/** Discriminated union of outbox action types. */
export type OutboxAction =
  | { action: "comment"; body: string }
  | { action: "create-issue"; title: string; labels: string[]; body: string }
  | { action: "update-labels"; add: string[]; remove: string[] }
  | { action: "close-issue" }
  | { action: "add-to-project"; project: ProjectRef; issueNumber?: number }
  | {
    action: "update-project-item-field";
    project: ProjectRef;
    itemId: string;
    fieldId: string;
    value: ProjectFieldValue;
  }
  | { action: "close-project"; project: ProjectRef }
  | { action: "remove-from-project"; project: ProjectRef; itemId: string }
  /**
   * `merge-close-fact` — IPC payload from the `merge-pr` subprocess to its
   * parent orchestrator (PR4-4 T4.5, Critique F15).
   *
   * `merge-pr` writes one fact file per successful `gh pr merge`; the
   * parent's `MergeCloseAdapter` reads + consumes the fact, then
   * publishes `IssueClosedEvent({ channel: "M" })` so the close enters
   * the parent bus uniformly with the other 5 channels.
   *
   * Fields:
   *  - `subjectId`  — the issue auto-closed by the GitHub server
   *                   (parsed from PR body `Closes #N`).
   *  - `mergedAt`   — epoch ms at which `gh pr merge` returned success.
   *  - `prNumber`   — PR number that was merged (diagnostic correlation).
   *  - `runId`      — parent's runId (when known via env / argv) so the
   *                   adapter only consumes facts that belong to its
   *                   boot. Empty string when standalone-invoked.
   *
   * This variant is **never** processed by `OutboxProcessor` — it is
   * delivered through a dedicated `tmp/merge-close-facts/<runId>.jsonl`
   * channel and consumed by `MergeCloseAdapter`. It lives in the
   * `OutboxAction` union (Typed Outbox principle, Critique F15) so the
   * IPC surface inherits the same schema discipline as in-process
   * outbox actions: validation goes through `validateMergeCloseFact`
   * below; future kinds extend the same closed enum.
   */
  | {
    action: "merge-close-fact";
    subjectId: number;
    mergedAt: number;
    prNumber: number;
    runId: string;
  };

/** Trigger phase for action execution. Default (absent) = pre-close. */
export type OutboxTrigger = "post-close";

/** Typed result of an executed action, stored per-family for inter-action reads. */
export interface ActionResult {
  action: string;
  /** Set when action is `create-issue`; the newly created issue number. */
  issueNumber?: number;
}

/** Result of processing a single outbox action. */
export interface OutboxResult {
  sequence: number;
  action: string;
  success: boolean;
  error?: string;
  /** Original filename (e.g. "000-deferred-001.json") for caller correlation. */
  filename: string;
}

/**
 * Narrow alias for the IPC variant used by `MergeCloseAdapter`
 * (PR4-4 T4.5). Provided so consumers do not need to extract via
 * `Extract<OutboxAction, ...>` at every call site.
 */
export type MergeCloseFactAction = Extract<
  OutboxAction,
  { action: "merge-close-fact" }
>;

/**
 * Structurally validate a parsed JSON object as a `merge-close-fact`
 * OutboxAction (PR4-4 T4.5, Critique F15 — Typed Outbox).
 *
 * Throws `Error` with a precise message for the missing/wrong-typed
 * field on failure so downstream JSONL ingestion can quarantine the
 * line and continue. Does NOT validate that `subjectId > 0` — the
 * caller (`MergeCloseAdapter`) is the only consumer and `subjectId`
 * is the issue number (always positive in practice but not part of
 * the structural shape contract).
 *
 * Exposed at module scope (not a private OutboxProcessor method) so
 * `MergeCloseAdapter` can call it without depending on a processor
 * instance.
 */
export function validateMergeCloseFact(
  obj: Record<string, unknown>,
): MergeCloseFactAction {
  if (obj.action !== "merge-close-fact") {
    throw new Error(
      `merge-close-fact: action field must be "merge-close-fact" ` +
        `(got "${String(obj.action)}")`,
    );
  }
  if (typeof obj.subjectId !== "number" || !Number.isInteger(obj.subjectId)) {
    throw new Error(
      "merge-close-fact: 'subjectId' integer is required",
    );
  }
  if (typeof obj.mergedAt !== "number" || !Number.isFinite(obj.mergedAt)) {
    throw new Error(
      "merge-close-fact: 'mergedAt' epoch-ms number is required",
    );
  }
  if (typeof obj.prNumber !== "number" || !Number.isInteger(obj.prNumber)) {
    throw new Error(
      "merge-close-fact: 'prNumber' integer is required",
    );
  }
  if (typeof obj.runId !== "string") {
    throw new Error(
      "merge-close-fact: 'runId' string is required (empty string allowed)",
    );
  }
  return {
    action: "merge-close-fact",
    subjectId: obj.subjectId,
    mergedAt: obj.mergedAt,
    prNumber: obj.prNumber,
    runId: obj.runId,
  };
}

export class OutboxProcessor {
  #github: GitHubClient;
  #store: SubjectStore;
  #bus: CloseEventBus | undefined;
  #runId: string | undefined;
  #outboxClosePre: OutboxClosePreChannel | undefined;

  /**
   * Most recently created issue number from a succeeded `create-issue` action.
   * Used for late-binding in legacy (v1.13.x) file format where family ID is
   * absent. Reset on each `process()` call.
   */
  #lastCreatedIssueNumber: number | undefined = undefined;

  /**
   * Per-family action result container (issue #510).
   *
   * Key: family id extracted from filename (`NNN` in `000-deferred-NNN-*.json`).
   * Value: typed result of the most recently executed action in that family.
   * Lifetime: populated on each action execution, cleared at cycle start.
   * Access: consumers read prev-in-family only (no cross-family reads).
   */
  #prevResultByFamily: Map<string, ActionResult> = new Map();

  /**
   * Construct an `OutboxProcessor`.
   *
   * @param github GitHub client used to execute outbox actions.
   * @param store  Subject store providing per-issue outbox directories.
   * @param bus    T3.3 (shadow mode): frozen `CloseEventBus` from
   *               `BootArtifacts.bus`. When present, the processor
   *               publishes `outboxActionDecided` for every recognised
   *               action and `issueClosed`/`issueCloseFailed`
   *               (`channel: "C"`) for executed `close-issue` actions.
   *               Optional — legacy callers omit it.
   * @param runId  Stable boot correlation id; paired with {@link bus}.
   * @param outboxClosePre PR4-3 (T4.4b cutover): when present, the
   *               processor delegates `close-issue` OutboxActions to
   *               this channel via `handleCloseAction(subjectId,
   *               action)` instead of invoking
   *               `github.closeIssue(subjectId)` directly. The channel
   *               owns the `closeTransport.close` write and publishes
   *               `IssueClosedEvent(channel: "C", outboxPhase: "pre")`
   *               on success. Optional — legacy callers that do not
   *               boot through `BootKernel.boot` (validate-only test
   *               fixtures) omit it; in that case the processor refuses
   *               to execute close-issue actions and surfaces an error
   *               result so the bus contract stays consistent.
   */
  constructor(
    github: GitHubClient,
    store: SubjectStore,
    bus?: CloseEventBus,
    runId?: string,
    outboxClosePre?: OutboxClosePreChannel,
  ) {
    this.#github = github;
    this.#store = store;
    this.#bus = bus;
    this.#runId = runId;
    this.#outboxClosePre = outboxClosePre;
  }

  /**
   * Read and execute all pre-close outbox actions for a subject.
   *
   * Actions with `trigger: "post-close"` are skipped (left on disk for
   * `processPostClose()`). All other actions are processed in filename
   * sort order.
   *
   * Late-binding: `create-issue` results are tracked; subsequent
   * `add-to-project` actions with absent `issueNumber` use the most
   * recently created issue number.
   */
  async process(subjectId: string | number): Promise<OutboxResult[]> {
    this.#lastCreatedIssueNumber = undefined;
    this.#prevResultByFamily.clear();
    return await this.#processActions(subjectId, "pre-close");
  }

  /**
   * Execute post-close outbox actions for a subject.
   *
   * Only processes actions with `trigger: "post-close"`. Called by the
   * orchestrator after T6 close to ensure correct ordering (e.g.
   * Status=Done updates that must follow issue close).
   */
  async processPostClose(subjectId: string | number): Promise<OutboxResult[]> {
    this.#prevResultByFamily.clear();
    return await this.#processActions(subjectId, "post-close");
  }

  async #processActions(
    subjectId: string | number,
    phase: "pre-close" | "post-close",
  ): Promise<OutboxResult[]> {
    const outboxDir = this.#store.getOutboxPath(subjectId);

    // Ensure the issue's outbox directory exists so that a subsequent
    // NotFound is truly unexpected (race condition) rather than ambiguous.
    await Deno.mkdir(outboxDir, { recursive: true });

    const files: string[] = [];

    try {
      for await (const entry of Deno.readDir(outboxDir)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          files.push(entry.name);
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // Directory was just created above but disappeared — race condition
        // or external deletion. Return empty rather than crash, but log
        // so the situation is traceable.
        // deno-lint-ignore no-console
        console.debug(
          `[OutboxProcessor] NotFound after mkdir for "${outboxDir}"`,
        );
        return [];
      }
      throw error;
    }

    if (files.length === 0) {
      return [];
    }

    files.sort();

    const results: OutboxResult[] = [];

    for (const file of files) {
      const filePath = `${outboxDir}/${file}`;
      const sequence = this.#parseSequence(file);
      // deno-lint-ignore no-await-in-loop
      const text = await Deno.readTextFile(filePath);
      let parsed: unknown;

      try {
        parsed = JSON.parse(text);
      } catch {
        results.push({
          sequence,
          action: "unknown",
          success: false,
          error: `Invalid JSON in ${file}`,
          filename: file,
        });
        continue;
      }

      const actionObj = parsed as Record<string, unknown>;
      const actionType = String(actionObj.action ?? "unknown");
      const trigger = actionObj.trigger as string | undefined;
      const isPostClose = trigger === "post-close";

      // Phase filter: skip actions that don't match the current phase.
      if (phase === "post-close" && !isPostClose) continue;
      if (phase === "pre-close" && isPostClose) continue;

      try {
        const validated = this.#validateAction(actionObj);
        const familyId = this.#extractFamilyId(file);
        // PR4-3 (T4.4b): publish OutboxActionDecided once the action is
        // recognised. For `close-issue` the OutboxClose-pre channel is
        // the publisher of `IssueClosedEvent`/`IssueCloseFailedEvent`;
        // this processor neither shells out `gh issue close` nor
        // publishes the close result events itself. `outboxPhase`
        // mirrors the call site: `process()` → "pre",
        // `processPostClose()` → "post" (event-flow §A 8/8).
        const outboxPhase: OutboxPhase = phase === "post-close"
          ? "post"
          : "pre";
        this.#bus?.publish({
          kind: "outboxActionDecided",
          publishedAt: Date.now(),
          runId: this.#runId ?? "",
          subjectId,
          action: validated,
          outboxPhase,
        });
        // deno-lint-ignore no-await-in-loop
        const actionResult = await this.#execute(
          subjectId,
          validated,
          familyId,
        );
        if (familyId !== undefined) {
          this.#prevResultByFamily.set(familyId, actionResult);
        }
        // Per-file deletion: remove succeeded file immediately so it is
        // never re-processed on the next cycle (issue #486).
        // deno-lint-ignore no-await-in-loop
        await Deno.remove(filePath);
        results.push({
          sequence,
          action: actionType,
          success: true,
          filename: file,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // PR4-3 (T4.4b): close-issue failures are published by the
        // OutboxClose-pre channel itself when the channel is wired in
        // (the channel sees the transport throw and emits
        // IssueCloseFailedEvent). Non-close failures (validation
        // errors, comment/label/project failures) surface only as
        // `OutboxResult.success === false` — they do not emit
        // close-fail events.
        results.push({
          sequence,
          action: actionType,
          success: false,
          error: message,
          filename: file,
        });
      }
    }

    return results;
  }

  /** Validate a parsed JSON object into a typed OutboxAction. */
  #validateAction(obj: Record<string, unknown>): OutboxAction {
    const action = obj.action;
    if (typeof action !== "string") {
      throw new Error("Outbox action missing 'action' field");
    }
    switch (action) {
      case "comment":
        if (typeof obj.body !== "string") {
          throw new Error("comment action requires 'body' string");
        }
        return { action: "comment", body: obj.body };
      case "create-issue":
        if (typeof obj.title !== "string") {
          throw new Error("create-issue action requires 'title' string");
        }
        if (!Array.isArray(obj.labels)) {
          throw new Error("create-issue action requires 'labels' array");
        }
        if (typeof obj.body !== "string") {
          throw new Error("create-issue action requires 'body' string");
        }
        return {
          action: "create-issue",
          title: obj.title,
          labels: obj.labels as string[],
          body: obj.body,
        };
      case "update-labels":
        if (!Array.isArray(obj.add)) {
          throw new Error("update-labels action requires 'add' array");
        }
        if (!Array.isArray(obj.remove)) {
          throw new Error("update-labels action requires 'remove' array");
        }
        return {
          action: "update-labels",
          add: obj.add as string[],
          remove: obj.remove as string[],
        };
      case "close-issue":
        return { action: "close-issue" };
      case "add-to-project":
        return {
          action: "add-to-project",
          project: this.#validateProjectRef(obj.project, "add-to-project"),
          issueNumber: typeof obj.issueNumber === "number"
            ? obj.issueNumber
            : undefined,
        };
      case "update-project-item-field": {
        const project = this.#validateProjectRef(
          obj.project,
          "update-project-item-field",
        );
        if (typeof obj.itemId !== "string") {
          throw new Error(
            "update-project-item-field action requires 'itemId' string",
          );
        }
        if (typeof obj.fieldId !== "string") {
          throw new Error(
            "update-project-item-field action requires 'fieldId' string",
          );
        }
        if (obj.value === undefined || obj.value === null) {
          throw new Error(
            "update-project-item-field action requires 'value'",
          );
        }
        return {
          action: "update-project-item-field",
          project,
          itemId: obj.itemId,
          fieldId: obj.fieldId,
          value: obj.value as ProjectFieldValue,
        };
      }
      case "close-project":
        return {
          action: "close-project",
          project: this.#validateProjectRef(obj.project, "close-project"),
        };
      case "remove-from-project": {
        const project = this.#validateProjectRef(
          obj.project,
          "remove-from-project",
        );
        if (typeof obj.itemId !== "string") {
          throw new Error(
            "remove-from-project action requires 'itemId' string",
          );
        }
        return {
          action: "remove-from-project",
          project,
          itemId: obj.itemId,
        };
      }
      case "merge-close-fact":
        // Validation lives here so the closed enum stays exhaustive,
        // but this processor never executes a merge-close-fact (it is
        // an IPC payload consumed by MergeCloseAdapter, not by the
        // in-process outbox loop). #execute surfaces an explicit
        // error if one ever lands in an outbox directory.
        return validateMergeCloseFact(obj);
      default:
        throw new Error(`Unknown outbox action: ${action}`);
    }
  }

  /** Validate and extract a ProjectRef from a raw object. */
  #validateProjectRef(raw: unknown, actionName: string): ProjectRef {
    if (raw === undefined || raw === null || typeof raw !== "object") {
      throw new Error(`${actionName} action requires 'project' object`);
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.id === "string") {
      return { id: obj.id };
    }
    if (typeof obj.owner === "string" && typeof obj.number === "number") {
      return { owner: obj.owner, number: obj.number };
    }
    throw new Error(
      `${actionName} action 'project' must have {id} or {owner, number}`,
    );
  }

  /**
   * Execute a single outbox action against GitHub.
   *
   * Late-binding contract (dual-mode):
   * - Family mode (familyId defined): `add-to-project` with absent
   *   `issueNumber` resolves from `#prevResultByFamily` for the same family.
   *   No cross-family fallback (issue #510).
   * - Legacy mode (familyId undefined): resolves from global
   *   `#lastCreatedIssueNumber` (v1.13.x compat).
   *
   * `create-issue` results are always stored in both `#lastCreatedIssueNumber`
   * (legacy) and returned as `ActionResult` for family-map storage by caller.
   */
  async #execute(
    subjectId: string | number,
    action: OutboxAction,
    familyId?: string,
  ): Promise<ActionResult> {
    switch (action.action) {
      case "comment":
        await this.#github.addIssueComment(subjectId, action.body);
        return { action: "comment" };
      case "create-issue": {
        const newIssueNumber = await this.#github.createIssue(
          action.title,
          action.labels,
          action.body,
        );
        this.#lastCreatedIssueNumber = newIssueNumber;
        return { action: "create-issue", issueNumber: newIssueNumber };
      }
      case "update-labels":
        await this.#github.updateIssueLabels(
          subjectId,
          action.remove,
          action.add,
        );
        return { action: "update-labels" };
      case "close-issue": {
        // PR4-3 (T4.4b cutover): close-issue OutboxActions delegate to
        // OutboxClose-pre channel. The channel owns the
        // `closeTransport.close` write and publishes
        // `IssueClosedEvent(channel: "C", outboxPhase: "pre")` /
        // `IssueCloseFailedEvent` symmetrically. Direct
        // `github.closeIssue` invocation from this processor is gone
        // (W2 / F2: outbox is no longer a procedural close site).
        if (this.#outboxClosePre === undefined) {
          throw new Error(
            "OutboxProcessor: close-issue action received but no " +
              "OutboxClosePreChannel was wired (BootKernel.boot supplies " +
              "this via BootArtifacts.outboxClosePre)",
          );
        }
        await this.#outboxClosePre.handleCloseAction(subjectId, action);
        return { action: "close-issue" };
      }
      case "add-to-project": {
        let issueNumber = action.issueNumber;
        if (issueNumber === undefined) {
          if (familyId !== undefined) {
            // Family mode: scoped lookup only, no global fallback.
            issueNumber = this.#prevResultByFamily.get(familyId)?.issueNumber;
          } else {
            // Legacy mode: global lookup.
            issueNumber = this.#lastCreatedIssueNumber;
          }
        }
        if (issueNumber === undefined) {
          throw new Error(
            "add-to-project: issueNumber not provided and no preceding " +
              "create-issue result available for late-binding",
          );
        }
        await this.#github.addIssueToProject(action.project, issueNumber);
        return { action: "add-to-project" };
      }
      case "update-project-item-field":
        await this.#github.updateProjectItemField(
          action.project,
          action.itemId,
          action.fieldId,
          action.value,
        );
        return { action: "update-project-item-field" };
      case "close-project":
        await this.#github.closeProject(action.project);
        return { action: "close-project" };
      case "remove-from-project":
        await this.#github.removeProjectItem(action.project, action.itemId);
        return { action: "remove-from-project" };
      case "merge-close-fact":
        // Defensive: merge-close-fact is an IPC payload, not an action
        // for in-process execution. Surface a clear error rather than
        // silently dropping it — if one ever lands in an issue's
        // outbox directory it indicates a mis-routed fact-file write.
        throw new Error(
          "merge-close-fact OutboxAction is IPC-only and must be consumed " +
            "by MergeCloseAdapter, not by OutboxProcessor",
        );
      default:
        throw new Error(
          `Unknown outbox action: ${
            (action as Record<string, unknown>).action
          }`,
        );
    }
  }

  /**
   * Extract family id from deferred action filename.
   *
   * Family-based naming: `000-deferred-NNN-action.json` → `"NNN"`.
   * Legacy naming: `000-deferred-NNN.json` (no suffix) → `undefined`.
   * Non-deferred: `001-comment.json` → `undefined`.
   */
  #extractFamilyId(filename: string): string | undefined {
    const match = filename.match(/^000-deferred-(\d+)-.+\.json$/);
    return match ? match[1] : undefined;
  }

  /** Extract sequence number from filename like "001-comment.json". */
  #parseSequence(filename: string): number {
    const match = filename.match(/^(\d+)/);
    if (match === null) {
      return 0;
    }
    return Number(match[1]);
  }
}
