/**
 * Completion Validation Types
 *
 * Type definitions for completion condition validation and partial retry.
 * Works in conjunction with the existing validators/ system.
 */

import type { StepRegistry } from "./step-registry.ts";

// ============================================================================
// CompletionPattern - Failure pattern definitions for C3L integration
// ============================================================================

/**
 * Failure pattern definition
 * Provides mapping from pattern names to C3L prompt paths
 */
export interface CompletionPattern {
  /** Description of the pattern */
  description: string;
  /** C3L edition (e.g., "failed") */
  edition: string;
  /** C3L adaptation (e.g., "git-dirty") */
  adaptation: string;
  /** Parameter names to inject into retry prompts */
  params: string[];
}

// ============================================================================
// ValidatorDefinition - JSON-definable Validator specification
// ============================================================================

/**
 * Validator success conditions
 *
 * - "empty": Output is empty (git status --porcelain is empty)
 * - "exitCode:N": Exit code is N
 * - "contains:STRING": Output contains the string
 * - "matches:REGEX": Output matches the regex pattern
 */
export type SuccessCondition =
  | "empty"
  | `exitCode:${number}`
  | `contains:${string}`
  | `matches:${string}`;

/**
 * Parameter extraction rule names
 */
export type ExtractorType =
  | "parseChangedFiles"
  | "parseUntrackedFiles"
  | "parseTestOutput"
  | "parseTypeErrors"
  | "parseLintErrors"
  | "parseFormatOutput"
  | "extractFiles"
  | "generateDiff"
  | "stderr"
  | "stdout"
  | "exitCode"
  | "missingPaths"
  | "expectedPath"
  | "parseBranchName"
  | "parseRemoteStatus"
  | "parseMergeStatus";

/**
 * Validator type
 */
export type ValidatorType = "command" | "file" | "custom";

/**
 * Declarative validator definition (JSON format)
 *
 * Execution logic is handled by CompletionValidator.
 */
export interface ValidatorDefinition {
  /** Validator type */
  type: ValidatorType;
  /** For command type: command to execute */
  command?: string;
  /** For file type: path to check */
  path?: string;
  /** Success condition */
  successWhen: SuccessCondition;
  /** Pattern name on failure (key in completionPatterns) */
  failurePattern: string;
  /** Parameter extraction rules */
  extractParams: Record<string, ExtractorType | string>;
}

// ============================================================================
// CompletionCondition - Step completion conditions
// ============================================================================

/**
 * Single completion condition
 */
export interface CompletionCondition {
  /** validator ID or key in validators */
  validator: string;
  /** Optional parameters for the validator */
  params?: Record<string, unknown>;
}

/**
 * Action on failure
 */
export type FailureAction = "retry" | "abort" | "skip";

/**
 * On-failure action configuration
 */
export interface OnFailureConfig {
  /** Action on failure */
  action: FailureAction;
  /** Maximum retry attempts (for retry action) */
  maxAttempts?: number;
}

// ============================================================================
// Response Format - Agent response format specification
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
 * Step check configuration for format validation with retry
 */
export interface StepCheckConfig {
  /** Expected response format */
  responseFormat: ResponseFormat;
  /** Action when check passes */
  onPass: {
    /** Mark as complete */
    complete?: boolean;
    /** Next step ID */
    next?: string;
  };
  /** Action when check fails */
  onFail: {
    /** Retry the step */
    retry?: boolean;
    /** Maximum retry attempts */
    maxRetries?: number;
    /** Prompt configuration for retry request */
    retryPrompt?: {
      c2: string;
      c3: string;
      edition: string;
    };
  };
}

// ============================================================================
// OutputSchemaRef - Reference to external schema file
// ============================================================================

/**
 * Reference to an external JSON Schema file
 */
export interface OutputSchemaRef {
  /** Schema file name (relative to schemasBase) */
  file: string;
  /** Schema name within the file (top-level key) */
  schema: string;
}

// ============================================================================
// CompletionStepConfig - Step configuration with completion conditions
// ============================================================================

/**
 * Step configuration with completion conditions
 *
 * Extended step definition including completion conditions and retry settings.
 */
export interface CompletionStepConfig {
  /** Step ID */
  stepId: string;
  /** Display name */
  name: string;
  /** C3L path component: c2 (retry, complete, etc.) */
  c2: string;
  /** C3L path component: c3 (issue, project, etc.) */
  c3: string;
  /** Array of completion conditions (AND conditions) */
  completionConditions: CompletionCondition[];
  /** Behavior on failure */
  onFailure: OnFailureConfig;
  /** Response format check with retry support */
  check?: StepCheckConfig;
  /**
   * JSON Schema for structured output (inline definition).
   * When specified, the query uses SDK's outputFormat parameter
   * to get validated JSON responses.
   */
  outputSchema?: Record<string, unknown>;
  /**
   * Reference to external JSON Schema file.
   * Alternative to inline outputSchema.
   */
  outputSchemaRef?: OutputSchemaRef;
  /** Description */
  description?: string;
}

// ============================================================================
// ValidatorResult - Validation result with pattern info
// ============================================================================

/**
 * Validation result with pattern and parameters
 *
 * Extended validation result including pattern and parameters for retry.
 */
export interface ValidatorResult {
  /** Validation success/failure */
  valid: boolean;
  /** Pattern name on failure */
  pattern?: string;
  /** Extracted parameters (for retry prompt injection) */
  params?: Record<string, unknown>;
  /** Error message */
  error?: string;
  /** Detailed information */
  details?: string[];
}

// ============================================================================
// ExtendedStepsRegistry - Registry with completion patterns
// ============================================================================

/**
 * Extended Steps Registry
 *
 * Extends existing StepRegistry with completionPatterns and validators.
 */
export interface ExtendedStepsRegistry extends StepRegistry {
  /** Base path for schema files */
  schemasBase?: string;

  /** Failure pattern definitions */
  completionPatterns?: Record<string, CompletionPattern>;

  /** Validator definitions */
  validators?: Record<string, ValidatorDefinition>;

  /** Step configurations with completion conditions */
  completionSteps?: Record<string, CompletionStepConfig>;
}

// ============================================================================
// Type guards
// ============================================================================

/**
 * Check if the step is a completion step configuration
 */
export function isCompletionStepConfig(
  step: unknown,
): step is CompletionStepConfig {
  return (
    typeof step === "object" &&
    step !== null &&
    "completionConditions" in step &&
    Array.isArray((step as CompletionStepConfig).completionConditions)
  );
}

/**
 * Check if the registry is an extended registry
 */
export function isExtendedRegistry(
  registry: unknown,
): registry is ExtendedStepsRegistry {
  return (
    typeof registry === "object" &&
    registry !== null &&
    ("completionPatterns" in registry || "validators" in registry)
  );
}

/**
 * Get pattern from validation result
 */
export function getPatternFromResult(
  result: ValidatorResult,
): string | undefined {
  return result.pattern;
}

// ============================================================================
// Command execution result
// ============================================================================

/**
 * Command execution result
 */
export interface CommandResult {
  /** Success flag */
  success: boolean;
  /** Exit code */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error output */
  stderr: string;
}
