/**
 * Agents Module - Top-level Entry Point
 *
 * @module
 *
 * This module provides the agent framework for autonomous task execution,
 * including the AgentRunner, verdict handlers, and type definitions.
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
 * - **VerdictHandlers**: Various verdict strategies (issue, iterationBudget, keywordSignal)
 * - **Types**: AgentDefinition, AgentResult, VerdictType, etc.
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
  CheckBudgetVerdictConfig,
  CheckDefinition,
  CheckResponse,
  CompositeVerdictConfig,
  CustomVariableDefinition,
  CustomVerdictConfig,
  ExternalStateVerdictConfig,
  FinalizeConfig,
  FlowStepDefinition,
  GitHubConfig,
  IterationBudgetVerdictConfig,
  IterationConfig,
  IterationSummary,
  KeywordSignalVerdictConfig,
  LoggingConfig,
  ParameterDefinition,
  ParameterValidation,
  PermissionMode,
  PhaseVerdictConfig,
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
  StepMachineVerdictConfig,
  StepsRegistry,
  StructuredSignalVerdictConfig,
  TransitionDefinition,
  ValidationResult,
  VerdictConfigUnion,
  VerdictType,
  WorktreeConfig,
} from "./src_common/types.ts";

// Type utilities from src_common
export {
  ALL_VERDICT_TYPES,
  INITIAL_AGENT_STATE,
  RuntimeContextNotInitializedError,
} from "./src_common/types.ts";

// === Verdict ===
export {
  BaseVerdictHandler,
  createRegistryVerdictHandler,
  IssueVerdictHandler,
  IterationBudgetVerdictHandler,
  KeywordSignalVerdictHandler,
  type VerdictCriteria,
  type VerdictHandler,
} from "./verdict/mod.ts";

// === Init and Runtime ===
export { initAgent } from "./init.ts";
export { run } from "./cli.ts";

// To run agents, use the unified runner:
//   deno run -A agents/scripts/run-agent.ts --agent iterator --issue 123
//   deno run -A agents/scripts/run-agent.ts --agent reviewer --project 5
