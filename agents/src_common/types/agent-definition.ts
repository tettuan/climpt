/**
 * Agent definition type definitions for climpt-agents
 */

import type { CompletionConfigUnion, CompletionType } from "./completion.ts";

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
  github?: GitHubConfig;
  worktree?: WorktreeConfig;
  /** Finalize configuration for worktree mode */
  finalize?: FinalizeConfig;
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
  /**
   * Auto-response message for AskUserQuestion tool.
   * When set, the agent will automatically respond with this message
   * instead of waiting for user input, enabling autonomous execution.
   * Default: "Use your best judgment to choose the optimal approach. No need to confirm again."
   */
  askUserAutoResponse?: string;
}

/**
 * Finalize configuration for worktree mode.
 * Controls what happens after Flow loop completes successfully.
 */
export interface FinalizeConfig {
  /** Whether to automatically merge worktree branch to base (default: true) */
  autoMerge?: boolean;
  /** Whether to push after merge (default: false) */
  push?: boolean;
  /** Remote to push to (default: origin) */
  remote?: string;
  /** Whether to create a PR instead of direct merge (default: false) */
  createPr?: boolean;
  /** Target branch for PR (default: base branch) */
  prTarget?: string;
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
 * Permission mode types (from Claude Agent SDK)
 * - "default": Normal mode with default permissions
 * - "plan": Plan mode (read-only exploration)
 * - "acceptEdits": Auto-accept file edits
 * - "bypassPermissions": Bypass all permission checks
 */
export type PermissionMode =
  | "default"
  | "plan"
  | "acceptEdits"
  | "bypassPermissions";

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

export interface GitHubConfig {
  enabled: boolean;
  labels?: Record<string, string>;
  /** Default closure action for issue/externalState completion */
  defaultClosureAction?: "close" | "label-only" | "label-and-close";
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
