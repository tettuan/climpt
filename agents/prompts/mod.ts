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
// Resolver (v2)
// ============================================================================

export {
  type PromptReferenceV2,
  PromptResolverV2,
  type ResolverOptions,
} from "./resolver.ts";

// ============================================================================
// Legacy exports (backward compatibility)
// ============================================================================

export {
  PromptResolver,
  type PromptResolverOptions,
  type StepDefinition as PromptStepDefinition,
  type StepRegistry,
} from "./resolver.ts";

/** @deprecated Use PromptNotFoundError from adapter.ts instead */
export {
  DefaultFallbackProvider,
  type FallbackPromptProvider,
} from "./fallback.ts";

/** Alias for backward compatibility */
export { DefaultFallbackProvider as FallbackResolver } from "./fallback.ts";
