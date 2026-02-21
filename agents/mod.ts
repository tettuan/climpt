/**
 * Agents Module - Top-level Entry Point
 *
 * @module
 *
 * This module provides the agent framework for autonomous task execution,
 * including the AgentRunner, completion handlers, and type definitions.
 *
 * ## Usage Example
 *
 * ```typescript
 * import { AgentRunner, loadAgentDefinition } from "jsr:@aidevtool/climpt/agents";
 *
 * const definition = await loadAgentDefinition("my-agent", ".");
 * const runner = new AgentRunner(definition);
 * const result = await runner.run({ cwd: ".", args: {} });
 * ```
 *
 * ## Key Exports
 *
 * - **AgentRunner**: Main class for running agents
 * - **loadAgentDefinition**: Load agent configuration from .agent directory
 * - **CompletionHandlers**: Various completion strategies (issue, iterate, manual)
 * - **Types**: AgentDefinition, AgentResult, CompletionType, etc.
 */

// === Architecture ===
// Main exports from runner/mod.ts
export * from "./runner/mod.ts";

// Common types
export * from "./common/mod.ts";

// Types from src_common
export type {
  AgentDefinition,
  AgentResult,
  AgentResultDetail,
  AgentState,
  CheckBudgetCompletionConfig,
  CheckDefinition,
  CheckResponse,
  CompletionConfigUnion,
  CompletionType,
  CompositeCompletionConfig,
  CustomCompletionConfig,
  CustomVariableDefinition,
  ExternalStateCompletionConfig,
  FinalizeConfig,
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
  PromptPathReference,
  PromptReference,
  ResponseFormat,
  RuntimeContext,
  SandboxConfig,
  SandboxFilesystemConfig,
  SandboxNetworkConfig,
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

// Type utilities from src_common
export {
  ALL_COMPLETION_TYPES,
  INITIAL_AGENT_STATE,
  RuntimeContextNotInitializedError,
} from "./src_common/types.ts";

// === Completion ===
export {
  BaseCompletionHandler,
  type CompletionCriteria,
  type CompletionHandler,
  createRegistryCompletionHandler,
  IssueCompletionHandler,
  IterateCompletionHandler,
  ManualCompletionHandler,
} from "./completion/mod.ts";

// === Init and Runtime ===
export { initAgent } from "./init.ts";
export { run } from "./cli.ts";

// To run agents, use the unified runner:
//   deno run -A agents/scripts/run-agent.ts --agent iterator --issue 123
//   deno run -A agents/scripts/run-agent.ts --agent reviewer --project 5
