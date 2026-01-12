/**
 * Pre-Close Validation Types
 *
 * Provides plugin architecture for validating agent state before closing issues.
 * This prevents agents from closing issues without satisfying completion criteria.
 */

import type { Logger } from "../src_common/logger.ts";

// Re-export PreCloseValidationConfig from src_common for consistency
export type { PreCloseValidationConfig } from "../src_common/types.ts";

/**
 * Context passed to validators during execution
 */
export interface ValidatorContext {
  /** Agent identifier */
  agentId: string;
  /** Working directory for the agent */
  workingDir: string;
  /** Logger instance for validation logging */
  logger: Logger;
  /** Issue number being closed (if applicable) */
  issueNumber?: number;
}

/**
 * Result of a pre-close validator check
 *
 * Named ValidatorResult to distinguish from other validation result types:
 * - ValidatorResult: Pre-close validator checks (this file)
 * - FormatValidationResult: Response format validation (loop/format-validator.ts)
 * - ValidationResult: Generic validation (src_common/types.ts)
 */
export interface ValidatorResult {
  /** Whether the validation passed */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
  /** Detailed information (e.g., list of uncommitted files) */
  details?: string[];
}

/** @deprecated Use ValidatorResult instead */
export type ValidationResult = ValidatorResult;

/**
 * Validator interface for pre-close checks
 */
export interface Validator {
  /** Unique identifier for the validator */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Description of what this validator checks */
  readonly description: string;
  /** Perform the validation check */
  validate(ctx: ValidatorContext): Promise<ValidatorResult>;
}

/**
 * Aggregate result from running multiple validators
 */
export interface AggregateValidationResult {
  /** Whether all validations passed */
  valid: boolean;
  /** Combined error messages from all failed validations */
  errors: string[];
  /** Combined details from all failed validations */
  details: string[];
  /** Individual results keyed by validator ID */
  results: Record<string, ValidatorResult>;
}
