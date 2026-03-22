/**
 * Step Context Tests
 *
 * @design_ref agents/docs/design/05_core_architecture.md
 *
 * Tests namespace isolation for handoff data between steps.
 * Each step stores its output under its stepId key, preventing collisions.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { StepContextImpl } from "./step-context.ts";

// =============================================================================
// Namespace Isolation Tests (Design Doc: handoff namespace)
// =============================================================================

Deno.test("StepContext - stores outputs by stepId namespace", () => {
  const ctx = new StepContextImpl();

  ctx.set("initial.issue", { finding: "Bug in login" });
  ctx.set("continuation.issue", { fix: "Updated auth logic" });

  assertEquals(ctx.get("initial.issue", "finding"), "Bug in login");
  assertEquals(ctx.get("continuation.issue", "fix"), "Updated auth logic");
});

Deno.test("StepContext - different steps don't collide", () => {
  const ctx = new StepContextImpl();

  // Both steps have the same key "result"
  ctx.set("step.a", { result: "A result" });
  ctx.set("step.b", { result: "B result" });

  // Each step's data is isolated
  assertEquals(ctx.get("step.a", "result"), "A result");
  assertEquals(ctx.get("step.b", "result"), "B result");
});

Deno.test("StepContext - getAll returns entire step output", () => {
  const ctx = new StepContextImpl();

  ctx.set("initial.analysis", {
    understanding: "Problem identified",
    severity: "high",
    count: 5,
  });

  const output = ctx.getAll("initial.analysis");
  assertEquals(output, {
    understanding: "Problem identified",
    severity: "high",
    count: 5,
  });
});

Deno.test("StepContext - get returns undefined for missing step", () => {
  const ctx = new StepContextImpl();

  assertEquals(ctx.get("nonexistent.step", "key"), undefined);
});

Deno.test("StepContext - get returns undefined for missing key in existing step", () => {
  const ctx = new StepContextImpl();

  ctx.set("existing.step", { key1: "value1" });

  assertEquals(ctx.get("existing.step", "nonexistent"), undefined);
});

Deno.test("StepContext - getAll returns undefined for missing step", () => {
  const ctx = new StepContextImpl();

  assertEquals(ctx.getAll("nonexistent.step"), undefined);
});

Deno.test("StepContext - set overwrites previous data for same step", () => {
  const ctx = new StepContextImpl();

  ctx.set("step.x", { old: "data" });
  ctx.set("step.x", { new: "data" });

  assertEquals(ctx.get("step.x", "old"), undefined);
  assertEquals(ctx.get("step.x", "new"), "data");
});

Deno.test("StepContext - clear removes all stored outputs", () => {
  const ctx = new StepContextImpl();

  ctx.set("step.a", { data: "a" });
  ctx.set("step.b", { data: "b" });

  ctx.clear();

  assertEquals(ctx.getAll("step.a"), undefined);
  assertEquals(ctx.getAll("step.b"), undefined);
});

// =============================================================================
// UV Variable Conversion Tests (Design Doc: uv-stepId_key namespace)
// =============================================================================

Deno.test("StepContext - toUV converts inputs to UV variables with stepId_key namespace", () => {
  const ctx = new StepContextImpl();

  ctx.set("initial", { issue_number: 123, title: "Test" });

  const uv = ctx.toUV({
    issue_number: { from: "initial.issue_number", required: true },
    issue_title: { from: "initial.title" },
  });

  // UV keys use stepId_key namespace to avoid Channel 1 collision
  assertEquals(uv["initial_issue_number"], "123");
  assertEquals(uv["initial_title"], "Test");
});

Deno.test("StepContext - toUV uses default when value not found", () => {
  const ctx = new StepContextImpl();

  const uv = ctx.toUV({
    count: { from: "missing.step.count", default: "0" },
  });

  assertEquals(uv["missing_step_count"], "0");
});

Deno.test("StepContext - toUV throws when required value not found", () => {
  const ctx = new StepContextImpl();

  assertThrows(
    () =>
      ctx.toUV({
        required_field: { from: "missing.value", required: true },
      }),
    Error,
    "Required input 'required_field' not found",
  );
});

Deno.test("StepContext - toUV omits undefined values without default", () => {
  const ctx = new StepContextImpl();

  const uv = ctx.toUV({
    optional: { from: "missing.value" },
  });

  assertEquals(uv["optional"], undefined);
  assertEquals(Object.keys(uv).length, 0);
});

Deno.test("StepContext - toUV converts non-string values to string", () => {
  const ctx = new StepContextImpl();

  ctx.set("step", {
    number: 42,
    boolean: true,
    object: { nested: "value" },
  });

  const uv = ctx.toUV({
    num: { from: "step.number" },
    bool: { from: "step.boolean" },
    obj: { from: "step.object" },
  });

  assertEquals(uv["step_number"], "42");
  assertEquals(uv["step_boolean"], "true");
  assertEquals(uv["step_object"], "[object Object]");
});

Deno.test("StepContext - toUV handles composite stepIds with dot notation", () => {
  const ctx = new StepContextImpl();
  ctx.set("initial.issue", { status: "open", priority: "high" });

  const uv = ctx.toUV({
    my_status: { from: "initial.issue.status" },
    my_priority: { from: "initial.issue.priority" },
  });

  // composite stepId "initial.issue" → dots replaced → "initial_issue"
  assertEquals(uv["initial_issue_status"], "open");
  assertEquals(uv["initial_issue_priority"], "high");
});

Deno.test("StepContext - toUV throws on invalid from format", () => {
  const ctx = new StepContextImpl();

  assertThrows(
    () => ctx.toUV({ bad: { from: "nokey" } }),
    Error,
    "Invalid from format",
  );
});

// =============================================================================
// Handoff Data Flow Tests
// =============================================================================

Deno.test("StepContext - simulates multi-step handoff flow", () => {
  const ctx = new StepContextImpl();

  // Step A produces finding
  ctx.set("s_a", { finding: "Performance issue in query" });

  // Step B receives Step A's finding and produces fix
  const stepBInput = ctx.toUV({
    prior_finding: { from: "s_a.finding", required: true },
  });
  assertEquals(stepBInput["s_a_finding"], "Performance issue in query");

  ctx.set("s_b", { fix: "Added index", verification_needed: true });

  // Step C receives both A's finding and B's fix
  const stepCInput = ctx.toUV({
    finding: { from: "s_a.finding", required: true },
    fix: { from: "s_b.fix", required: true },
    needs_verify: { from: "s_b.verification_needed" },
  });

  assertEquals(stepCInput["s_a_finding"], "Performance issue in query");
  assertEquals(stepCInput["s_b_fix"], "Added index");
  assertEquals(stepCInput["s_b_verification_needed"], "true");
});

Deno.test("StepContext - stores structured output data as handoff", () => {
  const ctx = new StepContextImpl();

  // Simulates structured output from LLM stored as handoff
  const structuredOutput = {
    next_action: { action: "next", reason: "Analysis complete" },
    analysis: { understanding: "Found root cause" },
    issue: { number: 123 },
  };

  // Only handoff fields are stored (as specified by handoffFields config)
  ctx.set("initial.issue", {
    understanding: structuredOutput.analysis.understanding,
    issue_number: structuredOutput.issue.number,
  });

  assertEquals(ctx.get("initial.issue", "understanding"), "Found root cause");
  assertEquals(ctx.get("initial.issue", "issue_number"), 123);
});

// =============================================================================
// Data Immutability Tests
// =============================================================================

Deno.test("StepContext - set creates a copy of data", () => {
  const ctx = new StepContextImpl();

  const original = { key: "original" };
  ctx.set("step", original);

  // Modify original after set
  original.key = "modified";

  // Stored value should not change
  assertEquals(ctx.get("step", "key"), "original");
});
