/**
 * Retry Policy
 *
 * Defines retry behavior for recoverable SDK errors.
 * Uses exponential backoff with configurable parameters.
 */

import type { ClassifiedError } from "./error-classifier.ts";
import { SdkErrorCategory } from "./error-classifier.ts";

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  /** Maximum retry attempts */
  maxRetries: number;
  /** Initial delay in milliseconds */
  initialDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Error categories that can be retried */
  retryableCategories: SdkErrorCategory[];
}

/**
 * Result of retry decision
 */
export interface RetryDecision {
  /** Whether to retry */
  retry: boolean;
  /** Delay before retry in milliseconds */
  delayMs: number;
  /** Reason for decision */
  reason: string;
}

/**
 * Default retry policy
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableCategories: [
    SdkErrorCategory.NETWORK,
    SdkErrorCategory.API,
    SdkErrorCategory.INTERNAL,
  ],
};

/**
 * No retry policy (for immediate failure)
 */
export const NO_RETRY_POLICY: RetryPolicy = {
  maxRetries: 0,
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 1,
  retryableCategories: [],
};

/**
 * Aggressive retry policy (for critical operations)
 */
export const AGGRESSIVE_RETRY_POLICY: RetryPolicy = {
  maxRetries: 5,
  initialDelayMs: 500,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  retryableCategories: [
    SdkErrorCategory.NETWORK,
    SdkErrorCategory.API,
    SdkErrorCategory.INTERNAL,
  ],
};

/**
 * Determine if an error should be retried
 */
export function shouldRetry(
  error: ClassifiedError,
  attempt: number,
  policy: RetryPolicy,
): RetryDecision {
  // Check max retries
  if (attempt >= policy.maxRetries) {
    return {
      retry: false,
      delayMs: 0,
      reason: "Max retries (" + policy.maxRetries + ") reached",
    };
  }

  // Check if error is recoverable
  if (!error.recoverable) {
    return {
      retry: false,
      delayMs: 0,
      reason: "Error is not recoverable: " + error.category,
    };
  }

  // Check if category is retryable
  if (!policy.retryableCategories.includes(error.category)) {
    return {
      retry: false,
      delayMs: 0,
      reason: "Category " + error.category + " is not retryable",
    };
  }

  // Calculate delay with exponential backoff
  const delayMs = Math.min(
    policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt),
    policy.maxDelayMs,
  );

  return {
    retry: true,
    delayMs,
    reason: "Retry " + (attempt + 1) + "/" + policy.maxRetries + " in " +
      delayMs + "ms",
  };
}

/**
 * Calculate delay for a specific attempt
 */
export function calculateDelay(attempt: number, policy: RetryPolicy): number {
  return Math.min(
    policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt),
    policy.maxDelayMs,
  );
}

/**
 * Create a custom retry policy
 */
export function createRetryPolicy(
  overrides: Partial<RetryPolicy>,
): RetryPolicy {
  return {
    ...DEFAULT_RETRY_POLICY,
    ...overrides,
  };
}

/**
 * Async delay utility
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 *
 * Note: This function intentionally uses await inside a loop for sequential retry
 * with exponential backoff. Each attempt must complete before the next starts.
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  classifyError: (error: Error) => ClassifiedError,
  policy: RetryPolicy,
  onRetry?: (attempt: number, delayMs: number, error: ClassifiedError) => void,
): Promise<T> {
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= policy.maxRetries) {
    try {
      // deno-lint-ignore no-await-in-loop
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;
      const classified = classifyError(error);

      const decision = shouldRetry(classified, attempt, policy);

      if (!decision.retry) {
        throw error;
      }

      onRetry?.(attempt, decision.delayMs, classified);
      // deno-lint-ignore no-await-in-loop
      await delay(decision.delayMs);
      attempt++;
    }
  }

  throw lastError ?? new Error("Max retries exceeded");
}
