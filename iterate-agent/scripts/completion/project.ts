/**
 * Project Completion Handler
 *
 * Handles GitHub Project-based completion criteria.
 */

import type { IterationSummary } from "../types.ts";
import { fetchProjectRequirements, isProjectComplete } from "../github.ts";
import type { CompletionCriteria, CompletionHandler } from "./types.ts";
import { formatIterationSummary } from "./types.ts";

/**
 * ProjectCompletionHandler
 *
 * Manages iteration until all GitHub Project items are complete.
 */
export class ProjectCompletionHandler implements CompletionHandler {
  readonly type = "project" as const;

  /**
   * Create a Project completion handler
   *
   * @param projectNumber - GitHub Project number to work on
   */
  constructor(private readonly projectNumber: number) {}

  /**
   * Build initial prompt with Project details
   */
  async buildInitialPrompt(): Promise<string> {
    const projectContent = await fetchProjectRequirements(this.projectNumber);

    return `
You are working on GitHub Project #${this.projectNumber}.

## Project Overview
${projectContent}

## Your Mission
1. Use the **delegate-climpt-agent** Skill to work through project tasks
2. Focus on making continuous progress across all project items
3. After each task, ask Climpt what to do next
4. Continue until all project items are complete

Start by reviewing the project board and selecting the first task to tackle.
    `.trim();
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

    return `
You are continuing work on GitHub Project #${this.projectNumber}.
You have completed ${completedIterations} iteration(s).

${summarySection}

## Your Mission
1. Review the Previous Iteration Summary above to understand what was accomplished
2. Based on the summary, identify what remains across project items
3. Use the **delegate-climpt-agent** Skill to work through the next project task
4. Focus on making continuous progress across all project items
5. Continue until all project items are complete

The project status will be checked periodically; when all items are done, your work is complete.

**Next Step**: Analyze the summary above and determine the most logical next action to take.
    `.trim();
  }

  /**
   * Get completion criteria for system prompt
   */
  buildCompletionCriteria(): CompletionCriteria {
    return {
      criteria: `completing Project #${this.projectNumber}`,
      detail:
        `Work on Project #${this.projectNumber} until all items are complete. The project status will be checked periodically; when all items are marked as Done or Closed, your work is complete.`,
    };
  }

  /**
   * Check if all Project items are complete
   */
  async isComplete(): Promise<boolean> {
    return await isProjectComplete(this.projectNumber);
  }

  /**
   * Get human-readable completion status
   */
  async getCompletionDescription(): Promise<string> {
    const complete = await this.isComplete();
    return complete
      ? `Project #${this.projectNumber} is now COMPLETE`
      : `Project #${this.projectNumber} has items remaining`;
  }
}
