/**
 * Shared Error Hierarchy - Public Exports
 *
 * All Climpt errors extend ClimptError, which provides:
 * - `code`: programmatic error code
 * - `recoverable`: whether retry/recovery is possible
 * - `iteration`: optional iteration context
 * - `toJSON()`: structured representation for logging
 *
 * Domain groupings:
 * - base: ClimptError (abstract), AgentError (alias), type guards
 * - runner-errors: query, verdict, timeout, max iterations, retryable
 * - flow-errors: schema resolution, step routing, gate interpretation
 * - env-errors: environment constraints, rate limits, config, prompt
 * - git-errors: git command failures
 */

// Base
export {
  AgentError,
  ClimptError,
  isAgentError,
  isClimptError,
} from "./base.ts";

// Runner errors
export {
  AgentMaxIterationsError,
  AgentNotInitializedError,
  AgentQueryError,
  AgentRetryableQueryError,
  AgentTimeoutError,
  AgentValidationAbortError,
  AgentVerdictError,
  normalizeToAgentError,
} from "./runner-errors.ts";

// Re-export SdkErrorCategoryType from runner-errors for backward compat
export type { SdkErrorCategoryType as RunnerSdkErrorCategoryType } from "./runner-errors.ts";

// Flow errors
export {
  AgentSchemaResolutionError,
  AgentStepIdMismatchError,
  AgentStepRoutingError,
  GateInterpretationError,
  MalformedSchemaIdentifierError,
  RoutingError,
  SchemaCircularReferenceError,
  SchemaPointerError,
} from "./flow-errors.ts";

// Environment errors
export { AgentEnvironmentError, AgentRateLimitError } from "./env-errors.ts";
export type {
  EnvironmentInfoType,
  SdkErrorCategoryType,
} from "./env-errors.ts";

// Git errors
export { GitCommandError } from "./git-errors.ts";

// Config errors
export {
  acLoadInvalid,
  acLoadNotFound,
  acLoadParseFailed,
  acServiceFileNotFound,
  acServiceInvalidJson,
  acServiceLoadFailed,
  acServiceRegistryLoadFailed,
  acValidFailed,
  acValidIncomplete,
  acVerdict001PollStateRequiresIssue,
  acVerdict002DetectStructuredRequiresSignalType,
  acVerdict003CompositeRequiresConditionsAndOperator,
  acVerdict004CustomRequiresHandlerPath,
  acVerdict005UnknownCompletionType,
  acVerdict006CustomHandlerMustExportFactory,
  acVerdict007FailedToLoadCustomHandler,
  acVerdict008DetectStructuredConditionRequiresSignalType,
  acVerdict009PollStateConditionRequiresIssue,
  acVerdict010UnsupportedConditionTypeInComposite,
  BREAKDOWN_DETAIL_PREFIX,
  ConfigError,
  isPromptFileNotFound,
  prC3lBreakdownFailed,
  prC3lInvalidPathFormat,
  prC3lNoPrompt,
  prC3lPromptNotFound,
  prFileNotFound,
  prResolveMissingInputText,
  prResolveMissingRequiredUv,
  prResolveUnknownStepId,
  prResolveUvNotProvided,
  prSystemPromptLoadFailed,
  srEntryMappingInvalid,
  srEntryMissingConfig,
  srEntryNotConfigured,
  srEntryStepNotFound,
  srGateFlowValidationFailed,
  srGateNoEntryStep,
  srGateNoRoutedStepId,
  srGateNoStructuredGateSteps,
  srIntentNotAllowed,
  srLoadAgentIdMismatch,
  srLoadNotFound,
  srTransEscalateInvalid,
  srTransEscalateNoTransition,
  srTransEscalateTargetNotFound,
  srTransHandoffNoTransition,
  srTransHandoffNullTarget,
  srTransHandoffTargetNotFound,
  srTransJumpTargetNotFound,
  srTransNoContinuation,
  srTransTargetNotFound,
  srTransTerminalNotAllowed,
  srValidIntentSchemaEnumMismatch,
  srValidIntentSchemaRef,
  srValidRegistryFailed,
  srValidStepKindIntentMismatch,
  wfLabelMappingEmpty,
  wfLabelUnknownPhase,
  wfLoadInvalidJson,
  wfLoadNotFound,
  wfLoadReadFailed,
  wfPhaseAgentRequired,
  wfPhaseInvalidType,
  wfPhasePriorityRequired,
  wfRefCloseConditionWithoutCloseOnComplete,
  wfRefInvalidCloseCondition,
  wfRefUnknownAgent,
  wfRefUnknownFallbackPhase,
  wfRefUnknownOutputPhase,
  wfRefUnknownOutputPhasesEntry,
  wfRuleCycleDelayInvalid,
  wfRuleMaxCyclesInvalid,
  wfSchemaAgentsRequired,
  wfSchemaLabelMappingRequired,
  wfSchemaPhasesRequired,
  wfSchemaVersionRequired,
} from "./config-errors.ts";
