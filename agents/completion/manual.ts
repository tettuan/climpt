/**
 * Manual completion handler - completes when LLM outputs a specific keyword
 */

import type { IterationSummary } from "../src_common/types.ts";
import type { PromptResolver } from "../prompts/resolver.ts";
import { BaseCompletionHandler, type CompletionCriteria } from "./types.ts";

export interface ManualHandlerOptions {
  completionKeyword: string;
  promptResolver: PromptResolver;
}

export class ManualCompletionHandler extends BaseCompletionHandler {
  readonly type = "manual" as const;
  private completionKeyword: string;
  private promptResolver: PromptResolver;

  constructor(options: ManualHandlerOptions) {
    super();
    this.completionKeyword = options.completionKeyword;
    this.promptResolver = options.promptResolver;
  }

  async buildInitialPrompt(args: Record<string, unknown>): Promise<string> {
    return await this.promptResolver.resolve("initial_manual", {
      "uv-completion_keyword": this.completionKeyword,
      ...this.argsToUvVars(args),
    });
  }

  async buildContinuationPrompt(
    iteration: number,
    summaries: IterationSummary[],
  ): Promise<string> {
    return await this.promptResolver.resolve("continuation_manual", {
      "uv-iteration": String(iteration),
      "uv-completion_keyword": this.completionKeyword,
      "uv-previous_summary": this.formatSummaries(summaries.slice(-3)),
    });
  }

  buildCompletionCriteria(): CompletionCriteria {
    return {
      short: `Output "${this.completionKeyword}" when done`,
      detailed:
        `When the task is complete, output "${this.completionKeyword}" to signal completion. Do not output this keyword until you are certain the task is fully complete.`,
    };
  }

  isComplete(summary: IterationSummary): Promise<boolean> {
    return Promise.resolve(
      summary.assistantResponses.some((response) =>
        response.includes(this.completionKeyword)
      ),
    );
  }

  getCompletionDescription(_summary: IterationSummary): Promise<string> {
    return Promise.resolve(
      `Completion keyword "${this.completionKeyword}" detected`,
    );
  }
}
