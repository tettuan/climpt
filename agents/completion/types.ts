/**
 * Completion handler types and interfaces
 */

import type { CompletionType, IterationSummary } from "../src_common/types.ts";

/**
 * Completion criteria for system prompt and logging
 */
export interface CompletionCriteria {
  /** Short description (for logs) */
  short: string;
  /** Detailed description (for system prompt) */
  detailed: string;
}

/**
 * Interface for completion handlers
 * Implements the Strategy pattern for different completion conditions
 */
export interface CompletionHandler {
  /** Completion type identifier */
  readonly type: CompletionType;

  /** Build initial prompt for first iteration */
  buildInitialPrompt(args: Record<string, unknown>): Promise<string>;

  /** Build continuation prompt for subsequent iterations */
  buildContinuationPrompt(
    iteration: number,
    summaries: IterationSummary[],
  ): Promise<string>;

  /** Get completion criteria for system prompt */
  buildCompletionCriteria(): CompletionCriteria;

  /** Check if agent should complete */
  isComplete(summary: IterationSummary): Promise<boolean>;

  /** Get description of completion reason */
  getCompletionDescription(summary: IterationSummary): Promise<string>;
}

/**
 * Base class with common utilities for completion handlers
 */
export abstract class BaseCompletionHandler implements CompletionHandler {
  abstract readonly type: CompletionType;

  abstract buildInitialPrompt(args: Record<string, unknown>): Promise<string>;
  abstract buildContinuationPrompt(
    iteration: number,
    summaries: IterationSummary[],
  ): Promise<string>;
  abstract buildCompletionCriteria(): CompletionCriteria;
  abstract isComplete(summary: IterationSummary): Promise<boolean>;
  abstract getCompletionDescription(summary: IterationSummary): Promise<string>;

  /**
   * Convert args object to UV variable format
   */
  protected argsToUvVars(
    args: Record<string, unknown>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(args)) {
      result[`uv-${key}`] = String(value);
    }
    return result;
  }

  /**
   * Format iteration summaries for continuation prompts
   */
  protected formatSummaries(summaries: IterationSummary[]): string {
    return summaries
      .map((s) => {
        const lastResponse = s.assistantResponses.slice(-1)[0] ?? "";
        const summary = lastResponse.substring(0, 200);
        return `Iteration ${s.iteration}: ${summary}${
          lastResponse.length > 200 ? "..." : ""
        }`;
      })
      .join("\n");
  }
}
