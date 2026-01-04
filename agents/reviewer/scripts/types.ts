/**
 * Review Agent - Type Definitions
 *
 * Core TypeScript types for the review agent system.
 */

// Re-export common types
export type {
  AgentName,
  BaseAgentConfig,
  BaseIterationSummary,
  GitHubIssue,
  LogEntry,
  LoggingConfig,
  LogLevel,
  PermissionMode,
  ToolResultInfo,
  ToolUseInfo,
} from "../../common/types.ts";

/**
 * Review status for each requirement
 */
export type ReviewStatus = "complete" | "partial" | "missing" | "pending";

/**
 * CLI options for review-agent
 */
export interface ReviewOptions {
  /** GitHub Project number to review */
  project: number;

  /** Maximum number of iterations */
  iterateMax: number;

  /** Agent name (default: "reviewer") */
  agentName: string;

  /** Label for requirements/specs issues (default: "docs") */
  requirementsLabel: string;

  /** Label for review target issues (default: "review") */
  reviewLabel: string;
}

/**
 * Parsed CLI arguments result
 */
export interface ParsedArgs {
  /** Whether --init flag was specified */
  init: boolean;

  /** Whether --help flag was specified */
  help: boolean;

  /** Review options (only valid if not init/help) */
  options?: ReviewOptions;
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
  permissionMode:
    | "default"
    | "plan"
    | "acceptEdits"
    | "bypassPermissions";
}

/**
 * Required parameter configuration
 */
export interface RequiredParam {
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
}

/**
 * Main configuration structure
 */
export interface ReviewAgentConfig {
  version: string;
  agents: Record<string, AgentConfig>;
  requiredParams: Record<string, RequiredParam>;
  github?: {
    apiVersion?: string;
    tokenEnvVar?: string;
    labels?: {
      gap?: string;
      reviewer?: string;
    };
  };
  logging: {
    directory: string;
    maxFiles: number;
    format: string;
  };
  output?: {
    issueLabels?: string[];
  };
}

/**
 * Traceability ID parsed from issue
 */
export interface TraceabilityId {
  /** Full ID (e.g., "req:stock:data-mgmt-abc123#20251229") */
  fullId: string;

  /** Category (e.g., "stock") */
  category: string;

  /** Name (e.g., "data-mgmt-abc123") */
  name: string;

  /** Date stamp (e.g., "20251229") */
  date?: string;
}

/**
 * Requirement item from docs repository
 */
export interface RequirementItem {
  /** Traceability ID */
  traceabilityId: TraceabilityId;

  /** Requirement title */
  title: string;

  /** Requirement description */
  description: string;

  /** Acceptance criteria */
  acceptanceCriteria?: string[];

  /** Review status */
  status: ReviewStatus;

  /** Gap description if partial/missing */
  gap?: string;

  /** Confidence level (0-100) */
  confidence?: number;
}

/**
 * Review action types
 *
 * - create-issue: Create a new gap issue
 * - progress: Report review progress
 * - complete: Review completed
 */
export type ReviewActionType = "create-issue" | "progress" | "complete";

/**
 * Review action from LLM
 *
 * LLM outputs this JSON to request review operations.
 * Format in markdown:
 * ```review-action
 * {"action":"create-issue","title":"[Gap] Description","body":"...","labels":["implementation-gap"]}
 * ```
 */
export interface ReviewAction {
  /** Action type to perform */
  action: ReviewActionType;

  /** Issue title (for create-issue) */
  title?: string;

  /** Issue/comment body */
  body: string;

  /** Labels to add (for create-issue) */
  labels?: string[];

  /** Summary (for complete action) */
  summary?: string;
}

/**
 * Result of parsing review action
 */
export interface ReviewActionParseResult {
  /** Whether parsing succeeded */
  success: boolean;

  /** Parsed action (if success) */
  action?: ReviewAction;

  /** Error message (if failed) */
  error?: string;

  /** Raw content that was attempted to parse */
  rawContent?: string;
}

/**
 * Review summary statistics
 */
export interface ReviewSummary {
  /** Total requirements reviewed */
  totalRequirements: number;

  /** Complete requirements count */
  completeCount: number;

  /** Partial requirements count */
  partialCount: number;

  /** Missing requirements count */
  missingCount: number;

  /** List of created gap issues */
  createdIssues: number[];

  /** Review details per requirement */
  details: RequirementItem[];
}

/**
 * Iteration summary for review agent
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

  /** Review actions detected */
  reviewActions: ReviewAction[];

  /** Errors encountered (if any) */
  errors: string[];

  /** Final result message from SDK (if any) */
  finalResult?: string;
}

/**
 * UV variables for C3L prompt expansion
 */
export interface UvVariables {
  /** GitHub Project number */
  project: string;

  /** Label for requirements/specs issues */
  requirements_label: string;

  /** Label for review target issues */
  review_label: string;
}

/**
 * Execution report for displaying results
 */
export interface ExecutionReport {
  /** Total log entries count */
  totalEntries: number;

  /** Error count */
  errorCount: number;

  /** Requirements reviewed */
  requirementsReviewed: number;

  /** Gap issues created */
  gapIssuesCreated: number;

  /** Tool usage counts */
  toolsUsed: Record<string, number>;

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

  /** Review summary */
  summary: ReviewSummary;

  /** Completion reason */
  completionReason: string;
}
