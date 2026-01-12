/**
 * CompletionValidator Types
 *
 * Type definitions specific to CompletionValidator.
 * Common types are re-exported from agents/common/completion-types.ts.
 */

import type { Logger } from "../../src_common/logger.ts";

// Re-export common types
export type {
  CommandResult,
  CompletionCondition,
  CompletionPattern,
  ExtractorType,
  FailureAction,
  OnFailureConfig,
  StepConfigV3,
  StepsRegistryV3,
  SuccessCondition,
  ValidationResultV3,
  ValidatorDefinition,
  ValidatorType,
} from "../../common/completion-types.ts";

export {
  getPatternFromResult,
  isRegistryV3,
  isStepConfigV3,
} from "../../common/completion-types.ts";

/**
 * CompletionValidator context
 */
export interface CompletionValidatorContext {
  /** Working directory */
  workingDir: string;
  /** Logger */
  logger: Logger;
  /** Agent ID */
  agentId?: string;
}

/**
 * Validator registry interface
 */
export interface ValidatorRegistry {
  /** Map of validator definitions */
  validators: Record<
    string,
    import("../../common/completion-types.ts").ValidatorDefinition
  >;
  /** Map of completion patterns */
  completionPatterns?: Record<
    string,
    import("../../common/completion-types.ts").CompletionPattern
  >;
}

/**
 * Single validator execution result
 */
export interface ValidatorRunResult {
  /** Validation success flag */
  valid: boolean;
  /** Extracted parameters */
  params?: Record<string, unknown>;
  /** Error message */
  error?: string;
}

/**
 * Parameter extraction function signature
 */
export type ExtractorFunction = (
  stdout: string,
  stderr: string,
  exitCode: number,
) => unknown;

/**
 * Extractor function registry type
 */
export type ExtractorRegistry = Map<string, ExtractorFunction>;
