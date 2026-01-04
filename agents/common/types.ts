/**
 * Common Agent Types
 *
 * Shared type definitions for all agent implementations.
 */

/**
 * Agent name type
 */
export type AgentName = string;

/**
 * Permission mode types (from Claude Agent SDK)
 */
export type PermissionMode =
  | "default"
  | "plan"
  | "acceptEdits"
  | "bypassPermissions";

/**
 * Log levels
 */
export type LogLevel =
  | "info"
  | "error"
  | "debug"
  | "assistant"
  | "user"
  | "system"
  | "result"
  | "tool_use"
  | "tool_result";

/**
 * Tool use information for logging
 */
export interface ToolUseInfo {
  /** Tool name (e.g., "Read", "Edit", "Bash") */
  toolName: string;

  /** Tool use ID from API */
  toolUseId: string;

  /** Summarized input (privacy-aware) */
  inputSummary?: string;
}

/**
 * Tool result information for logging
 */
export interface ToolResultInfo {
  /** Tool use ID from API */
  toolUseId: string;

  /** Whether the tool call was successful */
  success: boolean;

  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Log entry structure (JSONL format)
 */
export interface LogEntry {
  step: number;
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: {
    role?: string;
    iterationCount?: number;
    taskId?: string;
    // Tool use tracking
    toolUse?: ToolUseInfo;
    toolResult?: ToolResultInfo;
    // Skill invocation (for iterate-agent)
    skillInvocation?: {
      skillName: string;
      taskDescription: string;
      result: string;
    };
    // Completion check
    completionCheck?: {
      type?: string;
      current?: number;
      target?: number;
      complete: boolean;
      [key: string]: unknown;
    };
    // Error details
    error?: {
      name: string;
      message: string;
      stack?: string;
    };
    // Allow additional properties
    [key: string]: unknown;
  };
}

/**
 * GitHub Issue data
 */
export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: "OPEN" | "CLOSED";
  labels: Array<{ name: string }>;
  comments?: Array<{ body: string }>;
}

/**
 * Base agent configuration
 */
export interface BaseAgentConfig {
  /** List of allowed tools for this agent */
  allowedTools: string[];

  /** Permission mode for this agent */
  permissionMode: PermissionMode;
}

/**
 * Base logging configuration
 */
export interface LoggingConfig {
  directory: string;
  maxFiles: number;
  format: string;
}

/**
 * Base iteration summary
 */
export interface BaseIterationSummary {
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

// ============================================================================
// Worktree Configuration
// ============================================================================

/**
 * Worktree configuration
 */
export interface WorktreeConfig {
  /**
   * Enable worktree mode
   * - true: --branch option is enabled, work in worktree
   * - false: Normal mode, work in current directory
   */
  forceWorktree: boolean;

  /**
   * Root directory for worktrees
   * Relative path from the working repository
   * @default "../worktree"
   */
  worktreeRoot: string;
}

/**
 * Worktree CLI options (common for iterator/reviewer)
 */
export interface WorktreeCLIOptions {
  /** Working branch name */
  branch?: string;

  /** Base branch (merge target) */
  baseBranch?: string;
}

/**
 * Worktree setup result
 */
export interface WorktreeSetupResult {
  /** Full path to the worktree */
  worktreePath: string;

  /** Working branch name */
  branchName: string;

  /** Base branch name */
  baseBranch: string;

  /** Whether the worktree was newly created */
  created: boolean;
}

/**
 * Merge strategy types
 */
export type MergeStrategy = "squash" | "fast-forward" | "merge-commit";

/**
 * Merge result
 */
export interface MergeResult {
  /** Whether the merge succeeded */
  success: boolean;

  /** Strategy used */
  strategy: MergeStrategy;

  /** Error message (on failure) */
  error?: string;

  /** Conflicting files (on conflict) */
  conflictFiles?: string[];
}

/**
 * Default worktree configuration
 */
export const DEFAULT_WORKTREE_CONFIG: WorktreeConfig = {
  forceWorktree: false,
  worktreeRoot: "../worktree",
};
