/**
 * Workflow Type Definitions
 *
 * Type definitions for the orchestrator workflow system.
 * Defines phases, agents, transitions, and runtime state
 * used by workflow-loader, label-resolver, phase-transition,
 * dispatcher, and orchestrator modules.
 */

// === Phase ===

/** Classification of workflow phase behavior */
export type PhaseType = "actionable" | "terminal" | "blocking";

/** Declares a workflow phase and its properties */
export interface PhaseDefinition {
  /** Phase behavior classification */
  type: PhaseType;

  /** Selection priority for actionable phases (lower = higher priority) */
  priority?: number;

  /** Agent ID to dispatch when this phase is active */
  agent?: string | null;
}

// === Agent ===

/** Agent behavioral role within the workflow */
export type AgentRole = "transformer" | "validator";

/** Shared properties for all agent definitions */
export interface BaseAgentDefinition {
  /** Behavioral role */
  role: AgentRole;

  /** Agent directory name (defaults to agent ID if omitted) */
  directory?: string;

  /** Phase to transition to on error */
  fallbackPhase?: string;

  /** Close the GitHub issue when this agent's outcome leads to a terminal phase */
  closeOnComplete?: boolean;

  /**
   * Only close the issue when the outcome matches this value.
   * Requires closeOnComplete: true. Useful for validators that route
   * to different terminal phases (e.g., close only on "approved").
   */
  closeCondition?: string;
}

/** Agent that produces a single output phase on success */
export interface TransformerDefinition extends BaseAgentDefinition {
  role: "transformer";

  /** Phase to transition to on successful completion */
  outputPhase: string;
}

/** Agent that validates and routes to different phases based on judgment */
export interface ValidatorDefinition extends BaseAgentDefinition {
  role: "validator";

  /** Judgment key to target phase mapping */
  outputPhases: Record<string, string>;
}

/** Discriminated union of all agent definition types */
export type AgentDefinition = TransformerDefinition | ValidatorDefinition;

// === Handoff ===

/** Configuration for inter-agent handoff communication */
export interface HandoffConfig {
  /** Named comment templates with placeholder support */
  commentTemplates?: Record<string, string>;
}

/**
 * Opaque payload associated with an issue workflow.
 *
 * Infra layer treats this as a generic bag of values. Workflow-specific
 * shape is enforced by `workflow.json.payloadSchema` via Ajv validation
 * at load / emit time. Callers narrow locally when specific keys are
 * required.
 */
export type IssuePayload = Readonly<Record<string, unknown>>;

/**
 * Declarative handoff entry from `workflow.json.handoffs[]`.
 *
 * Represents a single "when agent X emits outcome Y, emit artifact Z"
 * binding. Infra reads this as opaque data — no field value is
 * interpreted as a literal type by the orchestrator / dispatcher /
 * runner / artifact-emitter layers.
 */
export interface HandoffDeclaration {
  /** Workflow-unique handoff identifier (kebab-case, starts with letter) */
  readonly id: string;

  /** Trigger condition: source agent id and canonical outcome string */
  readonly when: {
    readonly fromAgent: string;
    readonly outcome: string;
  };

  /** Artifact emission descriptor */
  readonly emit: {
    readonly type: string;
    readonly schemaRef: string;
    readonly path: string;
  };

  /** Payload key → JSONPath or literal expression mapping */
  readonly payloadFrom: Readonly<Record<string, string>>;

  /** Where to persist the resolved payload after emit */
  readonly persistPayloadTo: "issueStore" | "none";
}

// === Rules ===

/** Execution constraints for the orchestrator loop */
export interface WorkflowRules {
  /** Maximum phase transition cycles per issue */
  maxCycles: number;

  /** Delay in milliseconds between cycles */
  cycleDelayMs: number;

  /** Utilization threshold to trigger rate limit wait (default 0.95) */
  rateLimitThreshold?: number;

  /** Interval in ms between log messages during rate limit wait (default 300000 = 5min) */
  rateLimitPollIntervalMs?: number;

  /** Block when same phase appears consecutively N times. 0 = disabled. */
  maxConsecutivePhases?: number;
}

// === Top-Level ===

/** Root configuration loaded from .agent/workflow.json */
export interface WorkflowConfig {
  /** Schema version */
  version: string;

  /** Optional label namespace prefix (e.g. "docs" produces "docs:ready") */
  labelPrefix?: string;

  /** Phase definitions keyed by phase ID */
  phases: Record<string, PhaseDefinition>;

  /** GitHub label to phase ID mapping */
  labelMapping: Record<string, string>;

