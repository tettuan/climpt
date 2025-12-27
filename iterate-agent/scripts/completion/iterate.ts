/**
 * Iterate Completion Handler
 *
 * Handles iteration count-based completion criteria.
 */

import type { IterationSummary } from "../types.ts";
import type { CompletionCriteria, CompletionHandler } from "./types.ts";
import { formatIterationSummary } from "./types.ts";

/**
 * IterateCompletionHandler
 *
 * Manages iteration until maximum count is reached.
 * Used when no Issue or Project is specified.
 */
export class IterateCompletionHandler implements CompletionHandler {
  readonly type = "iterate" as const;

  /** Current iteration count (mutable) */
  private currentIteration = 0;

  /**
   * Create an Iterate completion handler
   *
   * @param maxIterations - Maximum number of iterations to execute
   */
  constructor(private readonly maxIterations: number) {}

  /**
   * Update current iteration count
   *
   * Must be called by the agent loop after each iteration completes.
   *
   * @param count - Current iteration count
   */
  setCurrentIteration(count: number): void {
    this.currentIteration = count;
  }

  /**
   * Build initial prompt for autonomous mode
   */
  buildInitialPrompt(): Promise<string> {
    const iterations = this.maxIterations === Infinity
      ? "unlimited"
      : this.maxIterations;

    return Promise.resolve(`
You are running in autonomous development mode for ${iterations} iterations.

## Your Mission
1. Use the **delegate-climpt-agent** Skill to execute development tasks
2. After each task, ask Climpt for the next logical task via the Skill
3. Make continuous progress on improving the codebase

You have ${iterations} iterations to make meaningful contributions.
Start by assessing the current state of the project and identifying high-value tasks.
    `.trim());
  }

  /**
   * Build continuation prompt for subsequent iterations
   */
  buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): string {
    const summarySection = previousSummary
      ? formatIterationSummary(previousSummary)
      : "";

    const remaining = this.maxIterations === Infinity
      ? "unlimited"
      : this.maxIterations - completedIterations;

    const remainingText = this.maxIterations === Infinity
      ? "You can continue indefinitely."
      : `You have ${remaining} iteration(s) remaining.`;

    return `
You are continuing in autonomous development mode.
You have completed ${completedIterations} iteration(s). ${remainingText}

${summarySection}

## Your Mission
1. Review the Previous Iteration Summary above to understand what was accomplished
2. Based on the summary, identify the next high-value task to tackle
3. Use the **delegate-climpt-agent** Skill to execute the next development task
4. Make continuous progress on improving the codebase

**Next Step**: Analyze the summary above and determine the most logical next action to take.
    `.trim();
  }

  /**
   * Get completion criteria for system prompt
   */
  buildCompletionCriteria(): CompletionCriteria {
    const iterations = this.maxIterations === Infinity
      ? "unlimited"
      : this.maxIterations;

    return {
      criteria: `${iterations} iterations`,
      detail:
        `Execute ${iterations} iterations. After each iteration, decide on the next high-value task to tackle.`,
    };
  }

  /**
   * Check if maximum iterations reached
   */
  isComplete(): Promise<boolean> {
    return Promise.resolve(this.currentIteration >= this.maxIterations);
  }

  /**
   * Get human-readable completion status
   */
  getCompletionDescription(): Promise<string> {
    if (this.maxIterations === Infinity) {
      return Promise.resolve(
        `Completed ${this.currentIteration} iteration(s) (unlimited mode)`,
      );
    }
    const remaining = this.maxIterations - this.currentIteration;
    if (remaining <= 0) {
      return Promise.resolve(
        `All ${this.maxIterations} iteration(s) completed`,
      );
    }
    return Promise.resolve(
      `${this.currentIteration}/${this.maxIterations} iterations completed, ${remaining} remaining`,
    );
  }
}
