/**
 * Prioritizer
 *
 * Dispatches a prioritizer agent to assign priority labels
 * to issues in the store. Reads the agent output from
 * {storePath}/priorities.json and validates against allowed labels.
 */

import type { PrioritizerConfig } from "./workflow-types.ts";
import type { SubjectStore } from "./subject-store.ts";
import type { AgentDispatcher } from "./dispatcher.ts";

export type { PrioritizerConfig };

export interface PriorityAssignment {
  issue: number;
  priority: string;
}

export interface PrioritizerResult {
  assignments: PriorityAssignment[];
}

// === Class ===

export class Prioritizer {
  #config: PrioritizerConfig;
  #store: SubjectStore;
  #dispatcher: AgentDispatcher;

  constructor(
    config: PrioritizerConfig,
    store: SubjectStore,
    dispatcher: AgentDispatcher,
  ) {
    this.#config = config;
    this.#store = store;
    this.#dispatcher = dispatcher;
  }

  /** Dispatch prioritizer agent, read results, validate. */
  async run(): Promise<PrioritizerResult> {
    const storePath = this.#store.storePath;

    // Guard: skip dispatch if store has no issues
    const subjectIds = await this.#store.listIssues();
    if (subjectIds.length === 0) {
      return { assignments: [] };
    }

    // Write issue manifest for the agent to consume
    const issueListPath = `${storePath}/issue-list.json`;
    await Deno.writeTextFile(issueListPath, JSON.stringify(subjectIds));

    await this.#dispatcher.dispatch(this.#config.agent, 0, {});

    // Read and validate priorities.json produced by the agent
    const prioritiesPath = `${storePath}/priorities.json`;
    let text: string;
    try {
      text = await Deno.readTextFile(prioritiesPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(
          `Prioritizer agent "${this.#config.agent}" did not produce ${prioritiesPath}. ` +
            `The agent must write a JSON array of {issue, priority} entries to this path.`,
        );
      }
      throw error;
    }

    const raw = JSON.parse(text) as PriorityAssignment[];

    const allowedSet = new Set(this.#config.labels);
    const assignments: PriorityAssignment[] = [];

    for (const entry of raw) {
      if (allowedSet.has(entry.priority)) {
        assignments.push(entry);
      } else if (this.#config.defaultLabel !== undefined) {
        assignments.push({
          issue: entry.issue,
          priority: this.#config.defaultLabel,
        });
      } else {
        throw new Error(
          `Invalid priority "${entry.priority}" for issue ${entry.issue}. ` +
            `Allowed: ${this.#config.labels.join(", ")}`,
        );
      }
    }

    return { assignments };
  }
}
