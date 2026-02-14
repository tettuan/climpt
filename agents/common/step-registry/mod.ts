/**
 * Step Registry - Prompt Externalization Foundation
 *
 * Manages step definitions that map logical steps (e.g., "initial.issue")
 * to external prompt files. This enables:
 * - Customizable prompts via user files in .agent/{agent}/prompts/
 * - Fallback to built-in prompts when user files don't exist
 * - Variable substitution for dynamic content
 * - Response format validation for structured outputs
 */

// Types
export type {
  GateIntent,
  PromptStepDefinition,
  RegistryLoaderOptions,
  StepKind,
  StepRegistry,
  StepType,
  StructuredGate,
  TransitionRule,
  Transitions,
} from "./types.ts";
export { STEP_KIND_ALLOWED_INTENTS } from "./types.ts";

// Utils
export {
  addStepDefinition,
  createEmptyRegistry,
  getStepDefinition,
  getStepIds,
  hasStep,
  inferStepKind,
} from "./utils.ts";

// Loader
export { loadStepRegistry } from "./loader.ts";

// Validator
export {
  validateEntryStepMapping,
  validateIntentSchemaEnums,
  validateIntentSchemaRef,
  validateStepKindIntents,
  validateStepRegistry,
} from "./validator.ts";

// Serializer
export { saveStepRegistry, serializeRegistry } from "./serializer.ts";
