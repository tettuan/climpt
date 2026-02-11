/**
 * Prompts Module - Entry point for prompt resolution
 */

// ============================================================================
// Adapters
// ============================================================================

export {
  FilePromptAdapter,
  type PromptAdapter,
  PromptNotFoundError,
} from "./adapter.ts";

export {
  ClimptAdapter,
  type ClimptReference,
  toClimptPath,
} from "./climpt-adapter.ts";

// ============================================================================
// Variable substitution
// ============================================================================

export {
  checkVariables,
  extractVariableNames,
  substituteVariables,
} from "./variable-substitutor.ts";

// ============================================================================
// Resolver Adapter (replaces old PromptResolver)
// ============================================================================

export {
  type PromptResolutionResult,
  PromptResolverAdapter,
  type PromptResolverOptions,
} from "./resolver-adapter.ts";

// ============================================================================
// Fallback
// ============================================================================

/** @deprecated Use PromptNotFoundError from adapter.ts instead */
export {
  DefaultFallbackProvider,
  type FallbackPromptProvider,
} from "./fallback.ts";

/** Alias for backward compatibility */
export { DefaultFallbackProvider as FallbackResolver } from "./fallback.ts";
