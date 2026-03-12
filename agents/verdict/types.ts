/**
 * Verdict handler types and interfaces
 *
 * Unified interface combining features from runner and iterator implementations.
 * Uses Strategy pattern for different completion conditions.
 */

import type { IterationSummary, VerdictType } from "../src_common/types.ts";
import type {
  CheckContext,
  StepResult,
  VerdictResult,
} from "../src_common/contracts.ts";
import { TRUNCATION } from "../shared/constants.ts";
import type { STEP_PHASE } from "../shared/step-phases.ts";

// Re-export for convenience
export type { IterationSummary, VerdictType };

/**
 * Step IDs for prompt resolution in verdict handlers.
 * Resolved from entryStepMapping in steps_registry.json.
 */
export interface VerdictStepIds {
  readonly initial: string;
  readonly continuation: string;
}

// Re-export contract types for V2 API
export type { CheckContext, StepResult, VerdictResult };

/**
 * Verdict criteria for system prompt and logging
 */
export interface VerdictCriteria {
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
    const truncated = lastResponse.length > TRUNCATION.ASSISTANT_RESPONSE
      ? lastResponse.substring(0, TRUNCATION.ASSISTANT_RESPONSE) + "..."
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
export interface VerdictHandler {
  /** Verdict type identifier */
  readonly type: VerdictType;

  /**
   * Build initial prompt for first iteration
   * Context is obtained through setters, not function arguments.
   */
  buildInitialPrompt(): Promise<string>;

  /**
   * Set the current iteration summary before verdict check.
   * Called by runner before isFinished() to provide structured output context.
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
  buildVerdictCriteria(): VerdictCriteria;

  /** Check if agent should complete (state managed internally) */
  isFinished(): Promise<boolean>;

  /** Get description of completion status */
  getVerdictDescription(): Promise<string>;

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
export abstract class BaseVerdictHandler implements VerdictHandler {
  abstract readonly type: VerdictType;

  abstract buildInitialPrompt(): Promise<string>;
  abstract buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
  ): Promise<string>;
  abstract buildVerdictCriteria(): VerdictCriteria;
  abstract isFinished(): Promise<boolean>;
  abstract getVerdictDescription(): Promise<string>;

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
        const summary = lastResponse.substring(0, TRUNCATION.JSON_SUMMARY);
        return `Iteration ${s.iteration}: ${summary}${
          lastResponse.length > TRUNCATION.JSON_SUMMARY ? "..." : ""
        }`;
      })
      .join("\n");
  }
}

// ============================================================================
// Contract-compliant Handler Interface
// ============================================================================

/**
 * Contract-compliant Verdict Handler Interface
 *
 * Based on: agents/docs/design/06_contracts.md VerdictContract
 *
 * Contract guarantees:
 * - check() is a Query method (no side effects)
 * - transition() is a Query method (no side effects)
 * - buildPrompt() is a Query method (no side effects)
 * - External state retrieval is delegated to ExternalStateChecker
 */
export interface ContractVerdictHandler {
  /** Verdict type identifier */
  readonly type: VerdictType;

  /**
   * Check if verdict condition is met.
   *
   * @pre context.iteration > 0
   * @post No side effects (Query method)
   * @param context - Current iteration context
   * @returns Verdict decision
   */
  check(context: CheckContext): VerdictResult;

  /**
   * Determine next step after current step completes.
   *
   * @post No side effects (Query method)
   * @param result - Step execution result
   * @returns Next step ID or STEP_PHASE.CLOSURE to finish
   */
  transition(result: StepResult): string | typeof STEP_PHASE.CLOSURE;

  /**
   * Build prompt for the given phase.
   *
   * @post No side effects (Query method)
   * @param phase - "initial" for first iteration, "continuation" for subsequent
   * @param iteration - Current iteration number
   * @returns Prompt string
   */
  buildPrompt(
    phase: typeof STEP_PHASE.INITIAL | typeof STEP_PHASE.CONTINUATION,
    iteration: number,
  ): string;

  /**
   * Get verdict criteria description.
   *
   * @post No side effects (Query method)
   * @returns Verdict criteria with summary and detailed description
   */
  getVerdictCriteria(): { summary: string; detailed: string };
}
