/**
 * Common Agent Types
 *
 * Shared type definitions for all agent implementations.
 *
 * NOTE: Core types (PermissionMode, LoggingConfig) are defined in src_common/types.ts
 * and re-exported here for backward compatibility.
 */

// Import for internal use
import type { PermissionMode as PermissionModeType } from "../src_common/types.ts";

// Re-export core types from src_common for backward compatibility
export type { LoggingConfig, PermissionMode } from "../src_common/types.ts";

// Type alias for internal use within this file
type PermissionMode = PermissionModeType;

/**
 * Agent name type
 */
export type AgentName = string;

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
  /** Correlation ID for tracing across agents */
  correlationId?: string;
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

// LoggingConfig is re-exported from src_common/types.ts at the top of this file

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
// Worktree Setup Configuration
// ============================================================================

/**
 * Worktree setup configuration for runtime operations.
 *
 * NOTE: This is different from WorktreeConfig in src_common/types.ts.
 * - WorktreeConfig (src_common): Agent definition config (enabled, root)
 * - WorktreeSetupConfig (common): Runtime worktree setup behavior
 */
export interface WorktreeSetupConfig {
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
 * Default worktree setup configuration
 */
export const DEFAULT_WORKTREE_SETUP_CONFIG: WorktreeSetupConfig = {
  forceWorktree: false,
  worktreeRoot: "../worktree",
};
