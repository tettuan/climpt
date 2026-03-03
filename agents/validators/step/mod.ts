/**
 * Step Validation Module
 *
 * Module for step validation condition checking and partial retry.
 */

// Types
export type {
  CommandResult,
  ExtendedStepsRegistry,
  ExtractorType,
  FailureAction,
  FailurePattern,
  OnFailureConfig,
  StepValidatorContext,
  SuccessCondition,
  ValidationCondition,
  ValidationStepConfig,
  ValidatorDefinition,
  ValidatorRegistry,
  ValidatorResult,
  ValidatorRunResult,
  ValidatorType,
} from "./types.ts";

// Type guards
export {
  getPatternFromResult,
  isExtendedRegistry,
  isValidationStepConfig,
} from "./types.ts";

// Validator
export { createStepValidator, StepValidator } from "./validator.ts";

// Command runner
export { checkSuccessCondition, CommandRunner } from "./command-runner.ts";

// Param extractors
export { defaultParamExtractor, ParamExtractor } from "./param-extractors.ts";

// Individual extractors
export {
  parseChangedFiles,
  parseStagedFiles,
  parseUnstagedFiles,
  parseUntrackedFiles,
} from "./extractors/git-status.ts";

export {
  getTestErrorOutput,
  parseTestOutput,
} from "./extractors/test-output.ts";
export type { FailedTest } from "./extractors/test-output.ts";

export { extractFiles, parseTypeErrors } from "./extractors/type-errors.ts";
export type { TypeError } from "./extractors/type-errors.ts";

export { extractLintFiles, parseLintErrors } from "./extractors/lint-errors.ts";
export type { LintError } from "./extractors/lint-errors.ts";

export {
  formatErrorSummary,
  generateDiff,
  parseFormatOutput,
} from "./extractors/format-check.ts";
