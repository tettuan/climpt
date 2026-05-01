/**
 * Orchestrator Module - Public API
 *
 * Re-exports all public types and classes from the orchestrator subsystem.
 */

// Types
export type {
  AgentDefinition,
  AgentRole,
  BaseAgentDefinition,
  BatchOptions,
  BatchResult,
  DispatchResult,
  GhRepoIssuesMembership,
  HandoffConfig,
  IssueCriteria,
  IssueQueryState,
  IssueSource,
  IssueWorkflowState,
  LabelSpec,
  OrchestratorOptions,
  OrchestratorResult,
  PhaseDefinition,
  PhaseTransitionRecord,
  PhaseType,
  PrioritizerConfig,
  RepoRef,
  SubjectRef,
  SubjectStoreConfig,
  TransformerDefinition,
  TransitionResult,
  ValidatorDefinition,
  WorkflowConfig,
  WorkflowRules,
} from "./workflow-types.ts";

// Workflow loader
export { loadWorkflow, loadWorkflowAsDecision } from "./workflow-loader.ts";

// Label resolver
export {
  resolveAgent,
  resolvePhase,
  resolveTerminalOrBlocking,
  stripPrefix,
} from "./label-resolver.ts";

// Phase transition
export {
  computeLabelChanges,
  computeTransition,
  renderTemplate,
} from "./phase-transition.ts";

// Cycle tracker
export { CycleTracker } from "./cycle-tracker.ts";

// GitHub client
export type {
  GitHubClient,
  IssueDetail,
  IssueListItem,
  LabelDetail,
} from "./github-client.ts";
export { GhCliClient } from "./github-client.ts";
export { FileGitHubClient } from "./file-github-client.ts";

// Label sync
export type { SyncAction, SyncOptions, SyncResult } from "./label-sync.ts";
export { decideLabelAction, summarizeSync, syncLabels } from "./label-sync.ts";

// Dispatcher
export type {
  AgentDispatcher,
  DispatchOptions,
  DispatchOutcome,
} from "./dispatcher.ts";
export { RunnerDispatcher, StubDispatcher } from "./dispatcher.ts";

// Subject store
export type { IssueComment, IssueData, IssueMeta } from "./subject-store.ts";
export { SubjectStore } from "./subject-store.ts";

// Issue syncer
export { IssueSyncer } from "./issue-syncer.ts";

// Outbox processor
export type {
  OutboxAction,
  OutboxResult,
  OutboxTrigger,
  ProjectFieldValue,
  ProjectRef,
} from "./outbox-processor.ts";
export { OutboxProcessor } from "./outbox-processor.ts";

// Prioritizer
export type { PrioritizerResult, PriorityAssignment } from "./prioritizer.ts";
export { Prioritizer } from "./prioritizer.ts";

// Queue
export type { QueueItem, QueuePriorityConfig } from "./queue.ts";
export { Queue } from "./queue.ts";

// Handoff manager
export { HandoffManager } from "./handoff-manager.ts";

// Rate limiter
export { RateLimiter } from "./rate-limiter.ts";

// Orchestrator
export { Orchestrator } from "./orchestrator.ts";

// Batch runner
export type { SingleIssueRunner } from "./batch-runner.ts";
export { BatchRunner } from "./batch-runner.ts";
