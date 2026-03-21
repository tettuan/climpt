/**
 * Check Budget completion handler - completes after N status checks
 *
 * Used for monitoring scenarios where completion is determined by
 * the number of status checks performed, not iterations.
 */

import type { PromptResolver } from "../common/prompt-resolver.ts";
import {
  BaseVerdictHandler,
  type IterationSummary,
  type VerdictCriteria,
  type VerdictStepIds,
} from "./types.ts";

export class CheckBudgetVerdictHandler extends BaseVerdictHandler {
  readonly type = "count:check" as const;
  private checkCount = 0;
  private promptResolver?: PromptResolver;
  private uvVariables: Record<string, string> = {};
  private readonly stepIds: VerdictStepIds;
  private lastSummary?: IterationSummary;

  constructor(
    private readonly maxChecks: number,
    stepIds?: VerdictStepIds,
  ) {
    super();
    this.stepIds = stepIds ?? {
      initial: "initial.check",
      continuation: "continuation.check",
    };
  }

  /**
   * Set prompt resolver for externalized prompts
   */
  setPromptResolver(resolver: PromptResolver): void {
    this.promptResolver = resolver;
  }

  /**
   * Supply base UV variables (CLI args + runtime) for prompt resolution.
   */
  setUvVariables(uv: Record<string, string>): void {
    this.uvVariables = uv;
  }

  /**
   * Set the current iteration summary before verdict check.
   * Called by runner before isFinished() to provide structured output context.
   * Increments checkCount once per iteration.
   */
  setCurrentSummary(summary: IterationSummary): void {
    this.lastSummary = summary;
    this.checkCount++;
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
      return (await this.promptResolver.resolve(this.stepIds.initial, {
        uv: { ...this.uvVariables, max_checks: String(this.maxChecks) },
      })).content;
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
    const remaining = this.maxChecks - this.checkCount;

    if (this.promptResolver) {
      const summaryText = previousSummary
        ? this.formatIterationSummary(previousSummary)
        : "";
      return (await this.promptResolver.resolve(this.stepIds.continuation, {
        uv: {
          ...this.uvVariables,
          check_count: String(this.checkCount),
          max_checks: String(this.maxChecks),
          remaining: String(remaining),
          iteration: String(completedIterations),
          previous_summary: summaryText,
        },
      })).content;
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

  buildVerdictCriteria(): VerdictCriteria {
    return {
      short: `${this.maxChecks} checks`,
      detailed:
        `This task will run for up to ${this.maxChecks} status checks. Report findings after each check and work towards completing the monitoring goal efficiently.`,
    };
  }

  isFinished(): Promise<boolean> {
    return Promise.resolve(this.checkCount >= this.maxChecks);
  }

  getVerdictDescription(): Promise<string> {
    return Promise.resolve(
      `Completed ${this.checkCount}/${this.maxChecks} status checks`,
    );
  }
}
