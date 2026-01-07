/**
 * Iterate Agent - Type Definitions
 *
 * Core TypeScript types for the autonomous agent system.
 */

// Import common types for local use
import type { WorktreeConfig } from "../../common/types.ts";
import type { CoordinationConfig } from "../../common/coordination-types.ts";

// Re-export common types
export type {
  AgentName,
  BaseAgentConfig,
  BaseIterationSummary,
  GitHubIssue,
  LogEntry,
  LoggingConfig,
  LogLevel,
  MergeResult,
  MergeStrategy,
  PermissionMode,
  ToolResultInfo,
  ToolUseInfo,
  WorktreeCLIOptions,
  WorktreeConfig,
  WorktreeSetupResult,
} from "../../common/types.ts";
export { DEFAULT_WORKTREE_CONFIG } from "../../common/types.ts";

/**
 * Completion criteria types
 */
export type CompletionType = "issue" | "project" | "iterate";

/**
 * Project mode phases
 */
export type ProjectPhase =
  | "preparation" // Initial skills organization and planning
  | "processing" // Working on issues one by one
  | "review" // Checking completion
  | "again" // Re-execution after failed review
  | "complete"; // Done

/**
 * Project plan output from preparation phase
 */
export interface ProjectPlan {
  /** Total issues in project */
  totalIssues: number;

  /** Estimated complexity */
  estimatedComplexity: "low" | "medium" | "high";

  /** Skills needed for this project */
  skillsNeeded: string[];

  /** Skills to disable */
  skillsToDisable: string[];

  /** Execution order */
  executionOrder: Array<{
    issue: number;
    reason: string;
  }>;

  /** Notes from preparation */
  notes?: string;
}

/**
 * Review result from review phase
 */
export interface ReviewResult {
  /** Review result: pass or fail */
  result: "pass" | "fail";

  /** Summary message */
  summary: string;

  /** Details for pass (issue summaries) */
  details?: string[];

  /** Issues needing attention (for fail) */
  issues?: Array<{
    number: number;
    reason: string;
  }>;
}

/**
 * CLI options for iterate-agent
 */
export interface AgentOptions {
  /** GitHub Issue number to work on */
  issue?: number;

  /** GitHub Project number to work on */
  project?: number;

  /**
   * GitHub Project owner (user login or org name).
   * Only used with --project.
   *
   * If not specified, defaults to the repository owner.
   * Use "@me" to explicitly specify the authenticated user.
   *
   * @example
   * - "tettuan" - User's projects
   * - "my-org" - Organization's projects
   * - "@me" - Authenticated user's projects (same as not specifying)
   */
  projectOwner?: string;

  /** Maximum number of Skill invocations */
  iterateMax: number;

  /** MCP agent name (e.g., "climpt") */
  agentName: string;

  /** Whether to resume previous session (default: false) */
  resume: boolean;

  /** Label to filter project issues (only used with --project) */
  label?: string;

  /** Include "Done" items from project board (only used with --project) */
  includeCompleted?: boolean;

  /**
   * Working branch name for worktree mode.
   * Only effective when forceWorktree is true in config.
   * If not specified, auto-generated: <currentBranch>-yyyymmdd-hhmmss
   */
  branch?: string;

  /**
   * Base branch (merge target) for worktree mode.
   * If not specified, uses the current branch at execution time.
   */
  baseBranch?: string;
}

/**
 * Agent configuration (extends base)
 */
export interface AgentConfig {
  /** List of allowed tools for this agent */
  allowedTools: string[];

  /** Permission mode for this agent */
  permissionMode:
    | "default"
    | "plan"
    | "acceptEdits"
    | "bypassPermissions";
}

/**
 * Agent-specific coordination settings (from agent's config.json)
 */
export interface AgentCoordinationSettings {
  role?: "implementer" | "verifier";
  handoffBehavior?: Record<string, string>;
  labelOverrides?: Record<string, string>;
}

/**
 * Main configuration structure
 */
export interface IterateAgentConfig {
  version: string;
  agents: Record<string, AgentConfig>;
  github?: {
    apiVersion?: string;
  };
  logging: {
    directory: string;
    maxFiles: number;
    format: string;
  };
  /** Worktree configuration for isolated execution */
  worktree?: WorktreeConfig;
  /** Agent-specific coordination settings (from agent's config.json) */
  agentCoordination?: AgentCoordinationSettings;
  /** Full coordination configuration (merged from coordination-config.json) */
  coordination?: CoordinationConfig;
}

/**
 * GitHub Project data
 */
