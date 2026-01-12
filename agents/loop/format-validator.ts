/**
 * Format Validator - Response Format Validation
 *
 * Validates agent responses against expected formats.
 * Supports action-block, JSON, and text-pattern validation.
 *
 * Design Philosophy:
 * - Immediate feedback on format errors
 * - Retry support with configurable max attempts
 * - Graceful degradation when validation fails
 *
 * @module
 */

import type { IterationSummary } from "../src_common/types.ts";

// ============================================================================
// Response Format Types
// ============================================================================

/**
 * Expected type for field validation
 * - "string" | "number" | "boolean": primitive type check
 * - other string values: specific value check (e.g., "close" for action field)
 */
export type FieldType = "string" | "number" | "boolean" | string;

/**
 * Response format definition
 */
export interface ResponseFormat {
  /** Format type */
  type: "action-block" | "json" | "text-pattern";

  /** Block type for action-block format (e.g., "issue-action") */
  blockType?: string;

  /** Required fields with expected types/values */
  requiredFields?: Record<string, FieldType>;

  /** JSON Schema for json format */
  schema?: Record<string, unknown>;

  /** Regex pattern for text-pattern format */
  pattern?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Error message if validation failed */
  error?: string;

  /** Extracted data from validated response */
  extracted?: unknown;
}

// ============================================================================
// Format Validator
// ============================================================================

/**
 * Format Validator
 *
 * Validates agent responses against expected formats.
 * Used by FlowAgentLoop for step-level format checking.
 *
 * @example
 * ```typescript
 * const validator = new FormatValidator();
 * const result = validator.validate(summary, {
 *   type: "action-block",
 *   blockType: "issue-action",
 *   requiredFields: { action: "close", issue: "number" }
 * });
 *
 * if (!result.valid) {
 *   console.error(result.error);
 * }
 * ```
 */
export class FormatValidator {
  /**
   * Validate an iteration summary against an expected format.
   *
   * @param summary - Iteration summary containing detected actions and responses
   * @param format - Expected response format
   * @returns Validation result with extracted data if valid
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
   * Checks for presence of action block matching blockType in detected actions.
   * Validates required fields if specified.
   *
   * @param summary - Iteration summary
   * @param format - Response format with blockType and requiredFields
   * @returns Validation result
   */
  private validateActionBlock(
    summary: IterationSummary,
    format: ResponseFormat,
  ): ValidationResult {
    const { blockType, requiredFields } = format;

    if (!blockType) {
      return {
        valid: false,
        error: "blockType is required for action-block validation",
      };
    }

    // Find action matching the block type
    const action = summary.detectedActions.find(
      (a) => a.type === blockType,
    );

    if (!action) {
      // Also check assistant responses for markdown code blocks
      const blockFromResponse = this.extractBlockFromResponses(
        summary.assistantResponses,
        blockType,
      );

      if (!blockFromResponse) {
        return {
          valid: false,
          error: `Action block "${blockType}" not found in response`,
        };
      }

      // Validate extracted block
      return this.validateExtractedBlock(
        blockFromResponse,
        requiredFields,
        blockType,
      );
    }

    // Validate the detected action
    try {
      const data = JSON.parse(action.raw);
      return this.validateRequiredFields(data, requiredFields, blockType);
    } catch (e) {
      return {
        valid: false,
        error: `Invalid JSON in action block: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  }

  /**
   * Extract action block from assistant responses.
   *
   * Looks for markdown code blocks with the specified type.
   *
   * @param responses - Array of assistant response strings
   * @param blockType - Block type to find (e.g., "issue-action")
   * @returns Extracted JSON object or null
   */
  private extractBlockFromResponses(
    responses: string[],
    blockType: string,
  ): Record<string, unknown> | null {
    const pattern = new RegExp(
      `\`\`\`${this.escapeRegex(blockType)}\\s*\\n([\\s\\S]*?)\\n\`\`\``,
      "g",
    );

    for (const response of responses) {
      const match = pattern.exec(response);
      if (match) {
        try {
          return JSON.parse(match[1].trim());
        } catch {
          // Continue searching in other responses
        }
      }
    }

    return null;
  }

  /**
   * Validate an extracted block against required fields.
   */
  private validateExtractedBlock(
    data: Record<string, unknown>,
    requiredFields: Record<string, FieldType> | undefined,
    blockType: string,
  ): ValidationResult {
    return this.validateRequiredFields(data, requiredFields, blockType);
  }

  /**
   * Validate required fields in data.
   */
  private validateRequiredFields(
    data: Record<string, unknown>,
    requiredFields: Record<string, FieldType> | undefined,
    _blockType: string,
  ): ValidationResult {
    if (!requiredFields) {
      return { valid: true, extracted: data };
    }

    for (const [field, expectedType] of Object.entries(requiredFields)) {
      if (!(field in data)) {
        return {
          valid: false,
          error: `Required field "${field}" is missing`,
        };
      }

      if (!this.checkType(data[field], expectedType)) {
        return {
          valid: false,
          error: `Field "${field}" should be ${expectedType}, got ${typeof data[
            field
          ]}`,
        };
      }
    }

    return { valid: true, extracted: data };
  }

  /**
   * Validate JSON format.
   *
   * Checks for valid JSON in the response and optionally validates
   * against a JSON Schema.
   *
   * @param summary - Iteration summary
   * @param format - Response format with optional schema
   * @returns Validation result
   */
  private validateJson(
    summary: IterationSummary,
    format: ResponseFormat,
  ): ValidationResult {
    // Try to extract JSON from responses
    for (const response of summary.assistantResponses) {
      const jsonMatch = this.extractJson(response);
      if (jsonMatch) {
        // If schema is provided, validate against it
        if (format.schema) {
          // Note: Full JSON Schema validation is beyond scope
          // This provides basic validation
          const schemaResult = this.basicSchemaValidation(
            jsonMatch,
            format.schema,
          );
          if (!schemaResult.valid) {
            return schemaResult;
          }
        }
        return { valid: true, extracted: jsonMatch };
      }
    }

    return {
      valid: false,
      error: "No valid JSON found in response",
    };
  }

  /**
   * Extract JSON from text.
   */
  private extractJson(text: string): unknown | null {
    // Try to parse as-is first
    try {
      return JSON.parse(text.trim());
    } catch {
      // Try to find JSON in code blocks
    }

    // Try to extract from code blocks
    const codeBlockPattern = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
    let match;
    while ((match = codeBlockPattern.exec(text)) !== null) {
      try {
        return JSON.parse(match[1].trim());
      } catch {
        // Continue searching
      }
    }

    // Try to find JSON object pattern
    const objectPattern = /\{[\s\S]*\}/;
    const objectMatch = objectPattern.exec(text);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        // Not valid JSON
      }
    }

