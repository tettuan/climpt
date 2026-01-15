/**
 * Validation Utilities
 *
 * Shared validation logic used by both AgentRunner and CompletionChain.
 * Extracted to eliminate code duplication per audit recommendation.
 *
 * @module validation-utils
 */

import type { Logger } from "../src_common/logger.ts";
import { isRecord } from "../src_common/type-guards.ts";

/**
 * Result of validation check.
 */
export interface ValidationCheckResult {
  /** Whether validation passed */
  valid: boolean;
  /** Retry prompt if validation failed */
  retryPrompt?: string;
}

/**
 * Build the prompt for validation query.
 *
 * Used to instruct the agent to run validation checks (git status, type check)
 * and report results in structured format.
 */
export function buildValidationPrompt(): string {
  return `Run the following validation checks and report the results:

1. **Git status**: Run \`git status --porcelain\` to check for uncommitted changes
   - Set git_clean to true only if the output is empty
   - Include the actual output in evidence.git_status_output

2. **Type check**: Run \`deno check\`
   - Set type_check_passed to true only if exit code is 0
   - Include relevant output in evidence.type_check_output

Report your findings in the required JSON format with:
- validation.git_clean: boolean
- validation.type_check_passed: boolean
- evidence: actual command outputs`;
}

/**
 * Check validation results from structured output.
 *
 * Validates the structured output from the agent's validation query.
 * Checks required fields (git_clean, type_check_passed) and optional fields.
 *
 * @param output - Structured output from validation query
 * @param logger - Optional logger for warnings
 * @returns Validation result with retry prompt if failed
 */
export function checkValidationResults(
  output: Record<string, unknown>,
  logger?: Logger,
): ValidationCheckResult {
  if (!isRecord(output.validation)) {
    return {
      valid: false,
      retryPrompt: "Missing validation field in response",
    };
  }

  const validation = output.validation;
  const errors: string[] = [];

  // Check required fields
  if (validation.git_clean !== true) {
    errors.push(
      "git_clean is false - please commit or stash changes before closing",
    );
  }

  if (validation.type_check_passed !== true) {
    errors.push("type_check_passed is false - please fix type errors");
  }

  // Check optional fields (only fail if explicitly false)
  if (validation.tests_passed === false) {
    errors.push("tests_passed is false - please fix failing tests");
  }

  if (validation.lint_passed === false) {
    errors.push("lint_passed is false - please fix lint errors");
  }

  if (validation.format_check_passed === false) {
    errors.push("format_check_passed is false - please run formatter");
  }

  if (errors.length > 0) {
    logger?.warn("[Validation] Validation failed", { errors });
    return {
      valid: false,
      retryPrompt: `Completion validation failed:\n${
        errors.map((e) => `- ${e}`).join("\n")
      }`,
    };
  }

  logger?.info("[Validation] All validation checks passed");
  return { valid: true };
}