export interface GitHubProject {
  number: number;
  title: string;
  description: string | null;
  readme: string | null;
  items: Array<{
    content?: {
      number?: number;
      title?: string;
      state?: "OPEN" | "CLOSED";
    };
    status?: string;
  }>;
}

/**
 * Completion criteria check result
 */
export interface CompletionCheckResult {
  type: CompletionType;
  complete: boolean;
  current: number;
  target: number;
  message: string;
}

/**
 * System prompt build context
 */
export interface PromptContext {
  agentName: string;
  completionCriteria: string;
  completionCriteriaDetail: string;
}

/**
 * UV variables for system prompt expansion via breakdown CLI
 *
 * These are passed as --uv-* CLI arguments to breakdown.
 */
export interface UvVariables {
  /** MCP agent name for delegate-climpt-agent */
  agent_name: string;

  /** Short completion criteria description */
  completion_criteria: string;

  /** GitHub label to filter issues (default: "docs") */
  target_label: string;

  /** Comma-separated list of recommended skills from preparation phase */
  recommended_skills?: string;
}

/**
 * Parsed CLI arguments result
 */
export interface ParsedArgs {
  /** Whether --init flag was specified */
  init: boolean;

  /** Whether --help flag was specified */
  help: boolean;

  /** Agent options (only valid if not init/help) */
  options?: AgentOptions;
}

/**
 * Summary of what was accomplished in one iteration
 * Used to pass context to the next iteration
 */
export interface IterationSummary {
  /** Iteration number (1-based) */
  iteration: number;

  /** SDK session ID for potential resume */
  sessionId?: string;

  /** Assistant's text responses during this iteration */
  assistantResponses: string[];

  /** Tools invoked during this iteration */
  toolsUsed: string[];

  /** Errors encountered (if any) */
  errors: string[];

  /** Final result message from SDK (if any) */
  finalResult?: string;
}

/**
 * Model-specific token usage statistics
 */
export interface ModelUsageStats {
  /** Model name (e.g., "claude-opus-4-5") */
  modelName: string;

  /** Input tokens count */
  inputTokens: number;

  /** Output tokens count */
  outputTokens: number;

  /** Cache read input tokens count */
  cacheReadInputTokens: number;

  /** Cost in USD for this model */
  cost: number;
}

/**
 * SDK result message statistics (from type: "result" message)
 */
export interface SDKResultStats {
  /** Total execution duration in milliseconds */
  durationMs: number;

  /** API call duration in milliseconds */
  durationApiMs: number;

  /** Number of turns in the conversation */
  numTurns: number;

  /** Total cost in USD */
  totalCostUsd: number;

  /** Model-specific usage statistics */
  modelUsage: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    cost?: number;
  }>;
}

/**
 * Issue action types
 *
 * - progress: Report work progress (adds comment)
 * - question: Ask a question or request clarification (adds comment)
 * - blocked: Report a blocker (adds comment + optional label)
 * - close: Complete and close the issue
 */
export type IssueActionType = "progress" | "question" | "blocked" | "close";

/**
 * Issue action from LLM
 *
 * LLM outputs this JSON to request issue operations.
 * Format in markdown:
 * ```issue-action
 * {"action":"progress","issue":1,"body":"## Progress\n- Step 1 done"}
 * ```
 */
export interface IssueAction {
  /** Action type to perform */
  action: IssueActionType;

  /** Issue number to act on */
  issue: number;

  /** Comment body or summary */
  body: string;

  /** Optional label to add (used with "blocked" action) */
  label?: string;
}

/**
 * Result of parsing issue action
 */
export interface IssueActionParseResult {
  /** Whether parsing succeeded */
  success: boolean;

  /** Parsed action (if success) */
  action?: IssueAction;

  /** Error message (if failed) */
  error?: string;

  /** Raw content that was attempted to parse */
  rawContent?: string;
}

/**
 * Execution report for displaying results
 */
export interface ExecutionReport {
  // Basic statistics
  /** Total log entries count */
  totalEntries: number;

  /** Error count */
  errorCount: number;

  /** Number of issues updated */
  issuesUpdated: number;

  /** Number of projects updated */
  projectsUpdated: number;

  /** Tool usage counts */
  toolsUsed: Record<string, number>;

  // Performance metrics
  /** Total execution duration in milliseconds */
  durationMs: number;

  /** API call duration in milliseconds */
  durationApiMs: number;

  /** Number of turns */
  numTurns: number;

  /** Number of iterations */
  iterations: number;

  /** Total cost in USD */
  totalCostUsd: number;

  // Token usage
  /** Model-specific usage statistics */
  modelUsage: ModelUsageStats[];

  // Other
  /** LLM final response summary */
  summary: string;

  /** Completion reason */
  completionReason: string;
}
