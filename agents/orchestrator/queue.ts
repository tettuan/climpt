/**
 * Queue
 *
 * Builds a sorted dispatch queue from store contents.
 * Issues are resolved to phases and agents via label-resolver,
 * then sorted by priority label order.
 */

import type { WorkflowConfig } from "./workflow-types.ts";
import type { SubjectStore } from "./subject-store.ts";
import { resolveAgent, resolvePhase } from "./label-resolver.ts";

// === Types ===

export interface QueueItem {
  subjectId: string | number;
  priority: string;
  phaseId: string;
  agentId: string;
}

/** Priority label configuration passed to Queue */
export interface QueuePriorityConfig {
  /** Priority labels in order (index 0 = highest priority) */
  labels: string[];

  /** Fallback label for issues without a priority label */
  defaultLabel?: string;
}

// === Class ===

export class Queue {
  #priorityOrder: string[];
  #defaultLabel: string | undefined;
  #store: SubjectStore;
  #config: WorkflowConfig;

  constructor(
    config: WorkflowConfig,
    store: SubjectStore,
    priorityConfig: QueuePriorityConfig,
  ) {
    this.#config = config;
    this.#store = store;
    this.#priorityOrder = priorityConfig.labels;
    this.#defaultLabel = priorityConfig.defaultLabel;
  }

  /** Build sorted queue from store contents. */
  async buildQueue(scopeIssues?: number[]): Promise<QueueItem[]> {
    const subjectIds = scopeIssues ?? await this.#store.listIssues();
    const items: QueueItem[] = [];

    for (const num of subjectIds) {
      // deno-lint-ignore no-await-in-loop
      const meta = await this.#store.readMeta(num);

      const resolved = resolvePhase(meta.labels, this.#config);
      if (resolved === null) continue;

      const agentResult = resolveAgent(resolved.phaseId, this.#config);
      if (agentResult === null) continue;

      const priority = this.#extractPriority(meta.labels);

      items.push({
        subjectId: num,
        priority,
        phaseId: resolved.phaseId,
        agentId: agentResult.agentId,
      });
    }

    items.sort((a, b) => {
      const aIdx = this.#priorityIndex(a.priority);
      const bIdx = this.#priorityIndex(b.priority);
      return aIdx - bIdx;
    });

    return items;
  }

  /** Extract the first matching priority label from issue labels. */
  #extractPriority(labels: string[]): string {
    if (this.#priorityOrder.length === 0) {
      return this.#defaultLabel ?? "";
    }
    const prioritySet = new Set(this.#priorityOrder);
    for (const label of labels) {
      if (prioritySet.has(label)) {
        return label;
      }
    }
    return this.#defaultLabel ?? "";
  }

  /** Get sort index for a priority label. Unknown labels sort last. */
  #priorityIndex(priority: string): number {
    const idx = this.#priorityOrder.indexOf(priority);
    return idx === -1 ? this.#priorityOrder.length : idx;
  }
}
