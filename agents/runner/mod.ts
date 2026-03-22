// deno-lint-ignore-file
/**
 * Agent Runner Module - Entry Point
 *
 * Migration to v2 architecture is recommended
 */

// === V2 Architecture (Recommended) ===

// Configuration Layer
export {
  applyDefaults,
  ConfigurationLoadError,
  ConfigurationService,
  loadConfiguration,
  validate,
} from "../config/mod.ts";

// Loop Layer (FormatValidator now integrated into AgentRunner)
// Note: IterationExecutor was removed - iteration execution is handled in AgentRunner
export { FormatValidator, StepContextImpl } from "../loop/mod.ts";
export type { FormatValidationResult } from "../loop/mod.ts";

// Verdict Layer
export {
  GitHubStateChecker,
  IssueVerdictHandler,
  MockStateChecker,
} from "../verdict/mod.ts";
export type {
  ContractVerdictHandler,
  ExternalStateChecker,
  IssueState,
} from "../verdict/mod.ts";

// Prompt Layer
export {
  ClimptAdapter,
  FilePromptAdapter,
  substituteVariables,
} from "../prompts/mod.ts";
export type { PromptAdapter } from "../prompts/mod.ts";
export { PromptResolver } from "../common/prompt-resolver.ts";

// Contracts
export type {
  AgentResultV2,
  CheckContext,
  ConfigurationContract,
  ConnectionContract,
  ExecutionContract,
  InputSpec,
  StartOptions,
  StepContext,
  Variables,
  VerdictContract,
  VerdictResult,
} from "../src_common/contracts.ts";

// Errors (still relevant for v2)
export {
  AgentError,
  AgentMaxIterationsError,
  AgentNotInitializedError,
  AgentQueryError,
  AgentTimeoutError,
  AgentVerdictError,
  isAgentError,
  normalizeToAgentError,
} from "./errors.ts";
