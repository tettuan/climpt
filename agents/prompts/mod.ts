/**
 * Prompts Module - Entry point for prompt resolution
 */

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

// ============================================================================
// Fallback
// ============================================================================

export {
  DefaultFallbackProvider,
  type FallbackTemplateProvider,
} from "./fallback.ts";
