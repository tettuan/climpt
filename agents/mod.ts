/**
 * Agents Module - Top-level Entry Point
 *
 * Usage Example:
 * ```typescript
 * import { AgentRunner, loadAgentDefinition } from "./agents/mod.ts";
 *
 * const definition = await loadAgentDefinition("my-agent", ".");
 * const runner = new AgentRunner(definition);
 * await runner.initialize({ cwd: ".", args: {} });
 * const result = await runner.run();
 * ```
 */

// === V2 Architecture (Recommended) ===
// Main v2 exports from runner/mod.ts
export * from "./runner/mod.ts";

// Common types
export * from "./common/mod.ts";

// Types from src_common
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
  FlowStepDefinition,
  GitHubConfig,
  IterationBudgetCompletionConfig,
  IterationConfig,
  IterationSummary,
  KeywordSignalCompletionConfig,
  LoggingConfig,
  ParameterDefinition,
  ParameterValidation,
  PermissionMode,
  PhaseCompletionConfig,
  PromptC3LReference,
  PromptConfig,
  PromptPathReference,
  PromptReference,
  ResponseFormat,
  RuntimeContext,
  SandboxConfig,
  SandboxFilesystemConfig,
  SandboxNetworkConfig,
  StepDefinition, // @deprecated: use FlowStepDefinition
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

// Type utilities from src_common
export {
  ALL_COMPLETION_TYPES,
  COMPLETION_TYPE_ALIASES,
  INITIAL_AGENT_STATE,
  isLegacyCompletionType,
  resolveCompletionType,
  RuntimeContextNotInitializedError,
} from "./src_common/types.ts";

// === Actions ===
export {
  type ActionContext,
  ActionDetector,
  ActionExecutor,
  type ActionHandler,
  BaseActionHandler,
  type ExecutorOptions,
  FileActionHandler,
  GitHubCommentHandler,
  type GitHubContext,
  GitHubIssueHandler,
  LogActionHandler,
} from "./src_mod.ts";

// === Completion (V1 - backward compatibility) ===
export {
  BaseCompletionHandler,
  type CompletionCriteria,
  type CompletionHandler,
  type CompletionHandlerOptions,
  createCompletionHandler,
  createCompletionHandlerFromOptions,
  getRegisteredHandler,
  IssueCompletionHandler,
  IterateCompletionHandler,
  ManualCompletionHandler,
  registerCompletionHandler,
} from "./src_mod.ts";

// === Init and Runtime ===
export { initAgent, run } from "./src_mod.ts";

// To run agents, use the unified runner:
//   deno run -A agents/scripts/run-agent.ts --agent iterator --issue 123
//   deno run -A agents/scripts/run-agent.ts --agent reviewer --project 5
