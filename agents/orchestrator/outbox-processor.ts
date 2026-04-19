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
import type { ProjectRef } from "./workflow-types.ts";

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
  | { action: "remove-from-project"; project: ProjectRef; itemId: string };

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

export class OutboxProcessor {
  #github: GitHubClient;
  #store: SubjectStore;

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

  constructor(github: GitHubClient, store: SubjectStore) {
    this.#github = github;
    this.#store = store;
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
    return await this.#processActions(subjectId, false);
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
    return await this.#processActions(subjectId, true);
  }

  async #processActions(
    subjectId: string | number,
    postCloseOnly: boolean,
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
      if (postCloseOnly && !isPostClose) continue;
      if (!postCloseOnly && isPostClose) continue;

      try {
        const validated = this.#validateAction(actionObj);
        const familyId = this.#extractFamilyId(file);
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
      case "close-issue":
        await this.#github.closeIssue(subjectId);
        return { action: "close-issue" };
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
