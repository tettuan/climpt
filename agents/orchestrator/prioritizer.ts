/**
 * Prioritizer
 *
 * Dispatches a prioritizer agent to assign priority labels
 * to issues in the store. Reads the agent output from
 * {storePath}/priorities.json and validates against allowed labels.
 */

import type { PrioritizerConfig } from "./workflow-types.ts";
import type { IssueStore } from "./issue-store.ts";
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
  #store: IssueStore;
  #dispatcher: AgentDispatcher;

  constructor(
    config: PrioritizerConfig,
    store: IssueStore,
    dispatcher: AgentDispatcher,
  ) {
    this.#config = config;
    this.#store = store;
    this.#dispatcher = dispatcher;
  }

  /** Dispatch prioritizer agent, read results, validate. */
  async run(): Promise<PrioritizerResult> {
    const storePath = this.#store.storePath;

    await this.#dispatcher.dispatch(this.#config.agent, 0, {});

    const prioritiesPath = `${storePath}/priorities.json`;
    const text = await Deno.readTextFile(prioritiesPath);
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
