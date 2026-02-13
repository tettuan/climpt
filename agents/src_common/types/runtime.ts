/**
 * Runtime type definitions for climpt-agents
 */

// Forward declarations for RuntimeContext dependencies
// These are imported from other modules, but we need the interface here
import type { CompletionHandler } from "../../completion/mod.ts";
import type { PromptResolverAdapter as PromptResolver } from "../../prompts/resolver-adapter.ts";
import type { Logger } from "../logger.ts";
import type { PromptLogger } from "../../common/prompt-logger.ts";

// ============================================================================
// Runtime Types
// ============================================================================

/**
 * Result of agent execution.
 *
 * Invariants:
 * - success=true  => reason is completion reason
 * - success=false => reason is error content
 */
export interface AgentResult {
  /** Whether agent completed successfully */
  success: boolean;

  /** Total number of iterations executed */
  iterations: number;

  /** Completion reason (success) or error content (failure) */
  reason: string;

  /** Detailed iteration summaries */
  summaries: IterationSummary[];

  /** Error message if failed */
  error?: string;

  /** Cumulative cost in USD (from SDK result) */
  totalCostUsd?: number;

  /** Number of SDK turns executed */
  numTurns?: number;

  /** Total execution duration in milliseconds */
  durationMs?: number;
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
  errors: string[];
  /** Structured output from SDK result (when outputFormat is configured) */
  structuredOutput?: Record<string, unknown>;
  /** Rate limit retry info (when rate limit is hit) */
  rateLimitRetry?: {
    waitMs: number;
    attempt: number;
  };
  /** Flag indicating schema resolution failed for this iteration (R2 fail-fast) */
  schemaResolutionFailed?: boolean;
  /** Cumulative cost in USD (from SDK result) */
  totalCostUsd?: number;
  /** Number of SDK turns executed */
  numTurns?: number;
  /** Total execution duration in milliseconds */
  durationMs?: number;
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

/**
 * Runtime context containing initialized dependencies.
 * This pattern replaces non-null assertions by ensuring all dependencies
 * are available only after successful initialization.
 */
export interface RuntimeContext {
  readonly completionHandler: CompletionHandler;
  readonly promptResolver: PromptResolver;
  readonly logger: Logger;
  readonly cwd: string;
  /** Optional prompt logger for usage analysis */
  readonly promptLogger?: PromptLogger;
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
