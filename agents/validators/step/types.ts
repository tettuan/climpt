/**
 * StepValidator Types
 *
 * Type definitions specific to StepValidator.
 * Common types are re-exported from agents/common/validation-types.ts.
 */

import type { Logger } from "../../src_common/logger.ts";
import type { SemanticParams as SemanticParamsType } from "../../common/validation-types.ts";

// Re-export common types
export type {
  CommandResult,
  ExtendedStepsRegistry,
  ExtractorType,
  FailureAction,
  FailurePattern,
  OnFailureConfig,
  SemanticCheckType,
  SemanticParams,
  SemanticValidatorConfig,
  SuccessCondition,
  ValidationCondition,
  ValidationStepConfig,
  ValidatorDefinition,
  ValidatorResult,
  ValidatorType,
} from "../../common/validation-types.ts";

export {
  getPatternFromResult,
  isExtendedRegistry,
  isValidationStepConfig,
} from "../../common/validation-types.ts";

/**
 * StepValidator context
 */
export interface StepValidatorContext {
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
    import("../../common/validation-types.ts").ValidatorDefinition
  >;
  /** Map of failure patterns */
  failurePatterns?: Record<
    string,
    import("../../common/validation-types.ts").FailurePattern
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
  /** Semantic context for the extracted parameters (optional) */
  semanticParams?: SemanticParamsType;
  /** Error message */
  error?: string;
  /** Whether the failure is recoverable (retryable) */
  recoverable?: boolean;
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
