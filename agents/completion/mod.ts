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
 * - stepMachine: Complete when step state machine reaches terminal (was: stepFlow)
 * - composite: Combines multiple conditions with AND/OR logic (was: facilitator)
 * - custom: Fully custom handler implementation
 *
 * V2 Interfaces (Contract-compliant):
 * - CompletionHandlerV2: Interface with no side effects in check()
 * - IssueCompletionHandlerV2: Issue handler using external state checker
 * - ExternalStateChecker: Interface for external state retrieval
 */

// V1 Types (existing, maintained for backward compatibility)
export type { CompletionCriteria, CompletionHandler } from "./types.ts";
export { BaseCompletionHandler, formatIterationSummary } from "./types.ts";
export type { CompletionType, IterationSummary } from "./types.ts";

// V2 Types (contract-compliant)
export type {
  CheckContext,
  CompletionHandlerV2,
  CompletionResult,
  StepResult,
} from "./types.ts";

// V1 Factory (deprecated, maintained for backward compatibility)
export {
  /** @deprecated Use createCompletionHandlerV2 instead */
  type CompletionHandlerOptions,
  /** @deprecated Use createCompletionHandlerV2 instead */
  createCompletionHandler,
  /** @deprecated Use createCompletionHandlerV2 instead */
  createCompletionHandlerFromOptions,
  getRegisteredHandler,
  registerCompletionHandler,
} from "./factory.ts";

// V2 Factory (contract-compliant)
export {
  type CompletionHandlerV2Options,
  createCompletionHandlerV2,
} from "./factory.ts";

// External State Checker (V2)
export {
  type ExternalStateChecker,
  GitHubStateChecker,
  type IssueState,
  MockStateChecker,
} from "./external-state-checker.ts";

// externalState (was: issue) - Complete when external resource reaches target state
// V1 handler (deprecated)
export {
  /** @deprecated Use IssueCompletionHandlerV2 instead */
  IssueCompletionHandler,
  type ProjectContext,
} from "./issue.ts";

// V2 handler (contract-compliant)
export {
  type IssueCompletionConfigV2,
  IssueCompletionHandlerV2,
} from "./issue.ts";

// iterationBudget (was: iterate) - Complete after N iterations
export { IterateCompletionHandler } from "./iterate.ts";

// keywordSignal (was: manual) - Complete when LLM outputs specific keyword
export { ManualCompletionHandler } from "./manual.ts";

// checkBudget - Complete after N status checks
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
