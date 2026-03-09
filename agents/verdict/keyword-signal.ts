/**
 * Manual completion handler - completes when LLM outputs a specific keyword
 */

import type { PromptResolver } from "../common/prompt-resolver.ts";
import {
  BaseVerdictHandler,
  type IterationSummary,
  type VerdictCriteria,
  type VerdictStepIds,
} from "./types.ts";

const INCOMPLETE = false;

export class KeywordSignalVerdictHandler extends BaseVerdictHandler {
  readonly type = "detect:keyword" as const;
  private promptResolver?: PromptResolver;
  private lastSummary?: IterationSummary;
  private readonly stepIds: VerdictStepIds;

  constructor(
    private readonly verdictKeyword: string,
    stepIds?: VerdictStepIds,
  ) {
    super();
    this.stepIds = stepIds ?? {
      initial: "initial.keyword",
      continuation: "continuation.keyword",
    };
  }

  /**
   * Set prompt resolver for externalized prompts
   */
  setPromptResolver(resolver: PromptResolver): void {
    this.promptResolver = resolver;
  }

  async buildInitialPrompt(): Promise<string> {
    if (this.promptResolver) {
      return (await this.promptResolver.resolve(this.stepIds.initial, {
        uv: { completion_keyword: this.verdictKeyword },
      })).content;
    }

    // Fallback inline prompt
    return `
You are working on a task that will be completed when you output the keyword "${this.verdictKeyword}".

## Instructions

1. Work on the assigned task
2. When you are certain the task is complete, output: ${this.verdictKeyword}
3. Do not output the keyword until you have verified the task is done

## Completion

When ready, output exactly: ${this.verdictKeyword}
    `.trim();
  }

  async buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string> {
    // Store for isFinished check
    this.lastSummary = previousSummary;

    if (this.promptResolver) {
      const summaryText = previousSummary
        ? this.formatIterationSummary(previousSummary)
        : "";
      return (await this.promptResolver.resolve(this.stepIds.continuation, {
        uv: {
          iteration: String(completedIterations),
          completion_keyword: this.verdictKeyword,
          previous_summary: summaryText,
        },
      })).content;
    }

    // Fallback inline prompt
    const summarySection = previousSummary
      ? this.formatIterationSummary(previousSummary)
      : "";

    return `
Continue working. Iterations completed: ${completedIterations}

${summarySection}

## Continue

Work on the task. When complete, output: ${this.verdictKeyword}
    `.trim();
  }

  buildVerdictCriteria(): VerdictCriteria {
    return {
      short: `Output "${this.verdictKeyword}" when done`,
      detailed:
        `When the task is complete, output "${this.verdictKeyword}" to signal completion. Do not output this keyword until you are certain the task is fully complete.`,
    };
  }

  isFinished(): Promise<boolean> {
    if (!this.lastSummary) return Promise.resolve(INCOMPLETE);
    return Promise.resolve(
      this.lastSummary.assistantResponses.some((response) =>
        response.includes(this.verdictKeyword)
      ),
    );
  }

  async getVerdictDescription(): Promise<string> {
    const complete = await this.isFinished();
    return complete
      ? `Verdict keyword "${this.verdictKeyword}" detected`
      : `Waiting for keyword "${this.verdictKeyword}"`;
  }
}
