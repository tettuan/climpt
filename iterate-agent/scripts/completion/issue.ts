/**
 * Issue Completion Handler
 *
 * Handles GitHub Issue-based completion criteria.
 */

import type { IterationSummary } from "../types.ts";
import { fetchIssueRequirements, isIssueComplete } from "../github.ts";
import type { CompletionCriteria, CompletionHandler } from "./types.ts";
import { formatIterationSummary } from "./types.ts";

/**
 * IssueCompletionHandler
 *
 * Manages iteration until a GitHub Issue is closed.
 */
export class IssueCompletionHandler implements CompletionHandler {
  readonly type = "issue" as const;

  /**
   * Create an Issue completion handler
   *
   * @param issueNumber - GitHub Issue number to work on
   */
  constructor(private readonly issueNumber: number) {}

  /**
   * Build initial prompt with Issue details
   */
  async buildInitialPrompt(): Promise<string> {
    const issueContent = await fetchIssueRequirements(this.issueNumber);

    return `
You are starting work on GitHub Issue #${this.issueNumber}.

## Issue Details
${issueContent}

## Your Mission
1. Use the **delegate-climpt-agent** Skill to implement the required changes
2. After each task, evaluate progress toward closing this issue
3. Continue until the issue requirements are fully satisfied
4. The issue will be checked periodically; when it's closed, you're done

Start by analyzing the issue requirements and planning your first task.
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
You are continuing work on GitHub Issue #${this.issueNumber}.
You have completed ${completedIterations} iteration(s).

${summarySection}

## Your Mission
1. Review the Previous Iteration Summary above to understand what was accomplished
2. Based on the summary, identify what remains to be done to close this issue
3. Use the **delegate-climpt-agent** Skill to implement the next required changes
4. After each task, evaluate progress toward closing this issue
5. Continue until the issue requirements are fully satisfied

The issue will be checked periodically; when it's closed, you're done.

**Next Step**: Analyze the summary above and determine the most logical next action to take.
    `.trim();
  }

  /**
   * Get completion criteria for system prompt
   */
  buildCompletionCriteria(): CompletionCriteria {
    return {
      criteria: `closing Issue #${this.issueNumber}`,
      detail: `Work on Issue #${this.issueNumber} until it is closed. The issue will be checked periodically; when it's marked as CLOSED, your work is complete.`,
    };
  }

  /**
   * Check if Issue is closed
   */
  async isComplete(): Promise<boolean> {
    return await isIssueComplete(this.issueNumber);
  }

  /**
   * Get human-readable completion status
   */
  async getCompletionDescription(): Promise<string> {
    const complete = await this.isComplete();
    return complete
      ? `Issue #${this.issueNumber} is now CLOSED`
      : `Issue #${this.issueNumber} is still OPEN`;
  }
}
