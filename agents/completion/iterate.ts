/**
 * Iterate completion handler - completes after N iterations
 */

import type { IterationSummary } from "../src_common/types.ts";
import type { PromptResolver } from "../prompts/resolver.ts";
import { BaseCompletionHandler, type CompletionCriteria } from "./types.ts";

export interface IterateHandlerOptions {
  maxIterations: number;
  promptResolver: PromptResolver;
}

export class IterateCompletionHandler extends BaseCompletionHandler {
  readonly type = "iterate" as const;
  private maxIterations: number;
  private currentIteration = 0;
  private promptResolver: PromptResolver;

  constructor(options: IterateHandlerOptions) {
    super();
    this.maxIterations = options.maxIterations;
    this.promptResolver = options.promptResolver;
  }

  async buildInitialPrompt(args: Record<string, unknown>): Promise<string> {
    return await this.promptResolver.resolve("initial_iterate", {
      "uv-max_iterations": String(this.maxIterations),
      ...this.argsToUvVars(args),
    });
  }

  async buildContinuationPrompt(
    iteration: number,
    summaries: IterationSummary[],
  ): Promise<string> {
    this.currentIteration = iteration;
    const remaining = this.maxIterations - iteration;

    return await this.promptResolver.resolve("continuation_iterate", {
      "uv-iteration": String(iteration),
      "uv-max_iterations": String(this.maxIterations),
      "uv-remaining": String(remaining),
      "uv-previous_summary": this.formatSummaries(summaries.slice(-3)),
    });
  }

  buildCompletionCriteria(): CompletionCriteria {
    return {
      short: `${this.maxIterations} iterations`,
      detailed:
        `This task will run for up to ${this.maxIterations} iterations. Report progress at each iteration and work towards completing the goal efficiently.`,
    };
  }

  isComplete(_summary: IterationSummary): Promise<boolean> {
    return Promise.resolve(this.currentIteration >= this.maxIterations);
  }

  getCompletionDescription(_summary: IterationSummary): Promise<string> {
    return Promise.resolve(
      `Completed ${this.currentIteration}/${this.maxIterations} iterations`,
    );
  }
}
