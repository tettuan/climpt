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

  /**
   * Optional outcome-to-phase mapping for non-success results.
   *
   * When defined, `resolveOutcome` passes through the agent's `verdict`
   * (instead of the binary "failed") and `computeTransition` looks up
   * `fallbackPhases[outcome]` before falling back to `fallbackPhase`.
   *
   * Symmetric with `ValidatorDefinition.outputPhases`.
   */
  fallbackPhases?: Record<string, string>;
}

/** Agent that validates and routes to different phases based on judgment */
export interface ValidatorDefinition extends BaseAgentDefinition {
  role: "validator";

  /** Judgment key to target phase mapping */
  outputPhases: Record<string, string>;
}

/** Discriminated union of all agent definition types */
export type AgentDefinition = TransformerDefinition | ValidatorDefinition;

// === Labels ===

/**
 * Label role: determines whether the validator demands the label be
 * referenced by `labelMapping` / `prioritizer.labels` (routing) or
 * allows it as a declared-but-not-routed identification tag (marker).
 *
 * - `routing` (default): participates in phase dispatch. Orphan check enforced.
 * - `marker`: identification-only (e.g., `project-sentinel`). Consumed by
 *   code via `labels.includes(...)` probes, not by phase routing. Exempt
 *   from the orphan check but still synced and color-validated.
 */
export type LabelRole = "routing" | "marker";

/**
 * Declarative GitHub label specification.
 *
 * Drives idempotent pre-dispatch sync so orchestrator and triager never
 * depend on a bash bootstrap block living inside a prompt file. Routing
 * labels (default) must be referenced by `labelMapping` or
 * `prioritizer.labels`; marker labels bypass that check.
 */
export interface LabelSpec {
  /** 6-char hex GitHub label color (no leading `#`) */
  color: string;

  /** Human-readable description surfaced in the GitHub UI */
  description: string;

  /**
   * Label role (default: `routing`). See {@link LabelRole}.
   */
  role?: LabelRole;
}

// === Handoff ===

/** Configuration for inter-agent handoff communication */
export interface HandoffConfig {
  /** Named comment templates with placeholder support */
  commentTemplates?: Record<string, string>;
}

/**
 * Opaque payload associated with a subject workflow.
 *
 * Infra layer treats this as a generic bag of values. Workflow-specific
 * shape is enforced by `workflow.json.payloadSchema` via Ajv validation
 * at load / emit time. Callers narrow locally when specific keys are
 * required.
 */
export type SubjectPayload = Readonly<Record<string, unknown>>;

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
  readonly persistPayloadTo: "subjectStore" | "none";
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

  /**
   * Declarative GitHub label specifications keyed by label name.
   *
   * Owns color + description for every label the workflow touches.
   * Orchestrator/triager sync this to the repository at startup
   * (idempotent, per-label try/catch). Cross-referenced against
   * `labelMapping` keys and `prioritizer.labels` by the loader —
   * missing entries are a configuration error (WF-LABEL-003).
   */
  labels?: Record<string, LabelSpec>;

  /** Agent definitions keyed by agent ID */
  agents: Record<string, AgentDefinition>;

  /** Execution constraints */
  rules: WorkflowRules;

  /** Inter-agent handoff configuration */
  handoff?: HandoffConfig;

  /** Subject store configuration */
  subjectStore?: SubjectStoreConfig;

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
   * Reference to the JSON Schema that validates {@link SubjectPayload}
   * instances for this workflow. Resolved against the schema registry
   * at load time.
   */
  readonly payloadSchema?: { readonly $ref: string };

  /**
   * Project-level orchestration binding.
   *
   * When absent, all project-related features (T6.eval project
   * completion check, Hook O1 goal injection, Hook O2 project
   * inheritance) are disabled — preserving v1.13.x behavior
   * (Invariant I1, design doc §3).
   */
  projectBinding?: ProjectBindingConfig;
}

/** Subject store configuration */
export interface SubjectStoreConfig {
  path: string;
}

