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
