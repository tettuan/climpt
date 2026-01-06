/**
 * Fallback Prompts - Embedded Default Prompts for Reviewer Agent
 *
 * These prompts are used when user-defined prompt files don't exist.
 * Users can override these by creating files in .agent/reviewer/prompts/
 *
 * Keys match the fallbackKey in steps_registry.json
 */

import type { FallbackPromptProvider } from "../../common/prompt-resolver.ts";

/**
 * Initial prompt template for review task
 *
 * Variables:
 * - {uv-project}: GitHub Project number
 * - {uv-requirements_label}: Label for requirements issues
 * - {uv-review_label}: Label for review target issues
 * - {requirements_issues}: Formatted requirements issues
 * - {review_targets}: Formatted review target issues
 * - {traceability_ids}: List of traceability IDs to verify
 */
export const INITIAL_DEFAULT = `
# Review Task

Review implementation for GitHub Project #{uv-project}

## Label System

- Requirements/Specs: Issues with '{uv-requirements_label}' label
- Review Targets: Issues with '{uv-review_label}' label

## Requirements Issues ({uv-requirements_label} label)

{requirements_issues}

## Review Target Issues ({uv-review_label} label)

{review_targets}

## All Traceability IDs to Verify

{traceability_ids}

## Instructions

1. For each traceability ID from requirements ({uv-requirements_label}), search the codebase
2. Verify the implementation meets the requirements
3. For any gaps found, output a review-action block to create an issue
4. When complete, output a review-action block with action="complete"

Start by analyzing the codebase for implementations related to the requirements.
`.trim();

/**
 * Continuation prompt template for subsequent iterations
 *
 * Variables:
 * - {uv-iteration}: Current iteration number
 * - {created_issues}: List of gap issues created so far
 * - {errors}: Errors from previous iteration (if any)
 */
export const CONTINUATION_DEFAULT = `
# Iteration {uv-iteration}

{created_issues}

{errors}

Continue the review. When all requirements are verified, output a complete action.
`.trim();

/**
 * All fallback prompts indexed by key
 */
export const FALLBACK_PROMPTS: Record<string, string> = {
  initial_default: INITIAL_DEFAULT,
  continuation_default: CONTINUATION_DEFAULT,
};

/**
 * Create fallback prompt provider for reviewer agent
 *
 * @returns FallbackPromptProvider instance
 */
export function createReviewerFallbackProvider(): FallbackPromptProvider {
  return {
    getPrompt(key: string): string | undefined {
      return FALLBACK_PROMPTS[key];
    },
    hasPrompt(key: string): boolean {
      return key in FALLBACK_PROMPTS;
    },
  };
}
