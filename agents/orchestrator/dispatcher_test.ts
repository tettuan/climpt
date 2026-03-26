/**
 * Tests for dispatcher.ts
 *
 * Coverage:
 * - StubDispatcher: rateLimitInfo propagation, callCount, default outcome
 */

import { assertEquals } from "@std/assert";
import { StubDispatcher } from "./dispatcher.ts";
import type { RateLimitInfo } from "../src_common/types/runtime.ts";

// =============================================================================
// StubDispatcher: rateLimitInfo
// =============================================================================

Deno.test("StubDispatcher: returns configured rateLimitInfo", async () => {
  const rateLimitInfo: RateLimitInfo = {
    utilization: 0.92,
    resetsAt: 1700000000,
    rateLimitType: "seven_day",
  };
  const dispatcher = new StubDispatcher(
    { myAgent: "success" },
    rateLimitInfo,
  );

  const result = await dispatcher.dispatch("myAgent", 1);

  assertEquals(result.outcome, "success");
  assertEquals(result.rateLimitInfo, rateLimitInfo);
  assertEquals(result.durationMs, 0);
});

Deno.test("StubDispatcher: returns undefined rateLimitInfo when not configured", async () => {
  const dispatcher = new StubDispatcher({ myAgent: "success" });

  const result = await dispatcher.dispatch("myAgent", 1);

  assertEquals(result.outcome, "success");
  assertEquals(result.rateLimitInfo, undefined);
});

Deno.test("StubDispatcher: callCount increments per dispatch", async () => {
  const dispatcher = new StubDispatcher({ a: "ok", b: "ok" });

  assertEquals(dispatcher.callCount, 0);
  await dispatcher.dispatch("a", 1);
  assertEquals(dispatcher.callCount, 1);
  await dispatcher.dispatch("b", 2);
  assertEquals(dispatcher.callCount, 2);
});

Deno.test("StubDispatcher: unknown agent returns default 'success' outcome", async () => {
  const dispatcher = new StubDispatcher();

  const result = await dispatcher.dispatch("unknown-agent", 1);

  assertEquals(result.outcome, "success");
});
