// deno-lint-ignore-file prefer-ascii
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

// === Legacy (deprecated, 互換性のため維持) ===

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

/** @deprecated Use AgentLifecycle instead */
export { AgentRunner, type RunnerOptions } from "./runner.ts";

// Validation Chain (extracted from runner.ts)
export {
  ValidationChain,
  type ValidationChainOptions,
  type ValidationResult,
} from "./validation-chain.ts";

/** @deprecated Use AgentRunnerBuilder with v2 components */
export {
  type AgentDependencies,
  AgentRunnerBuilder,
  createDefaultDependencies,
  DefaultLoggerFactory,
  DefaultPromptResolverFactory,
  DefaultVerdictHandlerFactory,
  type LoggerFactory,
  type LoggerFactoryOptions,
  type PromptResolverFactory,
  type PromptResolverFactoryOptions,
  type VerdictHandlerFactory,
} from "./builder.ts";

/** @deprecated Use loadConfiguration from config/mod.ts */
export {
  agentExists,
  getAgentDir,
  listAgents,
  loadAgentDefinition,
  validateAgentDefinition,
} from "./loader.ts";

/** @deprecated Use events from lifecycle layer */
export {
  type AgentEvent,
  AgentEventEmitter,
  type AgentEventHandler,
  type AgentEventPayloads,
} from "./events.ts";

// CLI utilities (not deprecated, still useful)
export { generateAgentHelp, parseCliArgs, type ParsedCliArgs } from "./cli.ts";
