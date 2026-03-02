/**
 * Verdict handlers module exports
 *
 * This module provides verdict handlers for different completion strategies.
 *
 * Verdict types:
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
 * - ContractVerdictHandler: Interface with no side effects in check()
 * - IssueVerdictHandler: Issue handler using external state checker
 * - ExternalStateChecker: Interface for external state retrieval
 */

// Types
export type { VerdictCriteria, VerdictHandler } from "./types.ts";
export { BaseVerdictHandler, formatIterationSummary } from "./types.ts";
export type { IterationSummary, VerdictType } from "./types.ts";

// Contract-compliant types
export type {
  CheckContext,
  ContractVerdictHandler,
  StepResult,
  VerdictResult,
} from "./types.ts";

// Factory functions
export { createRegistryVerdictHandler } from "./factory.ts";

// External State Checker
export {
  type ExternalStateChecker,
  GitHubStateChecker,
  type IssueState,
  MockStateChecker,
} from "./external-state-checker.ts";

// Issue verdict handler (contract-compliant)
export { type IssueContractConfig, IssueVerdictHandler } from "./issue.ts";

// External state adapter (bridges ContractVerdictHandler -> VerdictHandler)
export {
  type ExternalStateAdapterConfig,
  ExternalStateVerdictAdapter,
} from "./external-state-adapter.ts";

// iterationBudget - Complete after N iterations
export { IterationBudgetVerdictHandler } from "./iteration-budget.ts";

// keywordSignal - Complete when LLM outputs specific keyword
export { KeywordSignalVerdictHandler } from "./keyword-signal.ts";

// checkBudget - Complete after N status checks
export { CheckBudgetVerdictHandler } from "./check-budget.ts";

// structuredSignal - Complete when LLM outputs specific JSON signal
export { StructuredSignalVerdictHandler } from "./structured-signal.ts";

// composite - Combines multiple conditions with AND/OR logic
export {
  type CompositeCondition,
  type CompositeOperator,
  CompositeVerdictHandler,
} from "./composite.ts";

// stepMachine - Complete when step state machine reaches terminal
export { StepMachineVerdictHandler, type StepState } from "./step-machine.ts";

// Re-export type utilities from src_common/types.ts
export { ALL_VERDICT_TYPES } from "../src_common/types.ts";
