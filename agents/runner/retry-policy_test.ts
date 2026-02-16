/**
 * Tests for retry-policy.ts
 *
 * Covers shouldRetry boundary conditions, calculateDelay, createRetryPolicy,
 * policy constants, and executeWithRetry behavior.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import {
  AGGRESSIVE_RETRY_POLICY,
  calculateDelay,
  createRetryPolicy,
  DEFAULT_RETRY_POLICY,
  delay,
  executeWithRetry,
  NO_RETRY_POLICY,
  shouldRetry,
} from "./retry-policy.ts";
import type { ClassifiedError } from "./error-classifier.ts";
import { SdkErrorCategory } from "./error-classifier.ts";

const logger = new BreakdownLogger("retry");

// =============================================================================
// Helpers
// =============================================================================

function createClassifiedError(
  overrides: Partial<ClassifiedError> = {},
): ClassifiedError {
  return {
    category: SdkErrorCategory.NETWORK,
    recoverable: true,
    guidance: "Retry later",
    matchedPattern: "ECONNREFUSED",
    original: new Error("test"),
    ...overrides,
  };
}

// =============================================================================
// shouldRetry Tests
// =============================================================================

Deno.test("shouldRetry - retries recoverable network error on first attempt", () => {
  const error = createClassifiedError();

  logger.debug("shouldRetry input", { attempt: 0, category: error.category });
  const decision = shouldRetry(error, 0, DEFAULT_RETRY_POLICY);
  logger.debug("shouldRetry result", decision);

  assertEquals(decision.retry, true);
  assertEquals(decision.delayMs > 0, true);
});

Deno.test("shouldRetry - denies retry when max retries reached", () => {
  const error = createClassifiedError();
  const policy = createRetryPolicy({ maxRetries: 3 });

  const decision = shouldRetry(error, 3, policy);

  assertEquals(decision.retry, false);
  assertEquals(decision.reason.includes("Max retries"), true);
});

Deno.test("shouldRetry - denies retry for non-recoverable error", () => {
  const error = createClassifiedError({ recoverable: false });

  const decision = shouldRetry(error, 0, DEFAULT_RETRY_POLICY);

  assertEquals(decision.retry, false);
  assertEquals(decision.reason.includes("not recoverable"), true);
});

Deno.test("shouldRetry - denies retry for non-retryable category", () => {
  const error = createClassifiedError({
    category: SdkErrorCategory.UNKNOWN,
    recoverable: true,
  });

  const decision = shouldRetry(error, 0, DEFAULT_RETRY_POLICY);

  assertEquals(decision.retry, false);
  assertEquals(decision.reason.includes("not retryable"), true);
});

Deno.test("shouldRetry - exponential backoff increases delay", () => {
  const error = createClassifiedError();
  const policy = createRetryPolicy({
    initialDelayMs: 100,
    backoffMultiplier: 2,
    maxDelayMs: 10000,
  });

  const d0 = shouldRetry(error, 0, policy);
  const d1 = shouldRetry(error, 1, policy);
  const d2 = shouldRetry(error, 2, policy);

  logger.debug("backoff delays", {
    d0: d0.delayMs,
    d1: d1.delayMs,
    d2: d2.delayMs,
  });

  assertEquals(d0.delayMs, 100); // 100 * 2^0
  assertEquals(d1.delayMs, 200); // 100 * 2^1
  assertEquals(d2.delayMs, 400); // 100 * 2^2
});

Deno.test("shouldRetry - delay capped at maxDelayMs", () => {
  const error = createClassifiedError();
  const policy = createRetryPolicy({
    initialDelayMs: 1000,
    backoffMultiplier: 10,
    maxDelayMs: 5000,
  });

  const decision = shouldRetry(error, 2, policy);

  assertEquals(decision.delayMs, 5000);
});

Deno.test("shouldRetry - API category is retryable with default policy", () => {
  const error = createClassifiedError({
    category: SdkErrorCategory.API,
    recoverable: true,
  });

  const decision = shouldRetry(error, 0, DEFAULT_RETRY_POLICY);

  assertEquals(decision.retry, true);
});

Deno.test("shouldRetry - ENVIRONMENT category is not retryable", () => {
  const error = createClassifiedError({
    category: SdkErrorCategory.ENVIRONMENT,
    recoverable: true,
  });

  const decision = shouldRetry(error, 0, DEFAULT_RETRY_POLICY);

  assertEquals(decision.retry, false);
});

// =============================================================================
// calculateDelay Tests
// =============================================================================

Deno.test("calculateDelay - returns initial delay for attempt 0", () => {
  const d = calculateDelay(0, DEFAULT_RETRY_POLICY);

  assertEquals(d, DEFAULT_RETRY_POLICY.initialDelayMs);
});

Deno.test("calculateDelay - respects max delay", () => {
  const policy = createRetryPolicy({
    initialDelayMs: 1000,
    backoffMultiplier: 10,
    maxDelayMs: 5000,
  });

  const d = calculateDelay(5, policy);

  assertEquals(d, 5000);
});

// =============================================================================
// createRetryPolicy Tests
// =============================================================================

Deno.test("createRetryPolicy - merges overrides with defaults", () => {
  const policy = createRetryPolicy({ maxRetries: 7 });

  assertEquals(policy.maxRetries, 7);
  assertEquals(policy.initialDelayMs, DEFAULT_RETRY_POLICY.initialDelayMs);
  assertEquals(
    policy.backoffMultiplier,
    DEFAULT_RETRY_POLICY.backoffMultiplier,
  );
});

Deno.test("createRetryPolicy - empty overrides returns defaults", () => {
  const policy = createRetryPolicy({});

  assertEquals(policy.maxRetries, DEFAULT_RETRY_POLICY.maxRetries);
  assertEquals(policy.maxDelayMs, DEFAULT_RETRY_POLICY.maxDelayMs);
});

// =============================================================================
// Policy Constants Tests
// =============================================================================

Deno.test("DEFAULT_RETRY_POLICY - has expected values", () => {
  assertEquals(DEFAULT_RETRY_POLICY.maxRetries, 3);
  assertEquals(DEFAULT_RETRY_POLICY.backoffMultiplier, 2);
  assertEquals(DEFAULT_RETRY_POLICY.retryableCategories.length >= 2, true);
});

Deno.test("NO_RETRY_POLICY - never retries", () => {
  assertEquals(NO_RETRY_POLICY.maxRetries, 0);
  assertEquals(NO_RETRY_POLICY.retryableCategories.length, 0);
});

Deno.test("AGGRESSIVE_RETRY_POLICY - has higher limits", () => {
  assertEquals(
    AGGRESSIVE_RETRY_POLICY.maxRetries > DEFAULT_RETRY_POLICY.maxRetries,
    true,
  );
  assertEquals(
    AGGRESSIVE_RETRY_POLICY.maxDelayMs > DEFAULT_RETRY_POLICY.maxDelayMs,
    true,
  );
});

// =============================================================================
// delay Tests
// =============================================================================

Deno.test("delay - resolves after specified time", async () => {
  const start = Date.now();
  await delay(5);
  const elapsed = Date.now() - start;

  assertEquals(elapsed >= 4, true); // Allow 1ms tolerance
});

// =============================================================================
// executeWithRetry Tests
// =============================================================================

Deno.test("executeWithRetry - succeeds on first try", async () => {
  let callCount = 0;
  const result = await executeWithRetry(
    async () => {
      callCount++;
      return "success";
    },
    () => createClassifiedError(),
    createRetryPolicy({ maxRetries: 3, initialDelayMs: 1 }),
  );

  assertEquals(result, "success");
  assertEquals(callCount, 1);
});

Deno.test("executeWithRetry - retries and succeeds", async () => {
  let callCount = 0;
  const result = await executeWithRetry(
    async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error("ECONNREFUSED");
      }
      return "recovered";
    },
    () => createClassifiedError(),
    createRetryPolicy({ maxRetries: 5, initialDelayMs: 1, maxDelayMs: 5 }),
  );

  logger.debug("executeWithRetry retry+succeed", { callCount, result });
  assertEquals(result, "recovered");
  assertEquals(callCount, 3);
});

Deno.test("executeWithRetry - throws for non-recoverable error", async () => {
  await assertRejects(
    async () => {
      await executeWithRetry(
        async () => {
          throw new Error("Permission denied");
        },
        () => createClassifiedError({ recoverable: false }),
        createRetryPolicy({ maxRetries: 3, initialDelayMs: 1 }),
      );
    },
    Error,
    "Permission denied",
  );
});

Deno.test("executeWithRetry - calls onRetry callback", async () => {
  const retryAttempts: number[] = [];
  let callCount = 0;

  await executeWithRetry(
    async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error("ETIMEDOUT");
      }
      return "ok";
    },
    () => createClassifiedError(),
    createRetryPolicy({ maxRetries: 5, initialDelayMs: 1, maxDelayMs: 5 }),
    (attempt) => {
      retryAttempts.push(attempt);
    },
  );

  logger.debug("onRetry callback", { retryAttempts });
  assertEquals(retryAttempts, [0, 1]);
});

Deno.test("executeWithRetry - exhausts max retries and throws", async () => {
  await assertRejects(
    async () => {
      await executeWithRetry(
        async () => {
          throw new Error("ECONNREFUSED");
        },
        () => createClassifiedError(),
        createRetryPolicy({ maxRetries: 2, initialDelayMs: 1, maxDelayMs: 2 }),
      );
    },
    Error,
    "ECONNREFUSED",
  );
});
