/**
 * Format Validator - Step Response Format Validation
 *
 * Responsibility: Validate agent responses against expected format specifications
 * Used by: AgentLoop for complete step validation with retry capability
 * Side effects: None (pure validation)
 */

import type { IterationSummary } from "../src_common/types.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Response format specification for validation
 */
export interface ResponseFormat {
  /** Type of format to validate */
  type: "action-block" | "json" | "text-pattern";

  /** For action-block type: the block type name (e.g., "issue-action") */
  blockType?: string;

  /**
   * Required fields and their expected types or literal values.
   * For types: "string", "number", "boolean"
   * For literal values: the exact value expected (e.g., "close")
   */
  requiredFields?: Record<string, string | number | boolean>;

  /** For json type: JSON Schema for validation */
  schema?: Record<string, unknown>;

  /** For text-pattern type: Regex pattern */
  pattern?: string;
}

/**
 * Result of format validation
 */
export interface ValidationResult {
  /** Whether the response matches the expected format */
  valid: boolean;

  /** Error message if validation failed */
  error?: string;

  /** Extracted data from the response (if valid) */
  extracted?: unknown;
}

// ============================================================================
// FormatValidator Class
// ============================================================================

/**
 * Validates agent responses against expected format specifications.
 *
 * Supports three format types:
 * - action-block: Validates code block with specific type (e.g., ```issue-action)
 * - json: Validates against JSON Schema
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
  ): ValidationResult {
    switch (format.type) {
      case "action-block":
        return this.validateActionBlock(summary, format);
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
   * Validate action block format.
   *
   * Checks if the summary contains a detected action matching the expected
   * block type, and validates required fields if specified.
   */
  private validateActionBlock(
    summary: IterationSummary,
    format: ResponseFormat,
  ): ValidationResult {
    if (!format.blockType) {
      return {
        valid: false,
        error: "blockType is required for action-block format",
      };
    }

    // Find matching action in detectedActions
    const action = summary.detectedActions.find(
      (a) => a.type === format.blockType,
    );

    if (!action) {
      return {
        valid: false,
        error: `Action block "${format.blockType}" not found in response`,
      };
    }

    // Parse and validate required fields
    if (format.requiredFields) {
      try {
        // Try to parse the content or raw field
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(action.content);
        } catch {
          // If content parse fails, try raw
          try {
            data = JSON.parse(action.raw);
          } catch {
            return {
              valid: false,
              error: `Cannot parse action block content as JSON`,
            };
          }
        }

        for (const [field, expected] of Object.entries(format.requiredFields)) {
          // Check if field exists
          if (!(field in data)) {
            return {
              valid: false,
              error: `Required field "${field}" is missing`,
            };
          }

          // Check type or literal value
          const actual = data[field];
          if (typeof expected === "string") {
            // Check if it's a type specification or literal value
            if (
              expected === "string" ||
              expected === "number" ||
              expected === "boolean"
            ) {
              if (!this.checkType(actual, expected)) {
                return {
                  valid: false,
                  error:
                    `Field "${field}" should be ${expected}, got ${typeof actual}`,
                };
              }
            } else {
              // Literal string value comparison
              if (actual !== expected) {
                return {
                  valid: false,
                  error:
                    `Field "${field}" should be "${expected}", got "${actual}"`,
                };
              }
            }
          } else {
            // Literal value comparison (number or boolean)
            if (actual !== expected) {
              return {
                valid: false,
                error: `Field "${field}" should be ${
                  JSON.stringify(expected)
                }, got ${JSON.stringify(actual)}`,
              };
            }
          }
        }

        return { valid: true, extracted: data };
      } catch (e) {
        return {
          valid: false,
          error: `Invalid JSON in action block: ${(e as Error).message}`,
        };
      }
    }

    // No required fields - just check action exists
    return {
      valid: true,
      extracted: action,
    };
  }

  /**
   * Validate JSON format against schema.
   *
   * Currently performs basic structure validation.
   * TODO: Implement full JSON Schema validation if needed.
   */
  private validateJson(
    summary: IterationSummary,
    format: ResponseFormat,
  ): ValidationResult {
    // Look for JSON in assistant responses
    for (const response of summary.assistantResponses) {
      // Try to find JSON in the response
      const jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1].trim());

          // Basic schema validation if provided
          if (format.schema) {
            // TODO: Implement full JSON Schema validation
            // For now, just check required properties exist
            const required = format.schema.required as string[] | undefined;
            if (required) {
              for (const prop of required) {
                if (!(prop in data)) {
                  return {
                    valid: false,
                    error: `Required property "${prop}" is missing`,
                  };
                }
              }
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
  ): ValidationResult {
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

  /**
   * Check if a value matches the expected type.
   */
  private checkType(
    value: unknown,
    expectedType: "string" | "number" | "boolean",
  ): boolean {
    const actualType = typeof value;
    return actualType === expectedType;
  }
}
