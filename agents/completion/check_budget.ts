/**
 * Check Budget completion handler - completes after N status checks
 *
 * Used for monitoring scenarios where completion is determined by
 * the number of status checks performed, not iterations.
 */

import type { PromptResolver } from "../prompts/resolver.ts";
import {
  BaseCompletionHandler,
  type CompletionCriteria,
  type IterationSummary,
} from "./types.ts";

export class CheckBudgetCompletionHandler extends BaseCompletionHandler {
  readonly type = "checkBudget" as const;
  private checkCount = 0;
  private promptResolver?: PromptResolver;

  constructor(private readonly maxChecks: number) {
    super();
  }

  /**
   * Set prompt resolver for externalized prompts
   */
  setPromptResolver(resolver: PromptResolver): void {
    this.promptResolver = resolver;
  }

  /**
   * Increment check count (called externally when a status check is performed)
   */
  incrementCheckCount(): void {
    this.checkCount++;
  }

  /**
   * Get current check count
   */
  getCheckCount(): number {
    return this.checkCount;
  }

  async buildInitialPrompt(): Promise<string> {
    if (this.promptResolver) {
      return await this.promptResolver.resolve("initial_check_budget", {
        "uv-max_checks": String(this.maxChecks),
      });
    }

    // Fallback inline prompt
    return `
You are working in check-budget mode with a maximum of ${this.maxChecks} status checks.

## Objective

Perform monitoring and status checks autonomously.

## Working Mode

- Each status check counts toward the budget
- Use TodoWrite to track tasks and progress
- Delegate complex work to sub-agents using Task tool
- Report progress after each check

## Check Budget Info

- Maximum checks: ${this.maxChecks}
- Current check: 1

Work efficiently to complete your monitoring goal within the check budget.
    `.trim();
  }

  async buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string> {
    // Increment check count on continuation
    this.checkCount++;
    const remaining = this.maxChecks - this.checkCount;

    if (this.promptResolver) {
      const summaryText = previousSummary
        ? this.formatIterationSummary(previousSummary)
        : "";
      return await this.promptResolver.resolve("continuation_check_budget", {
        "uv-check_count": String(this.checkCount),
        "uv-max_checks": String(this.maxChecks),
        "uv-remaining": String(remaining),
        "uv-iteration": String(completedIterations),
        "uv-previous_summary": summaryText,
      });
    }

    // Fallback inline prompt
    const summarySection = previousSummary
      ? this.formatIterationSummary(previousSummary)
      : "";

    return `
Continue monitoring. Check ${this.checkCount} of ${this.maxChecks} (${remaining} remaining).

${summarySection}

## Continue

1. Check TodoWrite for pending tasks
2. Perform next status check
3. Update progress
4. Report findings

Work efficiently to complete your monitoring goal.
    `.trim();
  }

  buildCompletionCriteria(): CompletionCriteria {
    return {
      short: `${this.maxChecks} checks`,
      detailed:
        `This task will run for up to ${this.maxChecks} status checks. Report findings after each check and work towards completing the monitoring goal efficiently.`,
    };
  }

  isComplete(): Promise<boolean> {
    return Promise.resolve(this.checkCount >= this.maxChecks);
  }

  getCompletionDescription(): Promise<string> {
    return Promise.resolve(
      `Completed ${this.checkCount}/${this.maxChecks} status checks`,
    );
  }
}
