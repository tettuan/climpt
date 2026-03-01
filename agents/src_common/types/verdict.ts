/**
 * Verdict type definitions for climpt-agents
 */

/**
 * Verdict types based on HOW completion is determined,
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
export type VerdictType =
  | "externalState"
  | "iterationBudget"
  | "checkBudget"
  | "keywordSignal"
  | "structuredSignal"
  | "stepMachine"
  | "composite"
  | "custom";

/**
 * All valid verdict types
 */
export const ALL_VERDICT_TYPES: readonly VerdictType[] = [
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
 * Verdict configuration - uses optional properties for flexibility
 */
export interface VerdictConfigUnion {
  /** For iterationBudget/iterate completion type */
  maxIterations?: number;
  /** For keywordSignal/manual completion type */
  verdictKeyword?: string;
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
    type: VerdictType;
    config: VerdictConfigUnion;
  }>;
  /** For structuredSignal completion type */
  signalType?: string;
  requiredFields?: Record<string, unknown>;
  /** For stepMachine completion type */
  registryPath?: string;
  entryStep?: string;
}

// Verdict config types
export type ExternalStateVerdictConfig = VerdictConfigUnion & {
  resourceType: "github-issue" | "github-project" | "file" | "api";
  targetState: string | Record<string, unknown>;
};
export type IterationBudgetVerdictConfig = VerdictConfigUnion & {
  maxIterations: number;
};
export type CheckBudgetVerdictConfig = VerdictConfigUnion & {
  maxChecks: number;
};
export type KeywordSignalVerdictConfig = VerdictConfigUnion & {
  verdictKeyword: string;
};
export type StructuredSignalVerdictConfig = VerdictConfigUnion & {
  signalType: string;
  requiredFields?: Record<string, unknown>;
};
export type PhaseVerdictConfig = VerdictConfigUnion & {
  terminalPhases: string[];
};
export type StepMachineVerdictConfig = VerdictConfigUnion & {
  registryPath: string;
  entryStep?: string;
};
export type CompositeVerdictConfig = VerdictConfigUnion & {
  operator: "and" | "or" | "first";
  conditions: Array<{
    type: VerdictType;
    config: VerdictConfigUnion;
  }>;
};
export type CustomVerdictConfig = VerdictConfigUnion & {
  handlerPath: string;
};
