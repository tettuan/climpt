/**
 * Shared Error Hierarchy - Public Exports
 *
 * All Climpt errors extend ClimptError, which provides:
 * - `code`: programmatic error code
 * - `recoverable`: whether retry/recovery is possible
 * - `iteration`: optional iteration context
 * - `toJSON()`: structured representation for logging
 *
 * Domain groupings:
 * - base: ClimptError (abstract), AgentError (alias), type guards
 * - runner-errors: query, completion, timeout, max iterations, retryable
 * - flow-errors: schema resolution, step routing, gate interpretation
 * - env-errors: environment constraints, rate limits, config, prompt
 * - git-errors: git command failures
 */

// Base
export {
  AgentError,
  ClimptError,
  isAgentError,
  isClimptError,
} from "./base.ts";

// Runner errors
export {
  AgentCompletionError,
  AgentMaxIterationsError,
  AgentNotInitializedError,
  AgentQueryError,
  AgentRetryableQueryError,
  AgentTimeoutError,
  normalizeToAgentError,
} from "./runner-errors.ts";

// Re-export SdkErrorCategoryType from runner-errors for backward compat
export type { SdkErrorCategoryType as RunnerSdkErrorCategoryType } from "./runner-errors.ts";

// Flow errors
export {
  AgentSchemaResolutionError,
  AgentStepIdMismatchError,
  AgentStepRoutingError,
  GateInterpretationError,
  MalformedSchemaIdentifierError,
  RoutingError,
  SchemaPointerError,
} from "./flow-errors.ts";

// Environment errors
export {
  AgentEnvironmentError,
  AgentRateLimitError,
  ConfigurationLoadError,
  PromptNotFoundError,
} from "./env-errors.ts";
export type {
  EnvironmentInfoType,
  SdkErrorCategoryType,
} from "./env-errors.ts";

// Git errors
export { GitCommandError } from "./git-errors.ts";
