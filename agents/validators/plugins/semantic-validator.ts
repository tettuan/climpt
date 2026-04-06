/**
 * Semantic Validator Base
 *
 * Plugin interface for semantic validators that check whether AI output
 * addresses the actual task using deterministic heuristics.
 *
 * Semantic validators are FAST: no shell commands, no file I/O beyond
 * what is passed in context. They operate purely on in-memory data.
 */

/**
 * Context provided to semantic validators
 *
 * Contains task-related information that validators use for
 * heuristic analysis. All fields except stepId are optional
 * because not all contexts have all information available.
 */
export interface SemanticValidatorContext {
  /** Step identifier that triggered validation */
  stepId: string;
  /** Human-readable task or issue description */
  taskDescription?: string;
  /** List of files changed in the current operation */
  changedFiles?: string[];
  /** Commit messages produced during the operation */
  commitMessages?: string[];
}

/**
 * Result from a semantic validator
 *
 * Unlike command validators, semantic validators produce severity
 * levels (info/warning/error) rather than binary pass/fail,
 * allowing callers to decide thresholds.
 */
export interface SemanticValidatorResult {
  /** Whether the validation passed */
  valid: boolean;
  /** Human-readable explanation of the result */
  message?: string;
  /** Severity level (default: "info" when valid, "warning" when invalid) */
  severity?: "info" | "warning" | "error";
}

/**
 * Semantic validator plugin interface
 *
 * Implementations must be:
 * - Deterministic (no randomness, no LLM calls)
 * - Fast (no shell commands, no disk I/O)
 * - Pure (no side effects beyond the returned result)
 */
export interface SemanticValidatorPlugin {
  /** Unique identifier for this plugin */
  readonly name: string;
  /** Perform semantic validation on the given context */
  validate(context: SemanticValidatorContext): SemanticValidatorResult;
}
