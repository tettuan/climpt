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
 */

import type { GitHubClient } from "./github-client.ts";
import type { SubjectStore } from "./subject-store.ts";

/** Discriminated union of outbox action types. */
export type OutboxAction =
  | { action: "comment"; body: string }
  | { action: "create-issue"; title: string; labels: string[]; body: string }
  | { action: "update-labels"; add: string[]; remove: string[] }
  | { action: "close-issue" };

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

  constructor(github: GitHubClient, store: SubjectStore) {
    this.#github = github;
    this.#store = store;
  }

  /** Read and execute all outbox actions for a subject, then clear outbox. */
  async process(subjectId: string | number): Promise<OutboxResult[]> {
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

      try {
        const validated = this.#validateAction(actionObj);
        // deno-lint-ignore no-await-in-loop
        await this.#execute(subjectId, validated);
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
      default:
        throw new Error(`Unknown outbox action: ${action}`);
    }
  }

  /** Execute a single outbox action against GitHub. */
  async #execute(
    subjectId: string | number,
    action: OutboxAction,
  ): Promise<void> {
    switch (action.action) {
      case "comment":
        await this.#github.addIssueComment(subjectId, action.body);
        break;
      case "create-issue":
        await this.#github.createIssue(
          action.title,
          action.labels,
          action.body,
        );
        break;
      case "update-labels":
        await this.#github.updateIssueLabels(
          subjectId,
          action.remove,
          action.add,
        );
        break;
      case "close-issue":
        await this.#github.closeIssue(subjectId);
        break;
      default:
        throw new Error(
          `Unknown outbox action: ${
            (action as Record<string, unknown>).action
          }`,
        );
    }
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
