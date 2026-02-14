/**
 * Validation type definitions for climpt-agents
 */

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Base interface for all validation results.
 *
 * Specialized validation results should extend this interface:
 * - FormatValidationResult: Response format validation (loop/format-validator.ts)
 * - ValidatorResult: Pre-close validator checks (validators/types.ts)
 * - CompletionValidationResult: Completion condition validation (runner/runner.ts)
 */
export interface BaseValidationResult {
  /** Whether the validation passed */
  valid: boolean;
  /** Error message if validation failed (single error) */
  error?: string;
}

/**
 * Validation result with multiple errors and warnings.
 *
 * Used for schema validation, config validation, etc.
 */
export interface ValidationResult extends BaseValidationResult {
  /** Array of error messages */
  errors: string[];
  /** Array of warning messages */
  warnings: string[];
}
