/**
 * Step flow type definitions for climpt-agents
 */

// ============================================================================
// Step Flow Types (v2.0)
// ============================================================================

/**
 * Steps registry definition for step-based execution flow
 */
export interface StepsRegistry {
  $schema?: string;
  version: string;
  basePath: string;
  entryStep: string;
  steps: Record<string, FlowStepDefinition>;
  editions?: Record<string, string>;
  /**
   * Mode-based entry step mapping.
   * Allows dynamic entry step selection based on execution mode.
   * Example: { "issue": "s_init_issue", "project": "s_init_project", "iterate": "s_init_iterate" }
   */
  entryStepMapping?: Record<string, string>;
}

/**
 * Step definition for step flow execution control.
 *
 * NOTE: This is different from PromptStepDefinition in common/step-registry.ts.
 * - FlowStepDefinition (here): Step flow execution and state machine control
 * - PromptStepDefinition (common): C3L-based prompt file resolution
 */
export interface FlowStepDefinition {
  id: string;
  name: string;
  description?: string;
  prompt: PromptReference;
  iterations?: IterationConfig;
  /** User variables (uv-xxx) used in the prompt */
  variables?: string[];
  /**
   * Custom variables injected at runtime from external sources.
   * These are different from user variables - they come from code, stdin, or API calls.
   */
  customVariables?: CustomVariableDefinition[];
  /** Whether this step accepts stdin input */
  usesStdin?: boolean;
}

/**
 * @deprecated Use FlowStepDefinition instead. Kept for backward compatibility.
 */
export type StepDefinition = FlowStepDefinition;

/**
 * Definition for a custom variable injected at runtime
 */
export interface CustomVariableDefinition {
  /** Variable name (without braces) */
  name: string;
  /** Source of the variable value */
  source: "stdin" | "github" | "computed" | "parameter" | "context";
  /** Human-readable description */
  description?: string;
  /** Whether the variable is required */
  required?: boolean;
}

/**
 * Reference to a prompt file (path or C3L)
 */
export type PromptReference = PromptPathReference | PromptC3LReference;

export interface PromptPathReference {
  path: string;
  /** Fallback path if primary prompt not found */
  fallback?: string;
}

export interface PromptC3LReference {
  c1: string;
  c2: string;
  c3: string;
  edition?: string;
  /**
   * Adaptation variant within an edition.
   * Allows for variations like: f_preparation.md vs f_preparation_empty.md
   * Path pattern: {c1}/{c2}/{c3}/f_{edition}_{adaptation}.md
   */
  adaptation?: string;
  /** Fallback C3L reference or path if primary prompt not found */
  fallback?: string;
}

/**
 * Iteration configuration for a step
 */
export interface IterationConfig {
  min?: number;
  max?: number;
}

/**
 * Check definition for step completion
 *
 * @deprecated Use structuredGate/transitions in PromptStepDefinition instead.
 * See agents/common/step-registry.ts for the new approach.
 */
export interface CheckDefinition {
  prompt: PromptReference;
  responseFormat: ResponseFormat;
  onPass: TransitionDefinition;
  onFail: TransitionDefinition;
}

/**
 * Expected response format from check prompt
 *
 * @deprecated Use ResponseFormat from agents/common/completion-types.ts instead.
 * This legacy format is not used in the current step flow implementation.
 */
export interface ResponseFormat {
  result: "ok|ng" | "pass|fail" | "boolean";
  message?: "string" | "optional";
  [key: string]: string | undefined;
}

/**
 * Transition definition after check
 *
 * @deprecated Use TransitionRule from agents/common/step-registry.ts instead.
 * The new approach uses structuredGate.intentField to extract intent and
 * transitions config to map intent to next step.
 */
export interface TransitionDefinition {
  next?: string;
  fallback?: string;
  retry?: boolean;
  maxRetries?: number;
  complete?: boolean;
}

/**
 * Check response from LLM
 *
 * @deprecated Use GateInterpretation from step-gate-interpreter.ts instead.
 * The new approach extracts intent from structured output via StepGateInterpreter.
 */
export interface CheckResponse {
  result: "ok" | "ng" | "pass" | "fail" | boolean;
  message?: string;
  [key: string]: unknown;
}

// ============================================================================
// Step Flow Runtime Types
// ============================================================================

/**
 * Current state of step flow execution
 */
export interface StepFlowState {
  currentStepId: string;
  stepIteration: number;
  totalIterations: number;
  retryCount: number;
  history: StepHistoryEntry[];
}

/**
 * History entry for step execution
 */
export interface StepHistoryEntry {
  stepId: string;
  iteration: number;
  checkResult?: CheckResponse;
  transition: "next" | "fallback" | "retry" | "complete";
  timestamp: Date;
}

/**
 * Result of step flow execution
 */
export interface StepFlowResult {
  success: boolean;
  finalStepId: string;
  state: StepFlowState;
  completionReason: string;
  error?: string;
}
