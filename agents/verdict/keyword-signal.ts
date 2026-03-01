/**
 * Manual completion handler - completes when LLM outputs a specific keyword
 */

import type { PromptResolverAdapter as PromptResolver } from "../prompts/resolver-adapter.ts";
import {
  BaseCompletionHandler,
  type CompletionCriteria,
  type IterationSummary,
} from "./types.ts";

const INCOMPLETE = false;

export class ManualCompletionHandler extends BaseCompletionHandler {
  readonly type = "keywordSignal" as const;
  private promptResolver?: PromptResolver;
  private lastSummary?: IterationSummary;

  constructor(private readonly completionKeyword: string) {
    super();
  }

  /**
   * Set prompt resolver for externalized prompts
   */
  setPromptResolver(resolver: PromptResolver): void {
    this.promptResolver = resolver;
  }

  async buildInitialPrompt(): Promise<string> {
    if (this.promptResolver) {
      return await this.promptResolver.resolve("initial.manual", {
        "uv-completion_keyword": this.completionKeyword,
      });
    }

    // Fallback inline prompt
    return `
You are working on a task that will be completed when you output the keyword "${this.completionKeyword}".

## Instructions

1. Work on the assigned task
2. When you are certain the task is complete, output: ${this.completionKeyword}
3. Do not output the keyword until you have verified the task is done

## Completion

When ready, output exactly: ${this.completionKeyword}
    `.trim();
  }

  async buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string> {
    // Store for isComplete check
    this.lastSummary = previousSummary;

    if (this.promptResolver) {
      const summaryText = previousSummary
        ? this.formatIterationSummary(previousSummary)
        : "";
      return await this.promptResolver.resolve("continuation.manual", {
        "uv-iteration": String(completedIterations),
        "uv-completion_keyword": this.completionKeyword,
        "uv-previous_summary": summaryText,
      });
    }

    // Fallback inline prompt
    const summarySection = previousSummary
      ? this.formatIterationSummary(previousSummary)
      : "";

    return `
Continue working. Iterations completed: ${completedIterations}

${summarySection}

## Continue

Work on the task. When complete, output: ${this.completionKeyword}
    `.trim();
  }

  buildCompletionCriteria(): CompletionCriteria {
    return {
      short: `Output "${this.completionKeyword}" when done`,
      detailed:
        `When the task is complete, output "${this.completionKeyword}" to signal completion. Do not output this keyword until you are certain the task is fully complete.`,
    };
  }

  isComplete(): Promise<boolean> {
    if (!this.lastSummary) return Promise.resolve(INCOMPLETE);
    return Promise.resolve(
      this.lastSummary.assistantResponses.some((response) =>
        response.includes(this.completionKeyword)
      ),
    );
  }

  async getCompletionDescription(): Promise<string> {
    const complete = await this.isComplete();
    return complete
      ? `Completion keyword "${this.completionKeyword}" detected`
      : `Waiting for keyword "${this.completionKeyword}"`;
  }
}
