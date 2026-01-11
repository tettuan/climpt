/**
 * Completion handlers module exports
 *
 * This module provides completion handlers for different completion strategies.
 * Handlers use behavior-based naming (new) with aliases for legacy names (deprecated).
 *
 * New behavior-based names:
 * - externalState: Complete when external resource reaches target state (was: issue)
 * - iterationBudget: Complete after N iterations (was: iterate)
 * - checkBudget: Complete after N status checks (new)
 * - keywordSignal: Complete when LLM outputs specific keyword (was: manual)
 * - structuredSignal: Complete when LLM outputs specific JSON signal (new)
 * - phaseCompletion: Complete when workflow reaches terminal phase (was: project)
 * - stepMachine: Complete when step state machine reaches terminal (was: stepFlow)
 * - composite: Combines multiple conditions with AND/OR logic (was: facilitator)
 * - custom: Fully custom handler implementation
 */

export type { CompletionCriteria, CompletionHandler } from "./types.ts";
export { BaseCompletionHandler, formatIterationSummary } from "./types.ts";
export type { CompletionType, IterationSummary } from "./types.ts";

export {
  type CompletionHandlerOptions,
  createCompletionHandler,
  createCompletionHandlerFromOptions,
  getRegisteredHandler,
  registerCompletionHandler,
} from "./factory.ts";

// externalState (was: issue) - Complete when external resource reaches target state
export { IssueCompletionHandler, type ProjectContext } from "./issue.ts";

// phaseCompletion (was: project) - Complete when workflow reaches terminal phase
export {
  ProjectCompletionHandler,
  type ProjectIssueInfo,
  type ProjectPhase,
  type ProjectPlan,
  type ReviewResult,
} from "./project.ts";

// iterationBudget (was: iterate) - Complete after N iterations
export { IterateCompletionHandler } from "./iterate.ts";

// keywordSignal (was: manual) - Complete when LLM outputs specific keyword
export { ManualCompletionHandler } from "./manual.ts";

// composite (was: facilitator) - Combines multiple conditions with AND/OR logic
// Note: FacilitatorCompletionHandler is kept for backward compatibility
export {
  type BlockerInfo,
  FacilitatorCompletionHandler,
  type FacilitatorPhase,
  type FacilitatorReport,
  type ProjectStatus,
} from "./facilitator.ts";

// checkBudget - Complete after N status checks (new)
export { CheckBudgetCompletionHandler } from "./check-budget.ts";

// structuredSignal - Complete when LLM outputs specific JSON signal (new)
export { StructuredSignalCompletionHandler } from "./structured-signal.ts";

// composite - Combines multiple conditions with AND/OR logic (new)
export {
  CompositeCompletionHandler,
  type CompositeCondition,
  type CompositeOperator,
} from "./composite.ts";

// Re-export type utilities from src_common/types.ts
export {
  ALL_COMPLETION_TYPES,
  COMPLETION_TYPE_ALIASES,
  isLegacyCompletionType,
  resolveCompletionType,
} from "../src_common/types.ts";
