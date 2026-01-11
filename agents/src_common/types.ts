/**
 * Core type definitions for climpt-agents
 */

// ============================================================================
// Agent Definition Types
// ============================================================================

export interface AgentDefinition {
  $schema?: string;
  version: string;

  name: string;
  displayName: string;
  description: string;

  behavior: AgentBehavior;
  parameters: Record<string, ParameterDefinition>;
  prompts: PromptConfig;
  actions?: ActionConfig;
  github?: GitHubConfig;
  worktree?: WorktreeConfig;
  logging: LoggingConfig;
}

export interface AgentBehavior {
  systemPromptPath: string;
  completionType: CompletionType;
  completionConfig: CompletionConfigUnion;
  allowedTools: string[];
  permissionMode: PermissionMode;
  /** Fine-grained sandbox configuration (uses defaults if not specified) */
  sandboxConfig?: SandboxConfig;
  /** Pre-close validation configuration for issue-action close */
  preCloseValidation?: PreCloseValidationConfig;
}

/**
 * Pre-close validation configuration
 */
export interface PreCloseValidationConfig {
  /** Whether pre-close validation is enabled */
  enabled: boolean;
  /** List of validator IDs to run before close */
  validators: string[];
  /** Action on validation failure: 'block' prevents close, 'warn' only logs */
  onFailure?: "block" | "warn";
}

/**
 * Sandbox configuration for controlled network and filesystem access
 */
export interface SandboxConfig {
  /** Enable sandbox mode (default: true) */
  enabled?: boolean;
  /** Network access configuration */
  network?: SandboxNetworkConfig;
  /** Filesystem access configuration */
  filesystem?: SandboxFilesystemConfig;
}

export interface SandboxNetworkConfig {
  /** Network access mode */
  mode?: "trusted" | "none" | "custom";
  /** List of allowed domains (supports wildcards like *.github.com) */
  trustedDomains?: string[];
}

export interface SandboxFilesystemConfig {
  /** Additional paths to allow write access */
  allowedPaths?: string[];
}

/**
 * Completion types based on HOW completion is determined,
 * not WHO uses the completion handler.
 *
 * New behavior-based naming convention:
 * - externalState: Complete when external resource reaches target state (was: issue)
 * - iterationBudget: Complete after N iterations (was: iterate)
 * - checkBudget: Complete after N status checks (monitoring scenarios)
 * - keywordSignal: Complete when LLM outputs specific keyword (was: manual)
 * - structuredSignal: Complete when LLM outputs specific JSON signal
 * - stepMachine: Complete when step state machine reaches terminal (was: stepFlow)
 * - composite: Combines multiple conditions with AND/OR logic (was: facilitator)
 * - custom: Fully custom handler implementation
 */
export type CompletionType =
  // New behavior-based names
  | "externalState"
  | "iterationBudget"
  | "checkBudget"
  | "keywordSignal"
  | "structuredSignal"
  | "stepMachine"
  | "composite"
  | "custom"
  // Legacy aliases (deprecated, use behavior-based names instead)
  | "issue" // -> externalState
  | "iterate" // -> iterationBudget
  | "manual" // -> keywordSignal
  | "stepFlow" // -> stepMachine
  | "facilitator"; // -> composite

/**
 * Type alias mapping from old names to new names
 */
export const COMPLETION_TYPE_ALIASES: Record<string, CompletionType> = {
  // Old -> New mapping
  issue: "externalState",
  iterate: "iterationBudget",
  manual: "keywordSignal",
  stepFlow: "stepMachine",
  facilitator: "composite",
};

/**
 * Resolve a completion type to its canonical (new) name
 */
export function resolveCompletionType(type: CompletionType): CompletionType {
  return COMPLETION_TYPE_ALIASES[type] ?? type;
}

/**
 * Check if a completion type is a legacy/deprecated name
 */
export function isLegacyCompletionType(type: CompletionType): boolean {
  return type in COMPLETION_TYPE_ALIASES;
}

