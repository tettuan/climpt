/**
 * Tests for message-types.ts type guard functions.
 *
 * Coverage:
 * - isRateLimitEventMessage (rate limit event type guard)
 */

import { assertEquals } from "@std/assert";
import { isRateLimitEventMessage } from "./message-types.ts";

// =============================================================================
// isRateLimitEventMessage
// =============================================================================

Deno.test("isRateLimitEventMessage: valid rate_limit_event returns true", () => {
  const msg = {
    type: "rate_limit_event",
    rate_limit_info: {
      utilization: 0.85,
      resetsAt: 1700000000,
      rateLimitType: "seven_day",
    },
  };
  assertEquals(isRateLimitEventMessage(msg), true);
});

Deno.test("isRateLimitEventMessage: valid with optional fields returns true", () => {
  const msg = {
    type: "rate_limit_event",
    rate_limit_info: {
      utilization: 0.95,
      resetsAt: 1700000000,
      rateLimitType: "seven_day",
      status: "warning",
      isUsingOverage: false,
      surpassedThreshold: 0.9,
    },
  };
  assertEquals(isRateLimitEventMessage(msg), true);
});

Deno.test("isRateLimitEventMessage: missing rate_limit_info returns false", () => {
  const msg = {
    type: "rate_limit_event",
  };
  assertEquals(isRateLimitEventMessage(msg), false);
});

Deno.test("isRateLimitEventMessage: wrong type returns false", () => {
  const msg = {
    type: "assistant",
    rate_limit_info: {
      utilization: 0.85,
      resetsAt: 1700000000,
      rateLimitType: "seven_day",
    },
  };
  assertEquals(isRateLimitEventMessage(msg), false);
});

Deno.test("isRateLimitEventMessage: missing utilization returns false", () => {
  const msg = {
    type: "rate_limit_event",
    rate_limit_info: {
      resetsAt: 1700000000,
      rateLimitType: "seven_day",
    },
  };
  assertEquals(isRateLimitEventMessage(msg), false);
});

Deno.test("isRateLimitEventMessage: missing resetsAt returns false", () => {
  const msg = {
    type: "rate_limit_event",
    rate_limit_info: {
      utilization: 0.85,
      rateLimitType: "seven_day",
    },
  };
  assertEquals(isRateLimitEventMessage(msg), false);
});

Deno.test("isRateLimitEventMessage: missing rateLimitType returns false", () => {
  const msg = {
    type: "rate_limit_event",
    rate_limit_info: {
      utilization: 0.85,
      resetsAt: 1700000000,
    },
  };
  assertEquals(isRateLimitEventMessage(msg), false);
});

Deno.test("isRateLimitEventMessage: utilization is string returns false", () => {
  const msg = {
    type: "rate_limit_event",
    rate_limit_info: {
      utilization: "0.85",
      resetsAt: 1700000000,
      rateLimitType: "seven_day",
    },
  };
  assertEquals(isRateLimitEventMessage(msg), false);
});

Deno.test("isRateLimitEventMessage: rate_limit_info is string returns false", () => {
  const msg = {
    type: "rate_limit_event",
    rate_limit_info: "not an object",
  };
  assertEquals(isRateLimitEventMessage(msg), false);
});

Deno.test("isRateLimitEventMessage: null input returns false", () => {
  assertEquals(isRateLimitEventMessage(null), false);
});

Deno.test("isRateLimitEventMessage: undefined input returns false", () => {
  assertEquals(isRateLimitEventMessage(undefined), false);
});

Deno.test("isRateLimitEventMessage: non-object input returns false", () => {
  assertEquals(isRateLimitEventMessage("string"), false);
  assertEquals(isRateLimitEventMessage(42), false);
  assertEquals(isRateLimitEventMessage(true), false);
});
