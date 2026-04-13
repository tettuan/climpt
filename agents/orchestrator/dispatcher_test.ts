/**
 * Tests for dispatcher.ts
 *
 * Coverage:
 * - StubDispatcher: rateLimitInfo propagation, callCount, default outcome
 */

import { assertEquals } from "@std/assert";
import {
  composeRunnerArgs,
  extractHandoffData,
  mapResultToOutcome,
  StubDispatcher,
} from "./dispatcher.ts";
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

// === Verdict-based outcome tests ===

Deno.test("StubDispatcher: configured verdict string becomes outcome directly", async () => {
  const dispatcher = new StubDispatcher({ validator: "approved" });

  const result = await dispatcher.dispatch("validator", 1);

  assertEquals(result.outcome, "approved");
});

Deno.test("StubDispatcher: 'success' outcome preserved when no verdict", async () => {
  const dispatcher = new StubDispatcher({ transformer: "success" });

  const result = await dispatcher.dispatch("transformer", 1);

  assertEquals(result.outcome, "success");
});

Deno.test("StubDispatcher: 'failed' outcome preserved when agent fails", async () => {
  const dispatcher = new StubDispatcher({ transformer: "failed" });

  const result = await dispatcher.dispatch("transformer", 1);

  assertEquals(result.outcome, "failed");
});

// =============================================================================
// mapResultToOutcome: verdict-to-outcome mapping
// =============================================================================

Deno.test("mapResultToOutcome: verdict takes priority over success flag", () => {
  const outcome = mapResultToOutcome({ success: true, verdict: "approved" });
  assertEquals(outcome, "approved");
});

Deno.test("mapResultToOutcome: verdict takes priority over failed flag", () => {
  const outcome = mapResultToOutcome({ success: false, verdict: "rejected" });
  assertEquals(outcome, "rejected");
});

Deno.test("mapResultToOutcome: falls back to 'success' when no verdict", () => {
  const outcome = mapResultToOutcome({ success: true });
  assertEquals(outcome, "success");
});

Deno.test("mapResultToOutcome: falls back to 'failed' when no verdict", () => {
  const outcome = mapResultToOutcome({ success: false });
  assertEquals(outcome, "failed");
});

Deno.test("mapResultToOutcome: undefined verdict treated as absent", () => {
  const outcome = mapResultToOutcome({ success: true, verdict: undefined });
  assertEquals(outcome, "success");
});

// =============================================================================
// StubDispatcher: handoffData
// =============================================================================

Deno.test("StubDispatcher: returns configured handoffData", async () => {
  const handoffData = { summary: "All checks passed" };
  const dispatcher = new StubDispatcher(
    { myAgent: "approved" },
    undefined,
    handoffData,
  );

  const result = await dispatcher.dispatch("myAgent", 1);

  assertEquals(result.outcome, "approved");
  assertEquals(result.handoffData, { summary: "All checks passed" });
});

Deno.test("StubDispatcher: returns undefined handoffData when not configured", async () => {
  const dispatcher = new StubDispatcher({ myAgent: "success" });

  const result = await dispatcher.dispatch("myAgent", 1);

  assertEquals(result.handoffData, undefined);
});

Deno.test("StubDispatcher: handoffData coexists with rateLimitInfo", async () => {
  const rateLimitInfo: RateLimitInfo = {
    utilization: 0.5,
    resetsAt: 1700000000,
    rateLimitType: "seven_day",
  };
  const handoffData = { final_summary: "plan details" };
  const dispatcher = new StubDispatcher(
    { reviewer: "approved" },
    rateLimitInfo,
    handoffData,
  );

  const result = await dispatcher.dispatch("reviewer", 1);

  assertEquals(result.outcome, "approved");
  assertEquals(result.rateLimitInfo, rateLimitInfo);
  assertEquals(result.handoffData, { final_summary: "plan details" });
});

