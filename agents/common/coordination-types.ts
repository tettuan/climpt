/**
 * Agent Coordination Type Definitions
 *
 * Type definitions for agent coordination configuration.
 * These types define the structure of coordination-config.json.
 */

export interface CoordinationConfig {
  version: string;
  labels: LabelConfig;
  handoff: HandoffConfig;
  retry: RetryConfig;
  orchestration: OrchestrationConfig;
  logging: LoggingConfig;
  traceability: TraceabilityConfig;
}

export interface LabelConfig {
  requirements: string;
  review: string;
  gap: string;
  fromReviewer: string;
  feedback: string;
}

export interface HandoffConfig {
  iteratorToReviewer: IteratorHandoff;
  reviewerToIterator: ReviewerHandoff;
  reviewerComplete: ReviewerComplete;
}

export interface IteratorHandoff {
  trigger: "internal-review-pass" | "all-issues-closed" | "manual";
  action: "add-review-label" | "comment-only" | "none";
  commentTemplate: string;
}

export interface ReviewerHandoff {
  trigger: "gaps-found";
  action: "create-gap-issues";
  issueTemplate: IssueTemplate;
}

export interface IssueTemplate {
  titlePrefix: string;
  labels: string[];
  bodyTemplate: string;
}

export interface ReviewerComplete {
  trigger: "no-gaps";
  action: "close-review-issue" | "comment-only" | "none";
  commentTemplate: string;
}

export interface RetryConfig {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier: number;
}

export interface OrchestrationConfig {
  maxCycles: number;
  cycleDelayMs: number;
  autoTrigger: boolean;
}

export interface LoggingConfig {
  correlationIdFormat: string;
  retainDays: number;
}

export interface TraceabilityConfig {
  idFormat: string;
  requireInGapIssues: boolean;
}

/**
 * Agent-specific coordination config for config.json
 */
export interface AgentCoordinationConfig {
  role: "implementer" | "verifier";
  handoffBehavior: Record<string, string>;
  labelOverrides?: Partial<LabelConfig>;
  actions?: Record<string, boolean>;
}
