/**
 * Prompts Module - Entry point for prompt resolution
 */

// ============================================================================
// Adapters
// ============================================================================

export {
  FilePromptAdapter,
  isPromptFileNotFound,
  prFileNotFound,
  type PromptAdapter,
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
// System Prompt Resolution
// ============================================================================

export {
  resolveSystemPrompt,
  type SystemPromptOptions,
  type SystemPromptResult,
} from "./system-prompt.ts";
