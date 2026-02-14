/**
 * Shared Constants
 *
 * Centralized numeric constants extracted from the codebase.
 * All magic numbers for iteration limits, retry policies, and log truncation
 * should be defined here and imported where needed.
 */

/**
 * Agent iteration and failure limits
 */
export const AGENT_LIMITS = {
  /** Default maxIterations for iterationBudget completion type (used in config/defaults.ts) */
  DEFAULT_MAX_ITERATIONS: 10,
  /** Fallback maxIterations when completionConfig doesn't specify (used in runner.ts getMaxIterations) */
  FALLBACK_MAX_ITERATIONS: 20,
  /** Fallback maxIterations for completion handlers (factory.ts, composite.ts) */
  COMPLETION_FALLBACK_MAX_ITERATIONS: 100,
  /** Maximum consecutive rate-limit retries before aborting */
  MAX_RATE_LIMIT_RETRIES: 5,
  /** Maximum consecutive schema resolution failures before aborting (2-strike rule) */
  MAX_SCHEMA_FAILURES: 2,
} as const;

/**
 * Default retry policy values
 */
export const RETRY_DELAYS = {
  /** Default initial delay for retry backoff (ms) */
  DEFAULT_INITIAL_DELAY_MS: 1000,
  /** Default maximum delay for retry backoff (ms) */
  DEFAULT_MAX_DELAY_MS: 30000,
  /** Default maximum retry attempts */
  DEFAULT_MAX_RETRIES: 3,
  /** Aggressive retry initial delay (ms) */
  AGGRESSIVE_INITIAL_DELAY_MS: 500,
  /** Aggressive retry maximum delay (ms) */
  AGGRESSIVE_MAX_DELAY_MS: 60000,
  /** Aggressive maximum retry attempts */
  AGGRESSIVE_MAX_RETRIES: 5,
  /** Base delay for exponential backoff in error-classifier (ms) */
  BACKOFF_BASE_DELAY_MS: 5000,
  /** Maximum delay for exponential backoff in error-classifier (ms) */
  BACKOFF_MAX_DELAY_MS: 60000,
} as const;

/**
 * Log and display truncation lengths (character counts)
 */
export const TRUNCATION = {
  /** Bash command summary truncation (runner.ts, common/logger.ts) */
  BASH_COMMAND: 100,
  /** JSON/assistant content summary truncation (logger, completion/types.ts) */
  JSON_SUMMARY: 200,
  /** User prompt content truncation (src_common/logger.ts) */
  USER_CONTENT: 500,
  /** Last assistant response truncation in iteration context (completion/types.ts) */
  ASSISTANT_RESPONSE: 1000,
} as const;
