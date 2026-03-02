/**
 * Verdict type definitions for climpt-agents
 */

/**
 * Verdict types based on HOW completion is determined,
 * not WHO uses the completion handler.
 *
 * Category:variant naming convention:
 * - poll:state: Complete when external resource reaches target state
 * - count:iteration: Complete after N iterations
 * - count:check: Complete after N status checks (monitoring scenarios)
 * - detect:keyword: Complete when LLM outputs specific keyword
 * - detect:structured: Complete when LLM outputs specific JSON signal
 * - detect:graph: Complete when step state machine reaches terminal
 * - meta:composite: Combines multiple conditions with AND/OR logic
 * - meta:custom: Fully custom handler implementation
 */
export type VerdictType =
  | "poll:state"
  | "count:iteration"
  | "count:check"
  | "detect:keyword"
  | "detect:structured"
  | "detect:graph"
  | "meta:composite"
  | "meta:custom";

/**
 * All valid verdict types
 */
export const ALL_VERDICT_TYPES: readonly VerdictType[] = [
  "poll:state",
  "count:iteration",
  "count:check",
  "detect:keyword",
  "detect:structured",
  "detect:graph",
  "meta:composite",
  "meta:custom",
] as const;

/**
 * Verdict configuration - uses optional properties for flexibility
 */
export interface VerdictConfigUnion {
  /** For count:iteration verdict type */
  maxIterations?: number;
  /** For detect:keyword verdict type */
  verdictKeyword?: string;
  /** For meta:custom verdict type */
  handlerPath?: string;
  /** For count:check verdict type */
  maxChecks?: number;
  /** For poll:state verdict type */
  resourceType?: "github-issue" | "github-project" | "file" | "api";
  targetState?: string | Record<string, unknown>;
  /** For meta:composite verdict type */
  operator?: "and" | "or" | "first";
  conditions?: Array<{
    type: VerdictType;
    config: VerdictConfigUnion;
  }>;
  /** For detect:structured verdict type */
  signalType?: string;
  requiredFields?: Record<string, unknown>;
  /** For detect:graph verdict type */
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
