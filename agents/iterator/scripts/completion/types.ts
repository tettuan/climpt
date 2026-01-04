/**
 * Completion Handler - Type Definitions
 *
 * Defines the CompletionHandler interface for extensible completion types.
 */

import type { IterationSummary } from "../types.ts";

/**
 * Completion criteria types
 */
export type CompletionType = "issue" | "project" | "iterate";

/**
 * Format iteration summary for inclusion in continuation prompts
 *
 * Shared utility used by all completion handlers.
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
 * Completion criteria result from handler
 */
export interface CompletionCriteria {
  /** Short description (e.g., "closing Issue #123") */
  criteria: string;
  /** Detailed description for system prompt */
  detail: string;
}

/**
 * CompletionHandler interface
 *
 * Strategy pattern for handling different completion types.
 * Each handler encapsulates:
 * - Prompt generation (initial and continuation)
 * - Completion criteria description
 * - Completion status checking
 *
 * To add a new completion type (e.g., webhook):
 * 1. Create a new class implementing this interface
 * 2. Add to factory in mod.ts
 * 3. Add CLI option in cli.ts
 *
 * @example
 * ```typescript
 * class WebhookCompletionHandler implements CompletionHandler {
 *   readonly type = "webhook" as const;
 *   // ... implement methods
 * }
 * ```
 */
export interface CompletionHandler {
  /** Completion type identifier */
  readonly type: CompletionType;

  /**
   * Build the initial prompt for the first iteration
   *
   * @returns Initial prompt with requirements and mission
   */
  buildInitialPrompt(): Promise<string>;

  /**
   * Build continuation prompt for subsequent iterations
   *
   * @param completedIterations - Number of iterations completed
   * @param previousSummary - Summary from previous iteration (if any)
   * @returns Continuation prompt with context and next steps
   */
  buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): string;

  /**
   * Get completion criteria for system prompt substitution
   *
   * @returns Completion criteria strings
   */
  buildCompletionCriteria(): CompletionCriteria;

  /**
   * Check if completion criteria are met
   *
   * @returns true if work is complete
   */
  isComplete(): Promise<boolean>;

  /**
   * Get human-readable description of current completion status
   *
   * @returns Status description
   */
  getCompletionDescription(): Promise<string>;
}
