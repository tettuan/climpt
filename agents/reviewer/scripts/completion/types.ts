/**
 * Completion Handler - Type Definitions for Reviewer Agent
 *
 * Defines the ReviewCompletionHandler interface for review completion types.
 */

import type { IterationSummary, ReviewAction } from "../types.ts";

/**
 * Review completion criteria result
 */
export interface ReviewCompletionCriteria {
  /** Short description (e.g., "reviewing Project #37") */
  criteria: string;
  /** Detailed description for system prompt */
  detail: string;
}

/**
 * Format iteration summary for inclusion in continuation prompts
 *
 * @param summary - Iteration summary to format
 * @returns Formatted markdown string
 */
export function formatIterationSummary(summary: IterationSummary): string {
  const parts: string[] = [];

  parts.push(`## Previous Iteration Summary (Iteration ${summary.iteration})`);

  // Include last assistant response (most likely to contain the summary)
  if (summary.assistantResponses.length > 0) {
    const lastResponse =
      summary.assistantResponses[summary.assistantResponses.length - 1];
    // Truncate if too long (keep it concise for context efficiency)
    const truncated = lastResponse.length > 1000
      ? lastResponse.substring(0, 1000) + "..."
      : lastResponse;
    parts.push(`### What was done:\n${truncated}`);
  }

  // Tools used gives context about actions taken
  if (summary.toolsUsed.length > 0) {
    parts.push(`### Tools used: ${summary.toolsUsed.join(", ")}`);
  }

  // Review actions taken
  if (summary.reviewActions.length > 0) {
    const actionSummary = summary.reviewActions
      .map((a: ReviewAction) => `- ${a.action}: ${a.title || a.summary || ""}`)
      .join("\n");
    parts.push(`### Review actions:\n${actionSummary}`);
  }

  // Report errors so next iteration can address them
  if (summary.errors.length > 0) {
    const errorSummary = summary.errors.slice(0, 3).map((e) => `- ${e}`).join(
      "\n",
    );
    parts.push(`### Errors encountered:\n${errorSummary}`);
  }

  return parts.join("\n\n");
}

/**
 * ReviewCompletionHandler interface
 *
 * Strategy pattern for handling review completion.
 */
export interface ReviewCompletionHandler {
  /** Completion type identifier */
  readonly type: "default";

  /**
   * Build the initial prompt for the first iteration
   *
   * @returns Initial prompt with review context
   */
  buildInitialPrompt(): Promise<string>;

  /**
   * Build continuation prompt for subsequent iterations
   *
   * @param completedIterations - Number of iterations completed
   * @param previousSummary - Summary from previous iteration (if any)
   * @param createdIssues - Issues created so far
   * @returns Continuation prompt with context and next steps
   */
  buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
    createdIssues?: number[],
  ): string;

  /**
   * Get completion criteria for system prompt substitution
   *
   * @returns Completion criteria strings
   */
  buildCompletionCriteria(): ReviewCompletionCriteria;

  /**
   * Check if completion criteria are met
   *
   * @param summary - Current iteration summary
   * @returns true if review is complete
   */
  isComplete(summary: IterationSummary): boolean;

  /**
   * Get human-readable description of current completion status
   *
   * @param summary - Current iteration summary
   * @returns Status description
   */
  getCompletionDescription(summary: IterationSummary): string;
}
