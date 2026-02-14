/**
 * Completion type definitions for climpt-agents
 */

/**
 * Completion types based on HOW completion is determined,
 * not WHO uses the completion handler.
 *
 * Behavior-based naming convention:
 * - externalState: Complete when external resource reaches target state
 * - iterationBudget: Complete after N iterations
 * - checkBudget: Complete after N status checks (monitoring scenarios)
 * - keywordSignal: Complete when LLM outputs specific keyword
 * - structuredSignal: Complete when LLM outputs specific JSON signal
 * - stepMachine: Complete when step state machine reaches terminal
 * - composite: Combines multiple conditions with AND/OR logic
 * - custom: Fully custom handler implementation
 */
export type CompletionType =
  | "externalState"
  | "iterationBudget"
  | "checkBudget"
  | "keywordSignal"
  | "structuredSignal"
  | "stepMachine"
  | "composite"
  | "custom";

/**
 * All valid completion types
 */
export const ALL_COMPLETION_TYPES: readonly CompletionType[] = [
  "externalState",
  "iterationBudget",
  "checkBudget",
  "keywordSignal",
  "structuredSignal",
  "stepMachine",
  "composite",
  "custom",
] as const;

/**
 * Completion configuration - uses optional properties for flexibility
 */
export interface CompletionConfigUnion {
  /** For iterationBudget/iterate completion type */
  maxIterations?: number;
  /** For keywordSignal/manual completion type */
  completionKeyword?: string;
  /** For custom completion type */
  handlerPath?: string;
  /** For checkBudget completion type */
  maxChecks?: number;
  /** For externalState completion type */
  resourceType?: "github-issue" | "github-project" | "file" | "api";
  targetState?: string | Record<string, unknown>;
  /** For composite completion type */
  operator?: "and" | "or" | "first";
  conditions?: Array<{
    type: CompletionType;
    config: CompletionConfigUnion;
  }>;
  /** For structuredSignal completion type */
  signalType?: string;
  requiredFields?: Record<string, unknown>;
  /** For stepMachine completion type */
  registryPath?: string;
  entryStep?: string;
}

// Completion config types
export type ExternalStateCompletionConfig = CompletionConfigUnion & {
  resourceType: "github-issue" | "github-project" | "file" | "api";
  targetState: string | Record<string, unknown>;
};
export type IterationBudgetCompletionConfig = CompletionConfigUnion & {
  maxIterations: number;
};
export type CheckBudgetCompletionConfig = CompletionConfigUnion & {
  maxChecks: number;
};
export type KeywordSignalCompletionConfig = CompletionConfigUnion & {
  completionKeyword: string;
};
export type StructuredSignalCompletionConfig = CompletionConfigUnion & {
  signalType: string;
  requiredFields?: Record<string, unknown>;
};
export type PhaseCompletionConfig = CompletionConfigUnion & {
  terminalPhases: string[];
};
export type StepMachineCompletionConfig = CompletionConfigUnion & {
  registryPath: string;
  entryStep?: string;
};
export type CompositeCompletionConfig = CompletionConfigUnion & {
  operator: "and" | "or" | "first";
  conditions: Array<{
    type: CompletionType;
    config: CompletionConfigUnion;
  }>;
};
export type CustomCompletionConfig = CompletionConfigUnion & {
  handlerPath: string;
};