  /** Agent definitions keyed by agent ID */
  agents: Record<string, AgentDefinition>;

  /** Execution constraints */
  rules: WorkflowRules;

  /** Inter-agent handoff configuration */
  handoff?: HandoffConfig;

  /** Issue store configuration */
  issueStore?: IssueStoreConfig;

  /** Prioritizer configuration */
  prioritizer?: PrioritizerConfig;

  /**
   * Declarative handoff entries. Orchestrator filters this list after
   * each dispatch by matching {@link HandoffDeclaration.when} against
   * the dispatched agent id and its outcome, then invokes the
   * ArtifactEmitter for each match.
   */
  readonly handoffs?: ReadonlyArray<HandoffDeclaration>;

  /**
   * Reference to the JSON Schema that validates {@link IssuePayload}
   * instances for this workflow. Resolved against the schema registry
   * at load time.
   */
  readonly payloadSchema?: { readonly $ref: string };
}

/** Issue store configuration */
export interface IssueStoreConfig {
  path: string;
}

/** Default issue store configuration used when workflow.json omits issueStore. */
export const DEFAULT_ISSUE_STORE: IssueStoreConfig = {
  path: ".agent/climpt/tmp/issues",
};

/** Prioritizer configuration in workflow.json */
export interface PrioritizerConfig {
  /** Agent ID to dispatch for prioritization */
  agent: string;

  /** Allowed priority labels in order (e.g., ["P1", "P2", "P3"]) */
  labels: string[];

  /** Fallback label when priority is missing or invalid */
  defaultLabel?: string;
}

/** Criteria for fetching issues */
export interface IssueCriteria {
  labels?: string[];
  repo?: string;
  state?: "open" | "closed" | "all";
  limit?: number;
}

// === Orchestrator Results ===

/** Options for orchestrator execution. */
export interface OrchestratorOptions {
  verbose?: boolean;
  dryRun?: boolean;
}

/** Final result of a single-issue workflow run. */
export interface OrchestratorResult {
  issueNumber: number;
  finalPhase: string;
  cycleCount: number;
  history: PhaseTransitionRecord[];
  status:
    | "completed"
    | "blocked"
    | "cycle_exceeded"
    | "phase_repetition_exceeded"
    | "dry-run";
  /** True when closeOnComplete triggered and gh issue close succeeded */
  issueClosed?: boolean;
}

/** Options for batch orchestrator execution. */
export interface BatchOptions extends OrchestratorOptions {
  prioritizeOnly?: boolean;
}

/** Result of batch processing */
export interface BatchResult {
  processed: OrchestratorResult[];
  skipped: { issueNumber: number; reason: string }[];
  totalIssues: number;
  status: "completed" | "partial" | "failed";
}

// === Runtime State ===

/**
 * Per-issue orchestration state.
 *
 * Corresponds to ADK session.state but is persisted
 * via GitHub issue labels and comments.
 */
export interface IssueWorkflowState {
  /** GitHub issue number */
  issueNumber: number;

  /** Current phase ID */
  currentPhase: string;

  /** Number of completed phase transition cycles */
  cycleCount: number;

  /** Correlation ID for tracing */
  correlationId: string;

  /** Ordered history of phase transitions */
  history: PhaseTransitionRecord[];

  /**
   * Opaque per-workflow payload. Populated by {@link HandoffDeclaration}
   * entries whose `persistPayloadTo` is `"issueStore"`, consumed by
   * subsequent dispatches via `DispatchOptions.payload`.
   */
  readonly payload?: IssuePayload;
}

/** Record of a single phase transition */
export interface PhaseTransitionRecord {
  /** Source phase ID */
  from: string;

  /** Target phase ID */
  to: string;

  /** Agent that performed the transition */
  agent: string;

  /** Agent outcome ("success" | "failed" | validator judgment key) */
  outcome: string;

  /** ISO 8601 timestamp */
  timestamp: string;
}

// === Dispatch ===

/** Result of attempting to dispatch an agent for an issue */
export type DispatchResult =
  | { status: "dispatched"; agent: string; issueNumber: number }
  | { status: "skipped"; reason: string }
  | { status: "blocked"; reason: string }
  | { status: "terminal"; phase: string };

/** Result of attempting a phase transition */
export type TransitionResult =
  | {
    status: "transitioned";
    from: string;
    to: string;
    labelsRemoved: string[];
    labelsAdded: string[];
  }
  | { status: "cycle_exceeded"; cycleCount: number; maxCycles: number }
  | { status: "fallback"; phase: string; reason: string };
