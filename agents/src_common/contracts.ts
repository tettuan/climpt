/**
 * Design Contracts for Agent System (v2)
 *
 * Based on: agents/docs/12_contracts.md
 *
 * These interfaces define the boundaries and guarantees between components.
 * Following these contracts ensures internal implementations can change freely.
 */

import type {
  AgentDefinition,
  PromptReference,
  QueryResult,
  SdkMessage,
  ValidationResult,
} from "./types.ts";

// Re-export types that are part of the contract API
export type { QueryResult, SdkMessage };

// ============================================================================
// Configuration Contract
// ============================================================================

/**
 * Contract for loading and validating agent configurations.
 *
 * Responsibilities:
 * - Load agent definition from filesystem
 * - Validate definition structure and semantics
 *
 * Guarantees:
 * - Configuration is complete before execution starts
 * - Invalid configuration prevents startup
 * - Configuration is immutable during execution
 */
export interface ConfigurationContract {
  /**
   * Load agent definition from a directory path.
   *
   * @param path - Existing directory path containing agent configuration
   * @returns Parsed agent definition
   * @throws NotFound - Path does not exist
   * @throws ParseError - Configuration cannot be parsed
   */
  load(path: string): Promise<AgentDefinition>;

  /**
   * Validate an agent definition.
   *
   * @param definition - Output from load()
   * @returns Validation result with valid=true IFF errors=[]
   */
  validate(definition: AgentDefinition): ValidationResult;
}

// ============================================================================
// Execution Contract
// ============================================================================

/**
 * Options for starting agent execution.
 */
export interface StartOptions {
  /** Working directory for agent execution */
  cwd: string;
  /** Arguments passed to the agent */
  args: Record<string, unknown>;
  /** Optional plugin paths to load */
  plugins?: string[];
}

/**
 * Result of agent execution (v2 design compliant).
 *
 * Invariants:
 * - success=true  => reason is completion reason
 * - success=false => reason is error content
 */
export interface AgentResultV2 {
  /** Whether agent completed successfully */
  success: boolean;
  /** Completion reason (success) or error content (failure) */
  reason: string;
  /** Total number of iterations executed */
  iterations: number;
}

// Note: AgentResultDetail is defined in types.ts and extends AgentResult
// with sessionId and errorDetails fields.

/**
 * Contract for agent execution lifecycle.
 *
 * State transitions:
 * - created -> ready (via start)
 * - ready -> running (via run)
 * - running -> completed (via run completion or stop)
 *
 * Guarantees:
 * - run() always returns a result (never throws)
 * - stop() is idempotent (safe to call multiple times)
 */
export interface ExecutionContract {
  /**
   * Initialize agent for execution.
   *
   * @param options - Execution options
   * @throws AlreadyStarted - Agent already initialized
   */
  start(options: StartOptions): Promise<void>;

  /**
   * Execute the agent loop.
   *
   * Precondition: start() has been called
   * Guarantee: Always returns result (no exceptions escape)
   *
   * @returns Execution result
   */
  run(): Promise<AgentResultV2>;

  /**
   * Stop agent execution and release resources.
   *
   * Guarantee: Idempotent (safe to call multiple times)
   *
   * @returns Final result
   */
  stop(): Promise<AgentResultV2>;
}

// ============================================================================
// Completion Contract
// ============================================================================

/**
 * Context for completion checking.
 */
export interface CheckContext {
  /** Current iteration number */
  iteration: number;
  /** LLM response from current iteration */
  response?: QueryResult;
  /** Structured output from LLM */
  structuredOutput?: Record<string, unknown>;
  /** Step context for step-based execution */
  stepContext?: StepContext;
}

/**
 * Result of completion check.
 *
 * Guarantee: complete=true => reason is set
 */
export interface CompletionResult {
  /** Whether agent should complete */
  complete: boolean;
  /** Reason for completion (required when complete=true) */
  reason?: string;
}

/**
 * Result of a step execution.
 */
export interface StepResult {
  /** Step identifier */
  stepId: string;
  /** Whether step passed */
  passed: boolean;
  /** Reason for pass/fail */
  reason?: string;
}

/**
 * Contract for completion determination.
 *
 * Guarantees:
 * - check() has no side effects (pure function)
 * - Results are returned to execution layer
 * - Execution layer updates state
 */
