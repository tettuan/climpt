import type { PhaseTransitionRecord } from "./workflow-types.ts";

/**
 * Tracks phase transition cycles per issue and enforces maxCycles limits.
 *
 * Corresponds to ADK LoopAgent.max_iterations - records each
 * phase transition and determines when an issue has exceeded
 * the allowed number of cycles.
 */
export class CycleTracker {
  #maxCycles: number;
  #history: Map<number, PhaseTransitionRecord[]>;

  constructor(maxCycles: number) {
    this.#maxCycles = maxCycles;
    this.#history = new Map();
  }

  /** Record a phase transition for an issue. */
  record(
    issueNumber: number,
    from: string,
    to: string,
    agent: string,
    outcome: string,
  ): void {
    const record: PhaseTransitionRecord = {
      from,
      to,
      agent,
      outcome,
      timestamp: new Date().toISOString(),
    };
    const existing = this.#history.get(issueNumber);
    if (existing) {
      existing.push(record);
    } else {
      this.#history.set(issueNumber, [record]);
    }
  }

  /** Returns true if the issue has reached or exceeded maxCycles. */
  isExceeded(issueNumber: number): boolean {
    return this.getCount(issueNumber) >= this.#maxCycles;
  }

  /** Returns the number of transitions recorded for this issue. */
  getCount(issueNumber: number): number {
    return this.#history.get(issueNumber)?.length ?? 0;
  }

  /** Returns a defensive copy of the transition history for this issue. */
  getHistory(issueNumber: number): PhaseTransitionRecord[] {
    const records = this.#history.get(issueNumber);
    if (!records) return [];
    return records.map((r) => ({ ...r }));
  }

  /** Generate a correlation ID in format "wf-{timestamp}-{agent}". */
  generateCorrelationId(agent: string): string {
    const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(
      ".",
      "-",
    );
    return `wf-${timestamp}-${agent}`;
  }
}
