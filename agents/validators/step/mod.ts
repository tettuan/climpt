/**
 * Completion Validation Module
 *
 * Module for step completion condition validation and partial retry.
 */

// Types
export type {
  CommandResult,
  CompletionCondition,
  CompletionPattern,
  CompletionStepConfig,
  CompletionValidatorContext,
  ExtendedStepsRegistry,
  ExtractorType,
  FailureAction,
  OnFailureConfig,
  SuccessCondition,
  ValidatorDefinition,
  ValidatorRegistry,
  ValidatorResult,
  ValidatorRunResult,
  ValidatorType,
} from "./types.ts";

// Type guards
export {
  getPatternFromResult,
  isCompletionStepConfig,
  isExtendedRegistry,
} from "./types.ts";

// Validator
export { CompletionValidator, createCompletionValidator } from "./validator.ts";

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
