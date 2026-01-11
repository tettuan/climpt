/**
 * Internal module exports
 *
 * Note: This file maintains backward compatibility.
 * For new code, prefer importing directly from:
 * - agents/runner/mod.ts (v2 architecture)
 * - agents/mod.ts (top-level entry)
 */

// Common types - explicit exports to avoid conflicts
export {
  ALL_COMPLETION_TYPES,
  COMPLETION_TYPE_ALIASES,
  INITIAL_AGENT_STATE,
  isLegacyCompletionType,
  resolveCompletionType,
  RuntimeContextNotInitializedError,
} from "./src_common/types.ts";
export type {
  ActionConfig,
  ActionResult,
  AgentBehavior,
  AgentDefinition,
  AgentResult,
  AgentResultDetail,
  AgentState,
  CheckBudgetCompletionConfig,
  CheckDefinition,
  CheckResponse,
  CompletionConfigUnion,
  CompletionSignal,
  CompletionType,
  CompositeCompletionConfig,
  CustomCompletionConfig,
  CustomVariableDefinition,
  DetectedAction,
  ExternalStateCompletionConfig,
  GitHubConfig,
  IssueCompletionConfig,
  IterateCompletionConfig,
  IterationBudgetCompletionConfig,
  IterationConfig,
  IterationSummary,
  KeywordSignalCompletionConfig,
  LoggingConfig,
  ManualCompletionConfig,
  ParameterDefinition,
  ParameterValidation,
  PermissionMode,
  PhaseCompletionConfig,
  ProjectCompletionConfig,
  PromptC3LReference,
  PromptConfig,
  PromptPathReference,
  PromptReference,
  QueryResult,
  ResponseFormat,
  RuntimeContext,
  SandboxConfig,
  SandboxFilesystemConfig,
  SandboxNetworkConfig,
  SdkMessage,
  StepDefinition,
  StepFlowResult,
  StepFlowState,
  StepHistoryEntry,
  StepMachineCompletionConfig,
  StepsRegistry,
  StructuredSignalCompletionConfig,
  TransitionDefinition,
  ValidationResult,
  WorktreeConfig,
} from "./src_common/types.ts";

// Contracts - export all types
export type {
  AgentResultV2,
  CheckContext,
  CompletionContract,
  CompletionResult,
  ConfigurationContract,
  ConnectionContract,
  ContractError,
  ContractErrorCategory,
  ExecutionContract,
  InputSpec,
  QueryOptions as ContractQueryOptions,
  StartOptions,
  StepContext,
  StepResult,
  Variables,
} from "./src_common/contracts.ts";

// Common utilities
export { deepMerge, deepMergeAll } from "./src_common/deep-merge.ts";
export {
  type LogEntry,
  Logger,
  type LoggerOptions,
} from "./src_common/logger.ts";
export {
  getDefaults,
  loadRuntimeConfig,
  mergeConfigurations,
  resolveAgentPaths,
  type RuntimeConfig,
} from "./src_common/config.ts";

// === Runner v2 exports (explicit to avoid conflicts) ===

// Configuration Layer
export {
  applyDefaults,
  ConfigurationLoadError,
  ConfigurationService,
  getAgentDir,
  loadConfiguration,
  validate,
} from "./config/mod.ts";

// Lifecycle Layer
export {
  AgentLifecycle,
  AgentStateMachine,
  InvalidTransitionError,
} from "./lifecycle/mod.ts";
export type {
  AgentStatus,
  LifecycleAction,
  LifecycleContext,
  LifecycleOptions,
} from "./lifecycle/mod.ts";

// Loop Layer
export { AgentLoop, IterationExecutor, StepContextImpl } from "./loop/mod.ts";
export type {
  IterationOptions,
  IterationResult,
  LoopContext,
  LoopResult,
} from "./loop/mod.ts";

// SDK Bridge Layer - explicit to avoid SdkMessage/QueryOptions conflicts
export {
  ClaudeSdkBridge,
  mergeSandboxConfig,
  MessageProcessor,
  toSdkSandboxConfig,
} from "./bridge/mod.ts";
export type {
  ProcessedMessage,
  QueryOptions,
  SdkBridge,
} from "./bridge/mod.ts";
// Note: SdkMessage is exported from src_common/types.ts above

// Completion Layer (v2)
export {
  createCompletionHandlerV2,
  GitHubStateChecker,
  IssueCompletionHandlerV2,
  MockStateChecker,
} from "./completion/mod.ts";
export type {
  CompletionHandlerV2,
  ExternalStateChecker,
  IssueState,
} from "./completion/mod.ts";

// Prompt Layer (v2)
export {
  ClimptAdapter,
  FilePromptAdapter,
  PromptResolverV2,
  substituteVariables,
} from "./prompts/mod.ts";
export type {
  PromptAdapter,
  PromptReferenceV2,
  ResolverOptions,
} from "./prompts/mod.ts";

// Errors
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
} from "./runner/errors.ts";

// Legacy runner exports
export { AgentRunner, type RunnerOptions } from "./runner/runner.ts";
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
} from "./runner/builder.ts";
export {
  agentExists,
  listAgents,
  loadAgentDefinition,
  validateAgentDefinition,
} from "./runner/loader.ts";
export {
  type AgentEvent,
  AgentEventEmitter,
  type AgentEventHandler,
  type AgentEventPayloads,
} from "./runner/events.ts";
export {
  generateAgentHelp,
  parseCliArgs,
  type ParsedCliArgs,
} from "./runner/cli.ts";

// === Completion (v1 - backward compatibility) ===
export {
  BaseCompletionHandler,
  CheckBudgetCompletionHandler,
  type CompletionCriteria,
  type CompletionHandler,
  type CompletionHandlerOptions,
  type CompletionHandlerV2Options,
  CompositeCompletionHandler,
  type CompositeCondition,
  type CompositeOperator,
  createCompletionHandler,
  createCompletionHandlerFromOptions,
  formatIterationSummary,
  getRegisteredHandler,
  type IssueCompletionConfigV2,
  IssueCompletionHandler,
  IterateCompletionHandler,
  ManualCompletionHandler,
  type ProjectContext,
  registerCompletionHandler,
  StructuredSignalCompletionHandler,
} from "./completion/mod.ts";

// === Prompts (v1 - backward compatibility) ===
export {
  checkVariables,
  type ClimptReference,
  DefaultFallbackProvider,
  extractVariableNames,
  type FallbackPromptProvider,
  FallbackResolver,
  PromptNotFoundError,
  PromptResolver,
  type PromptResolverOptions,
  type PromptStepDefinition,
  type StepRegistry,
  toClimptPath,
} from "./prompts/mod.ts";

// Actions
export * from "./actions/mod.ts";

// Init
export { initAgent } from "./init.ts";

// CLI
export { run } from "./cli.ts";
