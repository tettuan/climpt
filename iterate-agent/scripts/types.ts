/**
 * Iterate Agent - Type Definitions
 *
 * Core TypeScript types for the autonomous agent system.
 */

/**
 * Agent name types (MCP agent names)
 */
export type AgentName = "climpt" | string;

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
  | "result";

/**
 * Completion criteria types
 */
export type CompletionType = "issue" | "project" | "iterate";

/**
 * CLI options for iterate-agent
 */
export interface AgentOptions {
  /** GitHub Issue number to work on */
  issue?: number;

  /** GitHub Project number to work on */
  project?: number;

  /** Maximum number of Skill invocations */
  iterateMax: number;

  /** MCP agent name (e.g., "climpt") */
  agentName: AgentName;

  /** Whether to resume previous session (default: false) */
  resume: boolean;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Path to system prompt template */
  systemPromptTemplate: string;

  /** List of allowed tools for this agent */
  allowedTools: string[];

  /** Permission mode for this agent */
  permissionMode: PermissionMode;
}

/**
 * Main configuration structure
 */
export interface IterateAgentConfig {
  version: string;
  agents: Record<string, AgentConfig>;
  github: {
    tokenEnvVar: string;
    apiVersion: string;
  };
  logging: {
    directory: string;
    maxFiles: number;
    format: string;
  };
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
    skillInvocation?: {
      skillName: string;
      taskDescription: string;
      result: string;
    };
    completionCheck?: {
      type: CompletionType;
      current: number;
      target: number;
      complete: boolean;
    };
    error?: {
      name: string;
      message: string;
      stack?: string;
    };
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
 * GitHub Project data
 */
export interface GitHubProject {
  number: number;
  title: string;
  description: string | null;
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
  agentName: AgentName;
  completionCriteria: string;
  completionCriteriaDetail: string;
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
