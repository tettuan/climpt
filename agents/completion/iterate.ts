/**
 * Iterate completion handler - completes after N iterations
 */

import type { PromptResolver } from "../prompts/resolver.ts";
import {
  BaseCompletionHandler,
  type CompletionCriteria,
  type IterationSummary,
} from "./types.ts";

export class IterateCompletionHandler extends BaseCompletionHandler {
  readonly type = "iterate" as const;
  private currentIteration = 0;
  private promptResolver?: PromptResolver;

  constructor(private readonly maxIterations: number) {
    super();
  }

  /**
   * Set prompt resolver for externalized prompts
   */
  setPromptResolver(resolver: PromptResolver): void {
    this.promptResolver = resolver;
  }

  /**
   * Set current iteration (called by runner)
   */
  setCurrentIteration(iteration: number): void {
    this.currentIteration = iteration;
  }

  async buildInitialPrompt(): Promise<string> {
    if (this.promptResolver) {
      return await this.promptResolver.resolve("initial_iterate", {
        "uv-max_iterations": String(this.maxIterations),
      });
    }

    // Fallback inline prompt
    return `
You are working in iteration mode with a maximum of ${this.maxIterations} iterations.

## Objective

Execute development tasks autonomously and make continuous progress.

## Working Mode

- Each iteration is a chance to make progress on your goal
- Use TodoWrite to track tasks and progress
- Delegate complex work to sub-agents using Task tool
- Report progress at each iteration

## Iteration Info

- Maximum iterations: ${this.maxIterations}
- Current iteration: 1

Work efficiently to complete your goal within the iteration limit.
    `.trim();
  }

  async buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string> {
    this.currentIteration = completedIterations;
    const remaining = this.maxIterations - completedIterations;

    if (this.promptResolver) {
      const summaryText = previousSummary
        ? this.formatIterationSummary(previousSummary)
        : "";
      return await this.promptResolver.resolve("continuation_iterate", {
        "uv-iteration": String(completedIterations),
        "uv-max_iterations": String(this.maxIterations),
        "uv-remaining": String(remaining),
        "uv-previous_summary": summaryText,
      });
    }

    // Fallback inline prompt
    const summarySection = previousSummary
      ? this.formatIterationSummary(previousSummary)
      : "";

    return `
Continue working. Iteration ${completedIterations} of ${this.maxIterations} (${remaining} remaining).

${summarySection}

## Continue

1. Check TodoWrite for pending tasks
2. Execute next task
3. Mark completed and move forward
4. Report progress

Work efficiently to complete your goal.
    `.trim();
  }

  buildCompletionCriteria(): CompletionCriteria {
    return {
      short: `${this.maxIterations} iterations`,
      detailed:
        `This task will run for up to ${this.maxIterations} iterations. Report progress at each iteration and work towards completing the goal efficiently.`,
    };
  }

  isComplete(): Promise<boolean> {
    return Promise.resolve(this.currentIteration >= this.maxIterations);
  }

  getCompletionDescription(): Promise<string> {
    return Promise.resolve(
      `Completed ${this.currentIteration}/${this.maxIterations} iterations`,
    );
  }
}