/** Default subject store configuration used when workflow.json omits subjectStore. */
export const DEFAULT_SUBJECT_STORE: SubjectStoreConfig = {
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

/**
 * Configuration for project-level orchestration features.
 *
 * When absent from `workflow.json`, all project-related code paths
 * (T6.eval, Hook O1/O2) are no-ops — preserving v1.13.x behavior
 * (Invariant I1). When present, the three T6.eval identifiers
 * (`donePhase`, `evalPhase`, `sentinelLabel`) are required so the
 * orchestrator never needs to hardcode phase or label names: the
 * workflow owns every identifier the code consumes.
 */
export interface ProjectBindingConfig {
  /** Inject project goal into agent prompt context on dispatch */
  injectGoalIntoPromptContext: boolean;
  /** Inherit parent project membership when creating child issues */
  inheritProjectsForCreateIssue: boolean;
  /**
   * Phase ID signalling per-item completion for the T6.eval trigger.
   * Must reference a phase with `type === "terminal"`. Resolved to a
   * GitHub label via `labelMapping` (+ `labelPrefix`) at check time.
   */
  donePhase: string;
  /**
   * Phase ID the sentinel transitions to when every non-sentinel item
   * resolves to `donePhase`. Must reference an actionable phase with
   * an `agent` assigned (the evaluator). Resolved to a GitHub label
   * via `labelMapping` (+ `labelPrefix`).
   */
  evalPhase: string;
  /**
   * Phase ID the sentinel issue starts in when bootstrapped via
   * `deno task project:init`. Must reference an actionable phase
   * with an `agent` assigned (the planner). Resolved to a GitHub
   * label via `labelMapping` (+ `labelPrefix`) so the sentinel
   * creation script never hardcodes `kind:plan`.
   */
  planPhase: string;
  /**
   * Bare GitHub label name identifying the project sentinel issue.
   * Must be declared in `config.labels` with `role: "marker"` — the
   * sentinel is consumed by `labels.includes(...)` probes, not by
   * phase routing, so it bypasses the orphan check.
   */
  sentinelLabel: string;
}

/** Project reference — identifies a GitHub Project v2 by owner+number or node id. */
export type ProjectRef = { owner: string; number: number } | { id: string };

/** Criteria for fetching issues */
export interface IssueCriteria {
  labels?: string[];
  repo?: string;
  state?: "open" | "closed" | "all";
  limit?: number;
  /**
   * Restrict the batch to issues belonging to this Project v2.
   * When set, only project members are processed.
   */
  project?: ProjectRef;
  /**
   * Disable the default unbound-only filter. When `project` is undefined
   * and `allProjects` is true, every matching issue is processed regardless
   * of Project v2 membership. Default behavior (both undefined) restricts
   * the batch to issues that belong to NO Project v2 — the "global queue"
   * complement of any project-scoped run.
   */
  allProjects?: boolean;
}

// === Orchestrator Results ===

/** Options for orchestrator execution. */
export interface OrchestratorOptions {
  verbose?: boolean;
  dryRun?: boolean;
}

/** Final result of a single-issue workflow run. */
export interface OrchestratorResult {
  subjectId: string | number;
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
  skipped: { subjectId: string | number; reason: string }[];
  totalIssues: number;
  status: "completed" | "partial" | "failed";
}

// === Runtime State ===

/**
 * Per-subject orchestration state.
 *
 * Corresponds to ADK session.state but is persisted
 * via GitHub issue labels and comments.
 */
export interface IssueWorkflowState {
  /** Subject identifier (GitHub issue number or other subject) */
  subjectId: string | number;

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
   * entries whose `persistPayloadTo` is `"subjectStore"`, consumed by
   * subsequent dispatches via `DispatchOptions.payload`.
   */
  readonly payload?: SubjectPayload;
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

/** Result of attempting to dispatch an agent for a subject */
export type DispatchResult =
  | { status: "dispatched"; agent: string; subjectId: string | number }
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