// =============================================================================
// extractHandoffData: contract tests
// Source of truth: stepsRegistry.handoffFields defines extraction targets
// =============================================================================

// Invariant: returns undefined when no closure step has handoffFields
Deno.test("extractHandoffData: no closure step with handoffFields → undefined", () => {
  const registry = [
    { stepKind: "work" as const, structuredGate: { handoffFields: ["x"] } },
    { stepKind: "closure" as const, structuredGate: { handoffFields: [] } },
  ];
  const result = { summaries: [{ structuredOutput: { x: "value" } }] };

  assertEquals(
    extractHandoffData(result, registry),
    undefined,
    "extractHandoffData must return undefined when no closure step has non-empty handoffFields. " +
      "Fix: add fields to closure step's structuredGate.handoffFields in steps_registry.json",
  );
});

// Invariant: returns undefined when structuredOutput is absent
Deno.test("extractHandoffData: no structuredOutput in last summary → undefined", () => {
  const registry = [
    {
      stepKind: "closure" as const,
      structuredGate: { handoffFields: ["final_summary"] },
    },
  ];
  const result = { summaries: [{/* no structuredOutput */}] };

  assertEquals(
    extractHandoffData(result, registry),
    undefined,
    "extractHandoffData must return undefined when last summary has no structuredOutput. " +
      "Fix: ensure agent closure step produces structured output",
  );
});

// Contract: every field in handoffFields that exists in structuredOutput appears in result
Deno.test("extractHandoffData: handoffFields select matching fields from structuredOutput", () => {
  const handoffFields = ["final_summary", "review_score"];
  const structuredOutput: Record<string, unknown> = {
    final_summary: "Implementation plan for feature X",
    review_score: "pass",
    internal_state: "should not appear",
    next_action: { action: "closing" },
  };
  const registry = [
    { stepKind: "closure" as const, structuredGate: { handoffFields } },
  ];
  const result = { summaries: [{ structuredOutput }] };

  const data = extractHandoffData(result, registry)!;

  // Relationship: every handoffField present in structuredOutput must appear in result
  for (const field of handoffFields) {
    assertEquals(
      field in structuredOutput && (field.split(".").pop()!) in data,
      true,
      `handoffField "${field}" exists in structuredOutput but missing from extractHandoffData result. ` +
        `Fix: check extractHandoffData in dispatcher.ts`,
    );
  }
  // Relationship: fields NOT in handoffFields must NOT appear
  assertEquals(
    "internal_state" in data,
    false,
    "Fields not listed in handoffFields must not leak into handoffData. " +
      "Fix: extractHandoffData in dispatcher.ts is extracting unlisted fields",
  );
});

// Contract: non-string values are JSON.stringified
Deno.test("extractHandoffData: non-string values are JSON-serialized", () => {
  const structuredOutput: Record<string, unknown> = {
    count: 42,
    details: { a: 1, b: 2 },
    label: "text-value",
  };
  const handoffFields = ["count", "details", "label"];
  const registry = [
    { stepKind: "closure" as const, structuredGate: { handoffFields } },
  ];
  const result = { summaries: [{ structuredOutput }] };

  const data = extractHandoffData(result, registry)!;

  // Invariant: all values in handoffData must be strings
  for (const [key, value] of Object.entries(data)) {
    assertEquals(
      typeof value,
      "string",
      `handoffData["${key}"] is ${typeof value}, expected string. ` +
        `Fix: extractHandoffData in dispatcher.ts must stringify non-string values`,
    );
  }
  // Relationship: string values pass through unchanged
  assertEquals(
    data.label,
    structuredOutput.label,
    "String values must pass through unchanged",
  );
  // Relationship: non-string values become JSON
  assertEquals(
    data.count,
    JSON.stringify(structuredOutput.count),
    "Non-string values must be JSON.stringified",
  );
  assertEquals(
    data.details,
    JSON.stringify(structuredOutput.details),
    "Object values must be JSON.stringified",
  );
});

