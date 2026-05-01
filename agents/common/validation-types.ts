/**
 * Validation Types
 *
 * Type definitions for validation condition checking and partial retry.
 * Works in conjunction with the existing validators/ system.
 */

import type { StepRegistry } from "./step-registry.ts";

// ============================================================================
// FailurePattern - Failure pattern definitions for C3L integration
// ============================================================================

/**
 * Failure pattern definition
 * Provides mapping from pattern names to C3L prompt paths
 */
export interface FailurePattern {
  /** Description of the pattern */
  description: string;
  /** C3L edition (e.g., "failed") */
  edition: string;
  /** C3L adaptation (e.g., "git-dirty") */
  adaptation: string;
  /** Parameter names to inject into retry prompts */
  params: string[];
  /** Optional keywords or regex for fuzzy matching against error output */
  semanticMatch?: string[];
}

// ============================================================================
// Validator Phase
// ============================================================================

/**
 * Validator execution phase.
 *
 * - "preflight": Pure predicate evaluated BEFORE the LLM call. A preflight
 *   validator MUST NOT instruct the LLM to take an action — it only decides
 *   whether the closure step may proceed. On failure, the completion loop
 *   aborts (AgentValidationAbortError). Typical uses: external resource
 *   reachability, disk space, invariants the LLM cannot fix.
 *
 * - "postllm": Evaluated AFTER the LLM call. May produce a retry prompt that
 *   instructs the LLM to take corrective action (commit, fix tests, etc.).
 *   Failures feed the retry counter and obey onFailure.action.
 *
 * Phase is declared at validator registration time (ValidatorDefinition.phase)
 * and asserted at steps_registry load time against the wiring slot
 * (preflightConditions vs postLLMConditions).
 */
export type ValidatorPhase = "preflight" | "postllm";

// ============================================================================
// ValidatorDefinition - JSON-definable Validator specification
// ============================================================================

/**
 * Validator success conditions
 *
 * - "empty": Output is empty (git status --porcelain is empty)
 * - "exitCode:N": Exit code is N
 * - "contains:STRING": Output contains the string
 * - "matches:REGEX": Output matches the regex pattern
 */
export type SuccessCondition =
  | "empty"
  | `exitCode:${number}`
  | `contains:${string}`
  | `matches:${string}`;

/**
 * Parameter extraction rule names
 */
export type ExtractorType =
  | "parseChangedFiles"
  | "parseUntrackedFiles"
  | "parseTestOutput"
  | "parseTypeErrors"
  | "parseLintErrors"
  | "parseFormatOutput"
  | "extractFiles"
  | "generateDiff"
  | "stderr"
  | "stdout"
  | "exitCode"
  | "missingPaths"
  | "expectedPath"
  | "parseBranchName"
  | "parseRemoteStatus"
  | "parseMergeStatus";

/**
 * Validator type
 */
export type ValidatorType = "command" | "file" | "custom" | "semantic";

/**
 * Semantic check type
 *
 * Identifies which semantic heuristic to apply.
 * Extensible: new check types can be added without modifying dispatchers.
 */
export type SemanticCheckType =
  | "commit-message"
  | "coverage-check"
  | "file-relevance";

/**
 * Configuration for semantic validators
 *
 * Specifies which semantic check to perform.
 * Passed as part of ValidatorDefinition for type: "semantic".
 */
export interface SemanticValidatorConfig {
  /** Which semantic check to perform */
  checkType: SemanticCheckType;
}

/**
 * Declarative validator definition (JSON format)
 *
 * Execution logic is handled by StepValidator.
 */
export interface ValidatorDefinition {
  /** Validator type */
  type: ValidatorType;
  /**
   * Execution phase this validator may be wired into.
   *
   * Declarative contract: a validator with phase "preflight" may only be
   * referenced from ValidationStepConfig.preflightConditions; a validator
   * with phase "postllm" may only be referenced from postLLMConditions.
   * Mismatches are rejected at steps_registry load time.
   *
   * Phase may be omitted only for validators that are NOT wired into any
   * validation step. Referencing a phase-less validator from either
   * conditions array is a load-time error.
   */
  phase?: ValidatorPhase;
  /** For command type: command to execute */
  command?: string;
  /** For file type: path to check */
  path?: string;
  /** For semantic type: semantic check configuration */
  semanticConfig?: SemanticValidatorConfig;
  /** Success condition */
  successWhen: SuccessCondition;
  /** Pattern name on failure (key in failurePatterns) */
  failurePattern: string;
  /** Parameter extraction rules */
  extractParams: Record<string, ExtractorType | string>;
  /** Default recoverability when classifier cannot determine (default: true) */
  recoverableByDefault?: boolean;
}

// ============================================================================
// ValidationCondition - Step validation conditions
// ============================================================================

/**
 * Single validation condition
 */
export interface ValidationCondition {
  /** validator ID or key in validators */
  validator: string;
  /** Optional parameters for the validator */
  params?: Record<string, unknown>;
}

