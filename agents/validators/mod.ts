/**
 * Validators Module
 *
 * Pre-close validation system for agents.
 * Provides plugin architecture for validating agent state before closing issues.
 */

// Type exports
export type {
  AggregateValidationResult,
  PreCloseValidationConfig,
  ValidationResult, // deprecated, use ValidatorResult
  Validator,
  ValidatorContext,
  ValidatorResult,
} from "./types.ts";

// Registry exports
export {
  clearValidators,
  getValidator,
  hasValidator,
  listValidators,
  registerValidator,
  resetValidators,
  runValidators,
} from "./registry.ts";

// Plugin exports
export { gitCleanValidator } from "./plugins/git-clean.ts";
