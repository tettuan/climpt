/**
 * Default Review Completion Handler
 *
 * Handles review completion using PromptResolver for externalized prompts.
 * Provides fallback to embedded prompts when user files don't exist.
 */

import type { GitHubIssue, IterationSummary, ReviewOptions } from "../types.ts";
import { PromptResolver } from "../../../common/prompt-resolver.ts";
import { PromptLogger } from "../../../common/prompt-logger.ts";
import type { StepRegistry } from "../../../common/step-registry.ts";
import { loadStepRegistry } from "../../../common/step-registry.ts";
import { createReviewerFallbackProvider } from "../fallback-prompts.ts";
import type {
  ReviewCompletionCriteria,
  ReviewCompletionHandler,
} from "./types.ts";
import { formatIterationSummary } from "./types.ts";
import {
  fetchRequirementsIssues,
  fetchReviewTargetIssues,
  parseTraceabilityIds,
} from "../github.ts";
import type { Logger } from "../logger.ts";

/**
 * DefaultReviewCompletionHandler
 *
 * Manages review iterations with externalized prompts.
 * Uses PromptResolver for user-customizable prompts with fallback support.
 */
export class DefaultReviewCompletionHandler implements ReviewCompletionHandler {
  readonly type = "default" as const;

  private promptResolver: PromptResolver | null = null;
  private promptLogger: PromptLogger | null = null;
  private registry: StepRegistry | null = null;
  private initialized = false;

  /**
   * Create a DefaultReviewCompletionHandler
   *
   * @param options - Review options
   * @param logger - Logger instance for prompt logging
   */
  constructor(
    private readonly options: ReviewOptions,
    private readonly logger?: Logger,
  ) {}

  /**
   * Initialize the prompt resolver (lazy loading)
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load step registry
      this.registry = await loadStepRegistry(
        "reviewer",
        ".agent",
        { registryPath: ".agent/reviewer/steps_registry.json" },
      );

      // Create fallback provider
      const fallbackProvider = createReviewerFallbackProvider();

      // Create prompt resolver
      this.promptResolver = new PromptResolver(
        this.registry,
        fallbackProvider,
        { allowMissingVariables: true },
      );

      // Create prompt logger if logger is available
      if (this.logger) {
        this.promptLogger = new PromptLogger(this.logger);
      }

      this.initialized = true;
    } catch (error) {
      // Fall back to embedded prompts if registry loading fails
      console.warn(
        `[DefaultReviewCompletionHandler] Failed to load registry, using embedded prompts: ${error}`,
      );
      this.initialized = true;
    }
  }

  /**
   * Format issues for prompt inclusion
   */
  private formatIssuesForPrompt(issues: GitHubIssue[], label: string): string {
    if (issues.length === 0) {
      return `No issues with '${label}' label found.`;
    }

    return issues.map((issue) => {
      const traceabilityIds = parseTraceabilityIds(issue.body);
      const idsStr = traceabilityIds.length > 0
        ? traceabilityIds.map((id) => `\`${id.fullId}\``).join(", ")
        : "(no traceability IDs)";

      return `### Issue #${issue.number}: ${issue.title}
- Traceability IDs: ${idsStr}
- State: ${issue.state}

${issue.body || "(No body)"}`;
    }).join("\n\n---\n\n");
  }

  /**
   * Build initial prompt with project context
   */
  async buildInitialPrompt(): Promise<string> {
    await this.ensureInitialized();

    // Fetch requirements issues
    const requirementsIssues = await fetchRequirementsIssues(
      this.options.project,
      this.options.requirementsLabel,
    );

    // Fetch review target issues
    const reviewTargets = await fetchReviewTargetIssues(
      this.options.project,
      this.options.reviewLabel,
    );

    // Collect all traceability IDs from requirements
    const allTraceabilityIds = requirementsIssues.flatMap((issue) =>
      parseTraceabilityIds(issue.body)
    );

    // Format data for prompt
    const requirementsFormatted = this.formatIssuesForPrompt(
      requirementsIssues,
      this.options.requirementsLabel,
    );
    const reviewTargetsFormatted = this.formatIssuesForPrompt(
      reviewTargets,
      this.options.reviewLabel,
    );
    const traceabilityIdsFormatted = allTraceabilityIds.length > 0
      ? allTraceabilityIds.map((id) => `- \`${id.fullId}\``).join("\n")
      : "- No traceability IDs found in requirements issues";

    // Try to resolve from external prompt
    if (this.promptResolver) {
      try {
        const result = await this.promptResolver.resolve("initial.default", {
          uv: {
            project: String(this.options.project),
            requirements_label: this.options.requirementsLabel,
            review_label: this.options.reviewLabel,
          },
          custom: {
            requirements_issues: requirementsFormatted,
            review_targets: reviewTargetsFormatted,
            traceability_ids: traceabilityIdsFormatted,
          },
        });

        // Log prompt resolution
        if (this.promptLogger) {
          await this.promptLogger.logResolution(result);
        }

        return result.content;
      } catch (error) {
        console.warn(
          `[DefaultReviewCompletionHandler] Prompt resolution failed, using embedded: ${error}`,
        );
      }
    }

    // Fallback to embedded prompt
    return this.buildEmbeddedInitialPrompt(
      requirementsFormatted,
      reviewTargetsFormatted,
      traceabilityIdsFormatted,
    );
  }

