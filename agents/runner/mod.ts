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

// Completion Layer
export {
  createCompletionHandler,
  GitHubStateChecker,
  IssueCompletionHandler,
  MockStateChecker,
} from "../completion/mod.ts";
export type {
  ContractCompletionHandler,
  ExternalStateChecker,
  IssueState,
} from "../completion/mod.ts";

// Prompt Layer
export {
  ClimptAdapter,
  FilePromptAdapter,
  PromptResolverAdapter,
  substituteVariables,
} from "../prompts/mod.ts";
export type { PromptAdapter } from "../prompts/mod.ts";

// Contracts
export type {
  AgentResultV2,
  CheckContext,
  CompletionContract,
  CompletionResult,
  ConfigurationContract,
  ConnectionContract,
  ExecutionContract,
  InputSpec,
  StartOptions,
  StepContext,
  Variables,
} from "../src_common/contracts.ts";

// === Legacy (deprecated, 互換性のため維持) ===

// Errors (still relevant for v2)
export {
  AgentCompletionError,
  AgentError,
  AgentMaxIterationsError,
  AgentNotInitializedError,
  AgentQueryError,
  AgentTimeoutError,
  isAgentError,
  normalizeToAgentError,
} from "./errors.ts";

/** @deprecated Use AgentLifecycle instead */
export { AgentRunner, type RunnerOptions } from "./runner.ts";

// Completion Chain (extracted from runner.ts)
export {
  CompletionChain,
  type CompletionChainOptions,
  type CompletionValidationResult,
} from "./completion-chain.ts";

/** @deprecated Use AgentRunnerBuilder with v2 components */
export {
  type AgentDependencies,
  AgentRunnerBuilder,
  type CompletionHandlerFactory,
  createDefaultDependencies,
  DefaultCompletionHandlerFactory,
  DefaultLoggerFactory,
  DefaultPromptResolverFactory,
  type LoggerFactory,
  type LoggerFactoryOptions,
  type PromptResolverFactory,
  type PromptResolverFactoryOptions,
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
