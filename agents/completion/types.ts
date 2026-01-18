/**
 * Completion handler types and interfaces
 *
 * Unified interface combining features from runner and iterator implementations.
 * Uses Strategy pattern for different completion conditions.
 */

import type { CompletionType, IterationSummary } from "../src_common/types.ts";
import type {
  CheckContext,
  CompletionResult,
  StepResult,
} from "../src_common/contracts.ts";

// Re-export for convenience
export type { CompletionType, IterationSummary };

// Re-export contract types for V2 API
export type { CheckContext, CompletionResult, StepResult };

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
 * Format iteration summary for inclusion in continuation prompts
 *
 * Shared utility used by all completion handlers.
 * Includes structured output (status, next_action) for iteration continuity.
 *
 * @param summary - Iteration summary to format
 * @returns Formatted markdown string
 */
export function formatIterationSummary(summary: IterationSummary): string {
  const parts: string[] = [];

  parts.push(`## Previous Iteration Summary (Iteration ${summary.iteration})`);

  // Include structured output status and next_action for continuity
  if (summary.structuredOutput) {
    const so = summary.structuredOutput as Record<string, unknown>;
    const statusParts: string[] = [];

    if (so.status) {
      statusParts.push(`**Reported Status**: ${so.status}`);
    }

    if (so.next_action) {
      const nextAction = so.next_action as Record<string, unknown>;
      const action = nextAction.action ?? nextAction;
      const reason = nextAction.reason;
      statusParts.push(
        `**Declared Next Action**: ${action}${reason ? ` (${reason})` : ""}`,
      );
    }

    if (statusParts.length > 0) {
      parts.push(`### Previous Iteration Decision\n${statusParts.join("\n")}`);
    }
  }

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
 * Interface for completion handlers
 *
 * Implements the Strategy pattern for different completion conditions.
 * Context is obtained through setter methods, not function arguments.
 *
 * To add a new completion type:
 * 1. Create a new class implementing this interface
 * 2. Add to factory in factory.ts
 * 3. Add CLI option support
 */
export interface CompletionHandler {
  /** Completion type identifier */
  readonly type: CompletionType;

  /**
   * Build initial prompt for first iteration
   * Context is obtained through setters, not function arguments.
   */
  buildInitialPrompt(): Promise<string>;

  /**
   * Set the current iteration summary before completion check.
   * Called by runner before isComplete() to provide structured output context.
   * Optional - not all handlers need this.
   */
  setCurrentSummary?(summary: IterationSummary): void;

  /**
   * Build continuation prompt for subsequent iterations
   *
   * @param completedIterations - Number of iterations completed
   * @param previousSummary - Summary from previous iteration (optional)
   */
  buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string>;

  /** Get completion criteria for system prompt */
  buildCompletionCriteria(): CompletionCriteria;

  /** Check if agent should complete (state managed internally) */
  isComplete(): Promise<boolean>;

  /** Get description of completion status */
  getCompletionDescription(): Promise<string>;

  /**
   * Called when a closure step emits `closing` intent.
   *
   * This is the single surface for external side effects:
   * - Issue close
   * - Release publish
   * - PR merge
   *
   * Optional - not all handlers need this.
   *
   * @see agents/docs/design/08_step_flow_design.md Section 7.1
   */
  onBoundaryHook?(payload: {
    stepId: string;
    stepKind: "closure";
    structuredOutput?: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * Base class with common utilities for completion handlers
 */
export abstract class BaseCompletionHandler implements CompletionHandler {
  abstract readonly type: CompletionType;

  abstract buildInitialPrompt(): Promise<string>;
  abstract buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string>;
  abstract buildCompletionCriteria(): CompletionCriteria;
  abstract isComplete(): Promise<boolean>;
  abstract getCompletionDescription(): Promise<string>;

  /**
   * Format iteration summary for continuation prompts
   * Uses the shared utility function
   */
  protected formatIterationSummary(summary: IterationSummary): string {
    return formatIterationSummary(summary);
  }

  /**
   * Format multiple summaries (last N iterations)
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

// ============================================================================
// Contract-compliant Handler Interface
// ============================================================================

/**
 * Contract-compliant Completion Handler Interface
 *
 * Based on: agents/docs/design/06_contracts.md CompletionContract
 *
 * Contract guarantees:
 * - check() is a Query method (no side effects)
 * - transition() is a Query method (no side effects)
 * - buildPrompt() is a Query method (no side effects)
 * - External state retrieval is delegated to ExternalStateChecker
 */
export interface ContractCompletionHandler {
  /** Completion type identifier */
  readonly type: CompletionType;

  /**
   * Check if completion condition is met.
   *
   * @pre context.iteration > 0
   * @post No side effects (Query method)
   * @param context - Current iteration context
   * @returns Completion decision
   */
  check(context: CheckContext): CompletionResult;

  /**
   * Determine next step after current step completes.
   *
   * @post No side effects (Query method)
   * @param result - Step execution result
   * @returns Next step ID or "closure" to finish
   */
  transition(result: StepResult): string | "closure";

  /**
   * Build prompt for the given phase.
   *
   * @post No side effects (Query method)
   * @param phase - "initial" for first iteration, "continuation" for subsequent
   * @param iteration - Current iteration number
   * @returns Prompt string
   */
  buildPrompt(phase: "initial" | "continuation", iteration: number): string;

  /**
   * Get completion criteria description.
   *
   * @post No side effects (Query method)
   * @returns Completion criteria with summary and detailed description
   */
  getCompletionCriteria(): { summary: string; detailed: string };
}

/** Alias for backwards compatibility */
export type CompletionHandlerV2 = ContractCompletionHandler;