// Contract: dot-notation paths use last segment as key
Deno.test("extractHandoffData: dot-notation path uses last segment as variable key", () => {
  const structuredOutput: Record<string, unknown> = {
    analysis: { understanding: "deep analysis content" },
  };
  const handoffFields = ["analysis.understanding"];
  const registry = [
    { stepKind: "closure" as const, structuredGate: { handoffFields } },
  ];
  const result = { summaries: [{ structuredOutput }] };

  const data = extractHandoffData(result, registry)!;

  // Relationship: key is last segment of path
  const expectedKey = handoffFields[0].split(".").pop()!;
  assertEquals(
    expectedKey in data,
    true,
    `Dot-notation path "${
      handoffFields[0]
    }" should produce key "${expectedKey}" ` +
      `but found keys: [${Object.keys(data).join(", ")}]. ` +
      `Fix: check extractHandoffData key derivation in dispatcher.ts`,
  );
  assertEquals(data[expectedKey], "deep analysis content");
});

// =============================================================================
// composeRunnerArgs: payload forwarding contract
// =============================================================================

Deno.test("composeRunnerArgs: payload keys populate runnerArgs", () => {
  const args = composeRunnerArgs(42, {
    payload: { customKey: "value", otherKey: 7 },
  });
  assertEquals(args.issue, 42);
  assertEquals(args.customKey, "value");
  assertEquals(args.otherKey, 7);
});

Deno.test("composeRunnerArgs: fixed keys win over payload on collision", () => {
  const args = composeRunnerArgs(42, {
    payload: { issue: 9999, iterateMax: 1, branch: "payload-branch" },
    iterateMax: 5,
    branch: "opts-branch",
  });
  assertEquals(
    args.issue,
    42,
    "issueNumber parameter must override payload.issue",
  );
  assertEquals(
    args.iterateMax,
    5,
    "options.iterateMax must override payload.iterateMax",
  );
  assertEquals(
    args.branch,
    "opts-branch",
    "options.branch must override payload.branch",
  );
});

Deno.test("composeRunnerArgs: omitted options yield a runnerArgs containing only issue", () => {
  const args = composeRunnerArgs(42);
  assertEquals(Object.keys(args).sort(), ["issue"]);
  assertEquals(args.issue, 42);
});

Deno.test("composeRunnerArgs: payload undefined leaves runnerArgs unchanged", () => {
  const args = composeRunnerArgs(42, { iterateMax: 3 });
  assertEquals(args, { issue: 42, iterateMax: 3 });
});

Deno.test("StubDispatcher: records DispatchOptions including payload", async () => {
  const dispatcher = new StubDispatcher({ myAgent: "success" });
  const payload = { verdictPath: "/tmp/verdict.json", prNumber: 123 };

  await dispatcher.dispatch("myAgent", 42, { payload, iterateMax: 3 });

  assertEquals(dispatcher.calls.length, 1);
  assertEquals(dispatcher.calls[0].agentId, "myAgent");
  assertEquals(dispatcher.calls[0].issueNumber, 42);
  assertEquals(dispatcher.calls[0].options?.payload, payload);
  assertEquals(dispatcher.calls[0].options?.iterateMax, 3);
});

// Invariant: missing fields in structuredOutput are silently skipped
Deno.test("extractHandoffData: missing field in structuredOutput → skipped, no error", () => {
  const structuredOutput: Record<string, unknown> = { present: "value" };
  const handoffFields = ["present", "absent"];
  const registry = [
    { stepKind: "closure" as const, structuredGate: { handoffFields } },
  ];
  const result = { summaries: [{ structuredOutput }] };

  const data = extractHandoffData(result, registry)!;

  assertEquals(
    "present" in data,
    true,
    "Present field must be extracted",
  );
  assertEquals(
    "absent" in data,
    false,
    "Absent field must be silently skipped, not cause an error. " +
      "Fix: extractHandoffData should skip undefined values without throwing",
  );
});
