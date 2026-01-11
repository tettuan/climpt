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

// Lifecycle Layer
export {
  AgentLifecycle,
  AgentStateMachine,
  InvalidTransitionError,
} from "../lifecycle/mod.ts";
export type {
  AgentStatus,
  LifecycleAction,
  LifecycleContext,
  LifecycleOptions,
} from "../lifecycle/mod.ts";

// Loop Layer
export { AgentLoop, IterationExecutor, StepContextImpl } from "../loop/mod.ts";
export type {
  IterationOptions,
  IterationResult,
  LoopContext,
  LoopResult,
} from "../loop/mod.ts";

// SDK Bridge Layer
export {
  ClaudeSdkBridge,
  mergeSandboxConfig,
  MessageProcessor,
  toSdkSandboxConfig,
} from "../bridge/mod.ts";
export type {
  ProcessedMessage,
  QueryOptions,
  SdkBridge,
  SdkMessage,
} from "../bridge/mod.ts";

// Completion Layer
export {
  createCompletionHandlerV2,
  GitHubStateChecker,
  IssueCompletionHandlerV2,
  MockStateChecker,
} from "../completion/mod.ts";
export type {
  CompletionHandlerV2,
  ExternalStateChecker,
  IssueState,
} from "../completion/mod.ts";

// Prompt Layer
export {
  ClimptAdapter,
  FilePromptAdapter,
  PromptResolverV2,
  substituteVariables,
} from "../prompts/mod.ts";
export type {
  PromptAdapter,
  PromptReferenceV2,
  ResolverOptions,
} from "../prompts/mod.ts";

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
  AgentActionError,
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

/** @deprecated Use AgentRunnerBuilder with v2 components */
export {
  type ActionSystemFactory,
  type AgentDependencies,
  AgentRunnerBuilder,
  type CompletionHandlerFactory,
  createDefaultDependencies,
  DefaultActionSystemFactory,
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