/**
 * Action on failure.
 *
 * Per design 16 §C the run-time error 3 classification splits failures into
 * ConfigurationError / ExecutionError / ConnectionError. An unrecoverable
 * post-LLM failure (formerly `"abort"`) is now thrown as an `ExecutionError`
 * (`AgentValidationAbortError`) — it is not a configurable action value.
 * The remaining 2 values are the only retry-policy choices left to config.
 */
export type FailureAction = "retry" | "skip";

/**
 * On-failure action configuration
 */
export interface OnFailureConfig {
  /** Action on failure */
  action: FailureAction;
  /** Maximum retry attempts (for retry action) */
  maxAttempts?: number;
}

// ============================================================================
// Response Format - Agent response format specification
// ============================================================================

/**
 * Response format specification for validation
 */
export interface ResponseFormat {
  /** Type of format to validate */
  type: "json" | "text-pattern";

  /** For json type: JSON Schema for validation */
  schema?: Record<string, unknown>;

  /** For text-pattern type: Regex pattern */
  pattern?: string;
}

// ============================================================================
// OutputSchemaRef - Reference to external schema file
// ============================================================================

/**
 * Reference to an external JSON Schema file
 */
export interface OutputSchemaRef {
  /** Schema file name (relative to the agent's schemas directory) */
  file: string;
  /** Schema name within the file (top-level key) */
  schema: string;
}

// ============================================================================
// ValidationStepConfig - Step configuration with validation conditions
// ============================================================================

/**
 * Step configuration with split pre-flight / post-LLM validation conditions.
 *
 * Two distinct condition slots are enforced structurally:
 *
 * - `preflightConditions` — evaluated BEFORE the LLM call. Pure predicates
 *   only. Cannot produce a retry prompt. Failure aborts the closure step.
 * - `postLLMConditions` — evaluated AFTER the LLM call. May produce a retry
 *   prompt that instructs the LLM to take action. Obeys onFailure.action
 *   and maxAttempts.
 *
 * Each condition's `validator` name must reference a ValidatorDefinition
 * whose `phase` matches its slot. Mismatches are rejected at load time.
 */
export interface ValidationStepConfig {
  /** Step ID */
  stepId: string;
  /** Display name */
  name?: string;
  /** C3L path component: c2 (retry, complete, etc.) */
  c2: string;
  /** C3L path component: c3 (issue, project, etc.) */
  c3: string;
  /**
   * Conditions evaluated BEFORE the LLM call (pure predicates, no retry
   * prompt). Each referenced validator must declare `phase: "preflight"`.
   */
  preflightConditions: ValidationCondition[];
  /**
   * Conditions evaluated AFTER the LLM call. May produce a retry prompt.
   * Each referenced validator must declare `phase: "postllm"`.
   */
  postLLMConditions: ValidationCondition[];
  /** Behavior on failure (applies to postLLMConditions only) */
  onFailure: OnFailureConfig;
  /**
   * JSON Schema for structured output (inline definition).
   * When specified, the query uses SDK's outputFormat parameter
   * to get validated JSON responses.
   */
  outputSchema?: Record<string, unknown>;
  /**
   * Reference to external JSON Schema file.
   * Alternative to inline outputSchema.
   */
  outputSchemaRef?: OutputSchemaRef;
  /** Description */
  description?: string;
}

// ============================================================================
// Phase-split validator results
// ============================================================================

/**
 * Pre-flight validator result.
 *
 * Pre-flight validators are pure predicates: they decide whether the closure
 * step may proceed. They cannot request LLM action, so this type does NOT
 * expose a retryPrompt field. A `reason` string is provided for diagnostics
 * (logging / abort message only) — it is never passed to the LLM.
 */
export interface PreFlightValidatorResult {
  /** Whether pre-flight validation passed */
  valid: boolean;
  /**
   * Human-readable diagnostic reason for failure.
   * Used for logging and AgentValidationAbortError message construction.
   * This is NEVER delivered to the LLM as an instruction.
   */
  reason?: string;
}

/**
 * Post-LLM validator result.
 *
 * Post-LLM validators run after the LLM call. They may produce a retry prompt
 * that instructs the LLM to take corrective action (e.g. commit, fix tests).
 * The retry counter and onFailure.action apply only to this phase.
 *
 * Note: the historical `ValidationResult` alias is preserved for ergonomic
 * consumers inside agents/runner.
 */
export interface PostLLMValidatorResult {
  /** Whether validation passed */
  valid: boolean;
  /** Retry prompt when validation failed (may instruct the LLM) */
  retryPrompt?: string;
  /** Format validation result (if applicable) */
  formatValidation?: FormatValidationResultLike;
  /** Failure action to take (only set when valid is false) */
  action?: FailureAction;
}

/**
 * Structural subset of FormatValidationResult used inside PostLLMValidatorResult.
 *
 * This is a type-only surface to avoid a runtime import cycle with
 * agents/loop/format-validator.ts. The concrete FormatValidationResult must
 * remain assignable to this shape.
 */