export interface CompletionContract {
  /**
   * Check if agent should complete.
   *
   * @param context - Current iteration context
   * @returns Completion decision
   */
  check(context: CheckContext): CompletionResult;

  /**
   * Determine next step after step completion.
   *
   * @param result - Step execution result
   * @returns Next step ID or "complete" to finish
   */
  transition(result: StepResult): string | "complete";
}

// ============================================================================
// Connection Contract
// ============================================================================

/**
 * Options for LLM query.
 */
export interface QueryOptions {
  /** Session ID for conversation continuity */
  sessionId?: string;
  /** System prompt to use */
  systemPrompt?: string;
  /** Tools to make available */
  tools?: string[];
  /** Permission mode for tool execution */
  permissionMode?: string;
  /** Sandbox configuration */
  sandbox?: unknown;
}

// Note: QueryResult and SdkMessage are defined in types.ts and re-exported above.

/**
 * Variables for prompt resolution.
 */
export type Variables = Record<string, string>;

/**
 * Contract for external connections (LLM, files, etc).
 *
 * Error categories:
 * - ConnectionError: Recoverable, retry/fallback
 * - RateLimitError: Recoverable, wait and retry
 * - SessionExpired: Recoverable, create new session
 */
export interface ConnectionContract {
  /**
   * Query LLM with prompt.
   *
   * @param prompt - Prompt string
   * @param options - Query options
   * @returns Async iterator of SDK messages
   * @throws ConnectionError - Network issues (recoverable)
   * @throws RateLimitError - Rate limited (recoverable)
   * @throws SessionExpired - Session expired (create new)
   */
  query(prompt: string, options: QueryOptions): AsyncIterable<SdkMessage>;

  /**
   * Resolve prompt reference to string.
   *
   * @param ref - Prompt reference (path or C3L)
   * @param variables - Variables for substitution
   * @returns Resolved prompt string
   * @throws NotFound - Prompt not found
   * @guarantee Never returns empty string
   */
  resolve(ref: PromptReference, variables: Variables): Promise<string>;
}

// ============================================================================
// Step Context (Data Contract)
// ============================================================================

/**
 * Input specification for step data requirements.
 *
 * Resolution rules:
 * - required=true AND missing => Error
 * - required=false AND missing => use default
 */
export interface InputSpec {
  [key: string]: {
    /** Source in format "stepId.key" */
    from?: string;
    /** Whether this input is required (default: true) */
    required?: boolean;
    /** Default value when required=false and value missing */
    default?: unknown;
  };
}

/**
 * Context for passing data between steps.
 *
 * Namespace convention:
 * stepId.key -> uv-{stepId}_{key}
 *
 * Example:
 * measure.height -> uv-measure_height
 */
export interface StepContext {
  /** All step outputs keyed by step ID */
  outputs: Map<string, Record<string, unknown>>;

  /**
   * Set output data for a step (overwrites existing).
   * @param stepId - Step identifier
   * @param data - Output data to store
   */
  set(stepId: string, data: Record<string, unknown>): void;

  /**
   * Get output value from a step.
   * @param stepId - Step identifier
   * @param key - Output key
   * @returns Value or undefined if not found
   */
  get(stepId: string, key: string): unknown | undefined;

  /**
   * Convert step outputs to UV variable format.
   * @param inputs - Input specification
   * @returns Variables in uv-{stepId}_{key} format
   */
  toUV(inputs: InputSpec): Record<string, string>;
}

// ============================================================================
// Error Types (Error Contract)
// ============================================================================

/**
 * Error classification from design contract (agents/docs/12_contracts.md).
 *
 * These types define the error categories for the contract layer.
 * For runtime error classes, see agents/runner/errors.ts.
 *
 * Classification:
 * - configuration: Unrecoverable, agent won't start
 * - execution: May be recoverable with retry
 * - connection: Recoverable with retry/fallback
 */
export type ContractErrorCategory =
  | "configuration"
  | "execution"
  | "connection";

/**
 * Error information structure for contract layer.
 * Used to communicate error details across boundaries.
 */
export interface ContractError {
  /** Error category for recovery decisions */
  category: ContractErrorCategory;
  /** Human-readable error message */
  message: string;
  /** Whether this error allows recovery */
  recoverable: boolean;
  /** Original error for debugging */
  cause?: Error;
}