    return null;
  }

  /**
   * Basic JSON Schema-like validation.
   *
   * Note: This is a simplified implementation. For full JSON Schema
   * validation, consider using a dedicated library.
   */
  private basicSchemaValidation(
    data: unknown,
    schema: Record<string, unknown>,
  ): ValidationResult {
    if (typeof data !== "object" || data === null) {
      return { valid: false, error: "Expected object" };
    }

    const obj = data as Record<string, unknown>;

    // Check required properties
    if (Array.isArray(schema.required)) {
      for (const prop of schema.required) {
        if (!(prop in obj)) {
          return { valid: false, error: `Missing required property: ${prop}` };
        }
      }
    }

    // Check properties types
    if (schema.properties && typeof schema.properties === "object") {
      const props = schema.properties as Record<
        string,
        Record<string, unknown>
      >;
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in obj && propSchema.type) {
          const expectedType = propSchema.type as string;
          const actualType = Array.isArray(obj[key])
            ? "array"
            : typeof obj[key];
          if (actualType !== expectedType) {
            return {
              valid: false,
              error:
                `Property "${key}" should be ${expectedType}, got ${actualType}`,
            };
          }
        }
      }
    }

    return { valid: true, extracted: data };
  }

  /**
   * Validate text pattern format.
   *
   * Checks if any response matches the specified regex pattern.
   *
   * @param summary - Iteration summary
   * @param format - Response format with pattern
   * @returns Validation result
   */
  private validatePattern(
    summary: IterationSummary,
    format: ResponseFormat,
  ): ValidationResult {
    const { pattern } = format;

    if (!pattern) {
      return {
        valid: false,
        error: "pattern is required for text-pattern validation",
      };
    }

    const regex = new RegExp(pattern);

    for (const response of summary.assistantResponses) {
      const match = regex.exec(response);
      if (match) {
        return {
          valid: true,
          extracted: {
            fullMatch: match[0],
            groups: match.groups ?? {},
            captures: match.slice(1),
          },
        };
      }
    }

    return {
      valid: false,
      error: `Pattern "${pattern}" not found in response`,
    };
  }

  /**
   * Check if a value matches the expected type.
   *
   * @param value - Value to check
   * @param expectedType - Expected type or specific value
   * @returns true if type matches
   */
  private checkType(value: unknown, expectedType: FieldType): boolean {
    switch (expectedType) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number";
      case "boolean":
        return typeof value === "boolean";
      default:
        // For specific values (e.g., "close"), check equality
        return value === expectedType;
    }
  }

  /**
   * Escape special regex characters.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