export interface FormatValidationResultLike {
  valid: boolean;
  error?: string;
}

// ============================================================================
// ValidatorResult - Validation result with pattern info
// ============================================================================

/**
 * Validation result with pattern and parameters
 *
 * Extended validation result including pattern and parameters for retry.
 */
/**
 * Semantic context for extracted parameters
 *
 * Provides structured, human-readable context derived from raw extraction
 * results. Enables retry prompts to include actionable information such as
 * severity, root cause, and suggested remediation.
 */
export interface SemanticParams {
  /** Raw extracted data (backward compatible) */
  raw: Record<string, unknown>;
  /** Human-readable summary of the failure */
  summary: string;
  /** Severity classification */
  severity: "info" | "warning" | "error" | "critical";
  /** Files most relevant to the failure */
  relatedFiles: string[];
  /** Inferred root cause (optional) */
  rootCause?: string;
  /** Suggested remediation action (optional) */
  suggestedAction?: string;
}

export interface ValidatorResult {
  /** Validation success/failure */
  valid: boolean;
  /** Pattern name on failure */
  pattern?: string;
  /** Additional failure patterns from subsequent validators (ranked by severity) */
  additionalPatterns?: string[];
  /** Extracted parameters (for retry prompt injection) */
  params?: Record<string, unknown>;
  /** Semantic context for the extracted parameters (optional) */
  semanticParams?: SemanticParams;
  /** Error message */
  error?: string;
  /** Detailed information */
  details?: string[];
  /** Whether the failure is recoverable (retryable) */
  recoverable?: boolean;
}

// ============================================================================
// ExtendedStepsRegistry - Registry with failure patterns
// ============================================================================

/**
 * Extended Steps Registry
 *
 * Extends existing StepRegistry with failurePatterns and validators.
 */
export interface ExtendedStepsRegistry extends StepRegistry {
  /** Failure pattern definitions */
  failurePatterns?: Record<string, FailurePattern>;

  /** Validator definitions */
  validators?: Record<string, ValidatorDefinition>;

  /** Step configurations with validation conditions */
  validationSteps?: Record<string, ValidationStepConfig>;
}

// ============================================================================
// Type guards
// ============================================================================

/**
 * Check if the step is a validation step configuration.
 *
 * A valid ValidationStepConfig has BOTH `preflightConditions` and
 * `postLLMConditions` as arrays (either may be empty). Legacy registries that
 * still reference the old single `validationConditions` field are rejected
 * by this guard — no backward compatibility.
 */
export function isValidationStepConfig(
  step: unknown,
): step is ValidationStepConfig {
  if (typeof step !== "object" || step === null) {
    return false;
  }
  const s = step as Record<string, unknown>;
  return (
    "preflightConditions" in s &&
    Array.isArray(s.preflightConditions) &&
    "postLLMConditions" in s &&
    Array.isArray(s.postLLMConditions)
  );
}

/**
 * Check if the registry is an extended registry
 *
 * A registry is considered "extended" if it has any of:
 * - failurePatterns (for ValidationChain validation)
 * - validators (for ValidationChain validation)
 * - steps with structuredGate (for Flow routing)
 */
export function isExtendedRegistry(
  registry: unknown,
): registry is ExtendedStepsRegistry {
  if (typeof registry !== "object" || registry === null) {
    return false;
  }

  // Check for ValidationChain support
  if ("failurePatterns" in registry || "validators" in registry) {
    return true;
  }

  // Check for Flow routing support (structuredGate in any step)
  if ("steps" in registry && typeof registry.steps === "object") {
    const steps = registry.steps as Record<string, unknown>;
    for (const step of Object.values(steps)) {
      if (
        typeof step === "object" &&
        step !== null &&
        "structuredGate" in step
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if the registry has ValidationChain support
 * (failurePatterns or validators)
 */
export function hasValidationChainSupport(
  registry: unknown,
): boolean {
  return (
    typeof registry === "object" &&
    registry !== null &&
    ("failurePatterns" in registry || "validators" in registry ||
      "validationSteps" in registry)
  );
}

/**
 * Check if the registry has Flow routing support
 * (at least one step with structuredGate)
 */
export function hasFlowRoutingSupport(
  registry: unknown,
): boolean {
  if (typeof registry !== "object" || registry === null) {
    return false;
  }

  if (!("steps" in registry) || typeof registry.steps !== "object") {
    return false;
  }

  const steps = registry.steps as Record<string, unknown>;
  for (const step of Object.values(steps)) {
    if (
      typeof step === "object" &&
      step !== null &&
      "structuredGate" in step
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Get pattern from validation result
 */
export function getPatternFromResult(
  result: ValidatorResult,
): string | undefined {
  return result.pattern;
}

// ============================================================================
// Command execution result
// ============================================================================

/**
 * Command execution result
 */
export interface CommandResult {
  /** Success flag */
  success: boolean;
  /** Exit code */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error output */
  stderr: string;
}
