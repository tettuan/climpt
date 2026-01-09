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

export type CompletionType =
  | "issue"
  | "project"
  | "iterate"
  | "manual"
  | "custom"
  | "stepFlow"
  | "facilitator";

/**
 * Completion configuration - uses optional properties for flexibility
 */
export interface CompletionConfigUnion {
  /** For iterate completion type */
  maxIterations?: number;
  /** For manual completion type */
  completionKeyword?: string;
  /** For custom completion type */
  handlerPath?: string;
}

// Type aliases for documentation purposes
export type IssueCompletionConfig = CompletionConfigUnion;
export type ProjectCompletionConfig = CompletionConfigUnion;
export type IterateCompletionConfig = CompletionConfigUnion & {
  maxIterations: number;
};
export type ManualCompletionConfig = CompletionConfigUnion & {
  completionKeyword: string;
};
export type CustomCompletionConfig = CompletionConfigUnion & {
  handlerPath: string;
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

export interface AgentResult {
  success: boolean;
  totalIterations: number;
  summaries: IterationSummary[];
  completionReason: string;
  error?: string;
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

export interface ActionResult {
  action: DetectedAction;
  success: boolean;
  result?: unknown;
  error?: string;
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