/**
 * All valid completion types (both new and legacy)
 */
export const ALL_COMPLETION_TYPES: readonly CompletionType[] = [
  // New behavior-based names
  "externalState",
  "iterationBudget",
  "checkBudget",
  "keywordSignal",
  "structuredSignal",
  "stepMachine",
  "composite",
  "custom",
  // Legacy aliases
  "issue",
  "iterate",
  "manual",
  "stepFlow",
  "facilitator",
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

// Type aliases for documentation purposes (updated with new names)
/** @deprecated Use ExternalStateCompletionConfig instead */
export type IssueCompletionConfig = CompletionConfigUnion;
/** @deprecated Use PhaseCompletionConfig instead */
export type ProjectCompletionConfig = CompletionConfigUnion;
/** @deprecated Use IterationBudgetCompletionConfig instead */
export type IterateCompletionConfig = CompletionConfigUnion & {
  maxIterations: number;
};
/** @deprecated Use KeywordSignalCompletionConfig instead */
export type ManualCompletionConfig = CompletionConfigUnion & {
  completionKeyword: string;
};
export type CustomCompletionConfig = CompletionConfigUnion & {
  handlerPath: string;
};

// New behavior-based config types
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

export type PermissionMode = "plan" | "acceptEdits" | "bypassPermissions";

// ============================================================================
// Parameter Types
// ============================================================================

export interface ParameterDefinition {
  type: "string" | "number" | "boolean" | "array";
  description: string;
  required: boolean;
  default?: unknown;
  cli: string;
  validation?: ParameterValidation;
}

export interface ParameterValidation {
  min?: number;
  max?: number;
  pattern?: string;
  enum?: string[];
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface PromptConfig {
  registry: string;
  fallbackDir: string;
}

export interface ActionConfig {
  enabled: boolean;
  types: string[];
  outputFormat: string;
  handlers?: Record<string, string>;
}

export interface GitHubConfig {
  enabled: boolean;
  labels?: Record<string, string>;
}

export interface WorktreeConfig {
  enabled: boolean;
  root?: string;
}

export interface LoggingConfig {
  directory: string;
  format: "jsonl" | "text";
  maxFiles?: number;
}

// ============================================================================
// Runtime Types
// ============================================================================

/**
 * Result of agent execution.
 *
 * v2 Design Compliance:
 * - `iterations` (v2 name) replaces `totalIterations` (deprecated)
 * - `reason` (v2 name) replaces `completionReason` (deprecated)
 *
 * Invariants (from design):
 * - success=true  => reason is completion reason
 * - success=false => reason is error content
 */
export interface AgentResult {
  /** Whether agent completed successfully */
  success: boolean;

  /**
   * Total number of iterations executed.
   * @v2
   */
  iterations: number;

  /**
   * Completion reason (success) or error content (failure).
   * @v2
   */
  reason: string;

  /**
   * @deprecated Use `iterations` instead. Will be removed in next major version.
   */
  totalIterations: number;

  /**
   * @deprecated Use `reason` instead. Will be removed in next major version.
   */
  completionReason: string;

  /** Detailed iteration summaries */
  summaries: IterationSummary[];

  /** Error message (for backward compatibility) */
  error?: string;
}

/**
 * Detailed result information separated from core result.
 * Use this when you need full execution details beyond the core AgentResult.
 */
export interface AgentResultDetail extends AgentResult {
  /** Session ID if available */
  sessionId?: string;
  /** Stack trace or additional error info */
  errorDetails?: string;
}

export interface IterationSummary {
  iteration: number;
  sessionId?: string;
  assistantResponses: string[];
  toolsUsed: string[];
  detectedActions: DetectedAction[];
  actionResults?: ActionResult[];
  errors: string[];
}

export interface DetectedAction {
  type: string;
  content: string;
  metadata: Record<string, unknown>;
  raw: string;
}

export interface CompletionSignal {
  type: "phase-advance" | "complete";
  data?: unknown;
}

export interface ActionResult {
  action: DetectedAction;
  success: boolean;
  result?: unknown;
  error?: string;
  completionSignal?: CompletionSignal;
}

// ============================================================================
// LLM Query Types (v2)
// ============================================================================

/**
 * Result from LLM query.
 * Represents the outcome of a single LLM interaction.
 */
export interface QueryResult {
  /** Session ID (for continuing conversation) */
  sessionId: string;
  /** Response text content */
  content: string;
  /** Tools that were used */
  toolsUsed: string[];
  /** Whether query completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * SDK message from streaming query.
 * Represents individual messages from the Claude SDK stream.
 */
export interface SdkMessage {
  /** Message type */
  type: string;
  /** Message content */
  content?: unknown;
  /** Tool use information */
  toolUse?: {
    name: string;
    input: unknown;
    result?: unknown;
  };
}

// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

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
  steps: Record<string, StepDefinition>;
  editions?: Record<string, string>;
  /**
   * Mode-based entry step mapping.
   * Allows dynamic entry step selection based on execution mode.
   * Example: { "issue": "s_init_issue", "project": "s_init_project", "iterate": "s_init_iterate" }
   */
  entryStepMapping?: Record<string, string>;
}

/**
 * Individual step definition
 */
export interface StepDefinition {
  id: string;
  name: string;
  description?: string;
  prompt: PromptReference;
  iterations?: IterationConfig;
  check?: CheckDefinition;
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
 */
export interface CheckDefinition {
  prompt: PromptReference;
  responseFormat: ResponseFormat;
  onPass: TransitionDefinition;
  onFail: TransitionDefinition;
}

/**
 * Expected response format from check prompt
 */
export interface ResponseFormat {
  result: "ok|ng" | "pass|fail" | "boolean";
  message?: "string" | "optional";
  [key: string]: string | undefined;
}

/**
 * Transition definition after check
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

// ============================================================================
// Agent Runner State Types
// ============================================================================

/**
 * Agent execution state - tracks the lifecycle of an agent run.
 * Replaces non-null assertion pattern with explicit state tracking.
 */
export interface AgentState {
  readonly status:
    | "created"
    | "initializing"
    | "running"
    | "completed"
    | "failed";
  readonly iteration: number;
  readonly sessionId: string | null;
  readonly summaries: readonly IterationSummary[];
  readonly cwd: string;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
}

/**
 * Initial state for a newly created agent
 */
export const INITIAL_AGENT_STATE: AgentState = {
  status: "created",
  iteration: 0,
  sessionId: null,
  summaries: [],
  cwd: "",
  startedAt: null,
  completedAt: null,
};

// Forward declarations for RuntimeContext dependencies
// These are imported from other modules, but we need the interface here
import type { CompletionHandler } from "../completion/mod.ts";
import type { PromptResolver } from "../prompts/resolver.ts";
import type { ActionDetector } from "../actions/detector.ts";
import type { ActionExecutor } from "../actions/executor.ts";
import type { Logger } from "./logger.ts";

/**
 * Runtime context containing initialized dependencies.
 * This pattern replaces non-null assertions by ensuring all dependencies
 * are available only after successful initialization.
 */
export interface RuntimeContext {
  readonly completionHandler: CompletionHandler;
  readonly promptResolver: PromptResolver;
  readonly actionDetector?: ActionDetector;
  readonly actionExecutor?: ActionExecutor;
  readonly logger: Logger;
  readonly cwd: string;
}

/**
 * Error thrown when attempting to access runtime context before initialization
 *
 * @deprecated Use AgentNotInitializedError from agents/runner/errors.ts instead.
 * This class is kept for backward compatibility but will be removed in a future version.
 */
export class RuntimeContextNotInitializedError extends Error {
  constructor() {
    super(
      "Agent runtime context is not initialized. Call initialize() before accessing runtime dependencies.",
    );
    this.name = "RuntimeContextNotInitializedError";
  }
}
