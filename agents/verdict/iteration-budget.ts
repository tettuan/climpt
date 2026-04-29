/**
 * Iterate completion handler - completes after N iterations
 */

import type { PromptResolver } from "../common/prompt-resolver.ts";
import {
  BaseVerdictHandler,
  type IterationSummary,
  type VerdictCriteria,
  type VerdictStepIds,
} from "./types.ts";

export class IterationBudgetVerdictHandler extends BaseVerdictHandler {
  readonly type = "count:iteration" as const;
  private currentIteration = 0;
  private promptResolver?: PromptResolver;
  private uvVariables: Record<string, string> = {};
  private readonly stepIds: VerdictStepIds;
  private lastSummary?: IterationSummary;
  #lastVerdict?: string;

  constructor(
    private readonly maxIterations: number,
    stepIds?: VerdictStepIds,
  ) {
    super();
    this.stepIds = stepIds ?? {
      initial: "initial.iteration",
      continuation: "continuation.iteration",
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
   */
  setCurrentSummary(summary: IterationSummary): void {
    this.lastSummary = summary;
  }

  /**
   * Set current iteration (called by runner)
   */
  setCurrentIteration(iteration: number): void {
    this.currentIteration = iteration;
  }

  async buildInitialPrompt(): Promise<string> {
    if (this.promptResolver) {
      return (await this.promptResolver.resolve(this.stepIds.initial, {
        uv: { ...this.uvVariables, max_iterations: String(this.maxIterations) },
      })).content;
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
      return (await this.promptResolver.resolve(this.stepIds.continuation, {
        uv: {
          ...this.uvVariables,
          iteration: String(completedIterations),
          max_iterations: String(this.maxIterations),
          remaining: String(remaining),
          previous_summary: summaryText,
        },
      })).content;
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

  buildVerdictCriteria(): VerdictCriteria {
    return {
      short: `${this.maxIterations} iterations`,
      detailed:
        `This task will run for up to ${this.maxIterations} iterations. Report progress at each iteration and work towards completing the goal efficiently.`,
    };
  }

  isFinished(): Promise<boolean> {
    return Promise.resolve(this.currentIteration >= this.maxIterations);
  }

  /**
   * Handle boundary hook for closure steps.
   *
   * Extracts `verdict` from the closure step's structured output so that
   * `getLastVerdict()` can return it. Mirrors the pattern established by
   * {@link StepMachineVerdictHandler} and {@link ExternalStateAdapter}.
   *
   * Required because the closure-signal path in `completion-loop-processor`
   * does not populate `lastSummary`, so verdict extraction via
   * `lastSummary.structuredOutput` alone misses closure-only verdicts.
   */
  onBoundaryHook(payload: {
    stepId: string;
    kind: "closure";
    structuredOutput?: Record<string, unknown>;
  }): Promise<void> {
    if (payload.structuredOutput) {
      const rawVerdict = payload.structuredOutput.verdict;
      if (typeof rawVerdict === "string" && rawVerdict.length > 0) {
        this.#lastVerdict = rawVerdict;
      }
    }
    return Promise.resolve();
  }

  override getLastVerdict(): string | undefined {
    if (this.#lastVerdict !== undefined) {
      return this.#lastVerdict;
    }
    const rawVerdict = this.lastSummary?.structuredOutput?.verdict;
    if (typeof rawVerdict === "string" && rawVerdict.length > 0) {
      return rawVerdict;
    }
    return undefined;
  }

  getVerdictDescription(): Promise<string> {
    return Promise.resolve(
      `Completed ${this.currentIteration}/${this.maxIterations} iterations`,
    );
  }
}
