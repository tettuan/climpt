/**
 * Issue completion handler - completes when a GitHub Issue is closed
 *
 * Contract-compliant implementation that separates external state checking
 * from completion judgment logic.
 *
 * @refactored Phase 6 - External state checking separated to ExternalStateChecker
 */

import type {
  CheckContext,
  CompletionResult,
  CompletionType,
  ContractCompletionHandler,
  StepResult,
} from "./types.ts";
import type {
  ExternalStateChecker,
  IssueState,
} from "./external-state-checker.ts";
import { STEP_PHASE } from "../shared/step-phases.ts";

/**
 * Configuration for IssueCompletionHandler.
 */
export interface IssueContractConfig {
  /** Issue number to track */
  issueNumber: number;
  /** Repository in "owner/repo" format (optional) */
  repo?: string;
  /** Minimum interval between state checks in ms (default: 60000) */
  checkInterval?: number;
}

/**
 * Issue-based completion handler with contract compliance.
 *
 * Contract-compliant implementation that separates external state checking
 * from completion judgment logic.
 *
 * Key characteristics:
 * - check() uses cached state only - no external calls
 * - refreshState() method for explicit state updates
 * - External state checker is injected as dependency
 *
 * Usage:
 * ```typescript
 * const checker = new GitHubStateChecker();
 * const handler = new IssueCompletionHandler(
 *   { issueNumber: 123, repo: "owner/repo" },
 *   checker
 * );
 *
 * // Loop layer calls refreshState at appropriate intervals
 * await handler.refreshState();
 *
 * // check() is now side-effect free
 * const result = handler.check({ iteration: 1 });
 * ```
 */
export class IssueCompletionHandler implements ContractCompletionHandler {
  readonly type: CompletionType = "externalState";

  private cachedState?: IssueState;
  private lastCheckTime = 0;

  constructor(
    private readonly config: IssueContractConfig,
    private readonly stateChecker: ExternalStateChecker,
  ) {}

  /**
   * Check completion based on cached issue state.
   *
   * No external calls - uses cached state only.
   * Call refreshState() to update from external source.
   *
   * @post No side effects (Query method)
   */
  check(_context: CheckContext): CompletionResult {
    if (!this.cachedState) {
      return { complete: false };
    }

    return {
      complete: this.cachedState.closed,
      reason: this.cachedState.closed
        ? `Issue #${this.config.issueNumber} is closed`
        : undefined,
    };
  }

  /**
   * Transition logic - issue completion doesn't have steps.
   *
   * @post No side effects (Query method)
   */
  transition(_result: StepResult): typeof STEP_PHASE.CLOSURE {
    return STEP_PHASE.CLOSURE;
  }

  /**
   * Build prompt for issue-based agent.
   *
   * @post No side effects (Query method)
   */
  buildPrompt(
    phase: typeof STEP_PHASE.INITIAL | typeof STEP_PHASE.CONTINUATION,
    iteration: number,
  ): string {
    if (phase === STEP_PHASE.INITIAL) {
      return `Work on Issue #${this.config.issueNumber}. Check if the issue is resolved.`;
    }
    return `Continue working on Issue #${this.config.issueNumber}. Iteration ${iteration}.`;
  }

  /**
   * Get completion criteria.
   *
   * @post No side effects (Query method)
   */
  getCompletionCriteria(): { summary: string; detailed: string } {
    return {
      summary: `Issue #${this.config.issueNumber} closed`,
      detailed:
        `Complete when GitHub Issue #${this.config.issueNumber} is closed${
          this.config.repo ? ` in ${this.config.repo}` : ""
        }.`,
    };
  }

  /**
   * Refresh state from external source.
   *
   * This is the ONLY method that performs external calls.
   * Should be called by the loop layer at appropriate intervals.
   *
   * @post Updates cachedState and lastCheckTime
   */
  async refreshState(): Promise<void> {
    const now = Date.now();
    const interval = this.config.checkInterval ?? 60000; // Default 1 minute

    if (now - this.lastCheckTime < interval) {
      return; // Skip if checked recently
    }

    this.cachedState = await this.stateChecker.checkIssueState(
      this.config.issueNumber,
      this.config.repo,
    );
    this.lastCheckTime = now;
  }

  /**
   * Force refresh state regardless of interval.
   *
   * Useful for initial state fetch or explicit refresh requests.
   *
   * @post Updates cachedState and lastCheckTime
   */
  async forceRefreshState(): Promise<void> {
    this.cachedState = await this.stateChecker.checkIssueState(
      this.config.issueNumber,
      this.config.repo,
    );
    this.lastCheckTime = Date.now();
  }

  /**
   * Get the cached state (for inspection/debugging).
   *
   * @returns Current cached state or undefined if not yet fetched
   */
  getCachedState(): IssueState | undefined {
    return this.cachedState;
  }

  /**
   * Get the issue number.
   */
  getIssueNumber(): number {
    return this.config.issueNumber;
  }

  /**
   * Check if state needs refresh based on interval.
   *
   * @returns true if refreshState() would fetch new data
   */
  needsRefresh(): boolean {
    const now = Date.now();
    const interval = this.config.checkInterval ?? 60000;
    return now - this.lastCheckTime >= interval;
  }
}
