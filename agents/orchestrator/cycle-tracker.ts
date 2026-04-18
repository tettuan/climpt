import type {
  IssueWorkflowState,
  PhaseTransitionRecord,
} from "./workflow-types.ts";

/**
 * Tracks phase transition cycles per issue and enforces maxCycles limits.
 *
 * Corresponds to ADK LoopAgent.max_iterations - records each
 * phase transition and determines when an issue has exceeded
 * the allowed number of cycles.
 */
export class CycleTracker {
  #maxCycles: number;
  #maxConsecutivePhases: number;
  #history: Map<string | number, PhaseTransitionRecord[]>;

  constructor(maxCycles: number, maxConsecutivePhases = 0) {
    this.#maxCycles = maxCycles;
    this.#maxConsecutivePhases = maxConsecutivePhases;
    this.#history = new Map();
  }

  /** Record a phase transition for a subject. */
  record(
    subjectId: string | number,
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
    const existing = this.#history.get(subjectId);
    if (existing) {
      existing.push(record);
    } else {
      this.#history.set(subjectId, [record]);
    }
  }

  /** Returns true if the subject has reached or exceeded maxCycles. */
  isExceeded(subjectId: string | number): boolean {
    return this.getCount(subjectId) >= this.#maxCycles;
  }

  /**
   * Returns true when the tail of this issue's history contains
   * `maxConsecutivePhases` records with the same `to` phase in a row.
   * Returns false when the limit is <= 0 (disabled), when history has
   * fewer records than the limit, or when any record in the tail window
   * diverges from the most recent `to` phase.
   */
  isPhaseRepetitionExceeded(subjectId: string | number): boolean {
    const limit = this.#maxConsecutivePhases;
    if (!limit || limit <= 0) return false;
    const records = this.#history.get(subjectId);
    if (!records || records.length < limit) return false;
    const tail = records.slice(-limit);
    const target = tail[tail.length - 1].to;
    return tail.every((r) => r.to === target);
  }

  /**
   * Returns the number of consecutive records at the tail of this issue's
   * history that share the same `to` phase as the most recent record.
   * Returns 0 when no history exists for the issue.
   */
  getConsecutiveCount(subjectId: string | number): number {
    const records = this.#history.get(subjectId) ?? [];
    if (records.length === 0) return 0;
    const target = records[records.length - 1].to;
    let count = 0;
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i].to === target) count++;
      else break;
    }
    return count;
  }

  /** Returns the number of transitions recorded for this subject. */
  getCount(subjectId: string | number): number {
    return this.#history.get(subjectId)?.length ?? 0;
  }

  /** Returns a defensive copy of the transition history for this subject. */
  getHistory(subjectId: string | number): PhaseTransitionRecord[] {
    const records = this.#history.get(subjectId);
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

  /** Serialize tracker state for a given subject into an IssueWorkflowState. */
  toState(
    subjectId: string | number,
    currentPhase: string,
  ): IssueWorkflowState {
    const history = this.getHistory(subjectId);
    const lastAgent = history.length > 0
      ? history[history.length - 1].agent
      : "unknown";
    return {
      subjectId,
      currentPhase,
      cycleCount: this.getCount(subjectId),
      correlationId: this.generateCorrelationId(lastAgent),
      history,
    };
  }

  /** Reconstruct a CycleTracker from persisted workflow state. */
  static fromState(
    state: IssueWorkflowState,
    maxCycles: number,
    maxConsecutivePhases = 0,
  ): CycleTracker {
    const tracker = new CycleTracker(maxCycles, maxConsecutivePhases);
    tracker.#history.set(
      state.subjectId,
      state.history.map((r) => ({ ...r })),
    );
    return tracker;
  }
}
