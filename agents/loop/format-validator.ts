/**
 * Format Validator - Step Response Format Validation
 *
 * Responsibility: Validate agent responses against expected format specifications
 * Used by: AgentRunner for complete step validation with retry capability
 * Side effects: None (pure validation)
 */

import type {
  BaseValidationResult,
  IterationSummary,
} from "../src_common/types.ts";
import type { ResponseFormat } from "../common/validation-types.ts";
import { validateDataAgainstSchema } from "../config/schema-validator.ts";

// Re-export ResponseFormat for backwards compatibility
export type { ResponseFormat } from "../common/validation-types.ts";

/**
 * Result of format validation.
 *
 * Extends BaseValidationResult with extracted data.
 */
export interface FormatValidationResult extends BaseValidationResult {
  /** Extracted data from the response (if valid) */
  extracted?: unknown;
}

// ============================================================================
// FormatValidator Class
// ============================================================================

/**
 * Validates agent responses against expected format specifications.
 *
 * Supports two format types:
 * - json: Validates against JSON Schema (using SchemaValidator engine)
 * - text-pattern: Validates against regex pattern
 */
export class FormatValidator {
  /**
   * Validate an iteration summary against a response format specification.
   *
   * @param summary - The iteration summary containing agent responses
   * @param format - Expected response format specification
   * @returns Validation result with success status and extracted data
   */
  validate(
    summary: IterationSummary,
    format: ResponseFormat,
  ): FormatValidationResult {
    switch (format.type) {
      case "json":
        return this.validateJson(summary, format);
      case "text-pattern":
        return this.validatePattern(summary, format);
      default:
        return {
          valid: false,
          error: `Unknown format type: ${(format as ResponseFormat).type}`,
        };
    }
  }

  /**
   * Validate JSON format against schema.
   *
   * Extracts JSON from ```json code blocks in assistant responses,
   * then validates against the provided JSON Schema using the
   * SchemaValidator engine from config/schema-validator.ts.
   */
  private validateJson(
    summary: IterationSummary,
    format: ResponseFormat,
  ): FormatValidationResult {
    // Look for JSON in assistant responses
    for (const response of summary.assistantResponses) {
      // Try to find JSON in the response
      const jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1].trim());

          // Full JSON Schema validation using SchemaValidator engine
          if (format.schema) {
            const result = validateDataAgainstSchema(data, format.schema);
            if (!result.valid) {
              // Build a descriptive error from all schema validation errors
              const errorMessages = result.errors.map((e) =>
                e.path ? `${e.path}: ${e.message}` : e.message
              );
              return {
                valid: false,
                error: `Schema validation failed: ${errorMessages.join("; ")}`,
              };
            }
          }

          return { valid: true, extracted: data };
        } catch (e) {
          return {
            valid: false,
            error: `Invalid JSON: ${(e as Error).message}`,
          };
        }
      }
    }

    return {
      valid: false,
      error: "No JSON block found in response",
    };
  }

  /**
   * Validate text pattern using regex.
   */
  private validatePattern(
    summary: IterationSummary,
    format: ResponseFormat,
  ): FormatValidationResult {
    if (!format.pattern) {
      return {
        valid: false,
        error: "pattern is required for text-pattern format",
      };
    }

    try {
      const regex = new RegExp(format.pattern);

      // Check all assistant responses
      for (const response of summary.assistantResponses) {
        const match = response.match(regex);
        if (match) {
          return {
            valid: true,
            extracted: match[0],
          };
        }
      }

      return {
        valid: false,
        error: `Pattern "${format.pattern}" not found in response`,
      };
    } catch (e) {
      return {
        valid: false,
        error: `Invalid regex pattern: ${(e as Error).message}`,
      };
    }
  }
}
