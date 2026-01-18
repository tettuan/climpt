/**
 * Completion handlers module exports
 *
 * This module provides completion handlers for different completion strategies.
 * Handlers use behavior-based naming with aliases for legacy names.
 *
 * Completion types:
 * - externalState: Complete when external resource reaches target state
 * - iterationBudget: Complete after N iterations
 * - checkBudget: Complete after N status checks
 * - keywordSignal: Complete when LLM outputs specific keyword
 * - structuredSignal: Complete when LLM outputs specific JSON signal
 * - stepMachine: Complete when step state machine reaches terminal
 * - composite: Combines multiple conditions with AND/OR logic
 * - custom: Fully custom handler implementation
 *
 * Contract-compliant Interfaces:
 * - ContractCompletionHandler: Interface with no side effects in check()
 * - IssueContractHandler: Issue handler using external state checker
 * - ExternalStateChecker: Interface for external state retrieval
 */

// Types
export type { CompletionCriteria, CompletionHandler } from "./types.ts";
export { BaseCompletionHandler, formatIterationSummary } from "./types.ts";
export type { CompletionType, IterationSummary } from "./types.ts";

// Contract-compliant types
export type {
  CheckContext,
  CompletionHandlerV2,
  CompletionResult,
  ContractCompletionHandler,
  StepResult,
} from "./types.ts";

// Factory functions
export {
  type CompletionHandlerOptions,
  createCompletionHandler,
  createCompletionHandlerFromOptions,
  getRegisteredHandler,
  registerCompletionHandler,
} from "./factory.ts";

// Contract-compliant factory
export {
  type CompletionHandlerV2Options,
  createCompletionHandlerV2,
} from "./factory.ts";

// External State Checker
export {
  type ExternalStateChecker,
  GitHubStateChecker,
  type IssueState,
  MockStateChecker,
} from "./external-state-checker.ts";

// Issue completion handlers
export { IssueCompletionHandler, type ProjectContext } from "./issue.ts";

// Contract-compliant issue handler
export {
  type IssueCompletionConfigV2,
  IssueCompletionHandlerV2,
  type IssueContractConfig,
  IssueContractHandler,
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

// stepMachine - Complete when step state machine reaches terminal (new)
export {
  StepMachineCompletionHandler,
  type StepState,
  type StepTransition,
} from "./step-machine.ts";

// Re-export type utilities from src_common/types.ts
export {
  ALL_COMPLETION_TYPES,
  COMPLETION_TYPE_ALIASES,
  isLegacyCompletionType,
  resolveCompletionType,
} from "../src_common/types.ts";