  /**
   * Build embedded initial prompt (fallback)
   */
  private buildEmbeddedInitialPrompt(
    requirementsFormatted: string,
    reviewTargetsFormatted: string,
    traceabilityIdsFormatted: string,
  ): string {
    return `
# Review Task

Review implementation for GitHub Project #${this.options.project}

## Label System

- Requirements/Specs: Issues with '${this.options.requirementsLabel}' label
- Review Targets: Issues with '${this.options.reviewLabel}' label

## Requirements Issues (${this.options.requirementsLabel} label)

${requirementsFormatted}

## Review Target Issues (${this.options.reviewLabel} label)

${reviewTargetsFormatted}

## All Traceability IDs to Verify

${traceabilityIdsFormatted}

## Instructions

1. For each traceability ID from requirements (${this.options.requirementsLabel}), search the codebase
2. Verify the implementation meets the requirements
3. For any gaps found, output a review-action block to create an issue
4. When complete, output a review-action block with action="complete"

Start by analyzing the codebase for implementations related to the requirements.
`.trim();
  }

  /**
   * Build continuation prompt for subsequent iterations
   */
  buildContinuationPrompt(
    completedIterations: number,
    previousSummary?: IterationSummary,
    createdIssues?: number[],
  ): string {
    const iteration = completedIterations + 1;

    // Build dynamic sections
    const createdIssuesSection = createdIssues && createdIssues.length > 0
      ? `Gap issues created so far: ${createdIssues.join(", ")}\n`
      : "";

    const errorsSection = previousSummary && previousSummary.errors.length > 0
      ? `Errors from previous iteration:\n${
        previousSummary.errors.join("\n")
      }\n`
      : "";

    const summarySection = previousSummary
      ? formatIterationSummary(previousSummary) + "\n\n"
      : "";

    // Try to resolve from external prompt
    if (this.promptResolver) {
      try {
        // Note: buildContinuationPrompt is synchronous, so we can't use async resolve here
        // Instead, we build the prompt directly with variable substitution
        const content = `
# Iteration ${iteration}

${createdIssuesSection}

${errorsSection}

Continue the review. When all requirements are verified, output a complete action.
`.trim();

        // Log as fallback (since we can't resolve asynchronously)
        if (this.promptLogger) {
          this.promptLogger.logResolution({
            content,
            source: "fallback",
            stepId: "continuation.default",
          }).catch(() => {});
        }

        return summarySection + content;
      } catch (_error) {
        // Fall through to embedded
      }
    }

    // Fallback to embedded prompt
    return summarySection + `
# Iteration ${iteration}

${createdIssuesSection}

${errorsSection}

Continue the review. When all requirements are verified, output a complete action.
`.trim();
  }

  /**
   * Get completion criteria for system prompt
   */
  buildCompletionCriteria(): ReviewCompletionCriteria {
    return {
      criteria: `reviewing Project #${this.options.project}`,
      detail:
        `Review implementation for GitHub Project #${this.options.project}. ` +
        `Use '${this.options.requirementsLabel}' labeled issues as requirements and ` +
        `'${this.options.reviewLabel}' labeled issues as review targets. ` +
        `Create gap issues for any missing implementations.`,
    };
  }

  /**
   * Check if review is complete
   */
  isComplete(summary: IterationSummary): boolean {
    return summary.reviewActions.some((action) => action.action === "complete");
  }

  /**
   * Get human-readable completion status
   */
  getCompletionDescription(summary: IterationSummary): string {
    const complete = this.isComplete(summary);
    const gapCount = summary.reviewActions.filter(
      (a) => a.action === "create-issue",
    ).length;

    if (complete) {
      return gapCount > 0
        ? `Review complete. ${gapCount} gap issue(s) created.`
        : `Review complete. No gaps found.`;
    }

    return `Review in progress for Project #${this.options.project}`;
  }
}
