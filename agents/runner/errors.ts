/**
 * AgentError Hierarchy - Re-exports from shared/errors
 *
 * This file now re-exports all error classes from the unified
 * agents/shared/errors/ hierarchy. All existing imports continue
 * to work unchanged.
 *
 * Canonical location: agents/shared/errors/
 */

// Base class (ClimptError with AgentError alias)
export {
  AgentError,
  ClimptError,
  isAgentError,
  isClimptError,
} from "../shared/errors/base.ts";

// Runner errors
export {
  AgentCompletionError,
  AgentMaxIterationsError,
  AgentNotInitializedError,
  AgentQueryError,
  AgentRetryableQueryError,
  AgentTimeoutError,
  normalizeToAgentError,
} from "../shared/errors/runner-errors.ts";
export type { SdkErrorCategoryType } from "../shared/errors/runner-errors.ts";

// Flow errors
export {
  AgentSchemaResolutionError,
  AgentStepIdMismatchError,
  AgentStepRoutingError,
} from "../shared/errors/flow-errors.ts";

// Environment errors
export {
  AgentEnvironmentError,
  AgentRateLimitError,
} from "../shared/errors/env-errors.ts";
export type { EnvironmentInfoType } from "../shared/errors/env-errors.ts";
