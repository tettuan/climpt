/**
 * Handoff E2E Data Path Verification
 *
 * Tests the full StepContext -> toUV -> UV variable data path
 * to verify that step handoff data is correctly namespaced and
 * collision-free.
 *
 * This is a contract verification step (no LLM required).
 */

import { StepContextImpl } from "../../../agents/loop/step-context.ts";
import type { InputSpec } from "../../../agents/src_common/contracts.ts";

// deno-lint-ignore no-console
const log = console.log;
// deno-lint-ignore no-console
const logErr = console.error;

let passed = 0;
let failed = 0;

function assert(
  testNum: number,
  name: string,
  condition: boolean,
  detail?: string,
): void {
  if (condition) {
    log(`  PASS [${testNum}]: ${name}`);
    passed++;
  } else {
    logErr(`  FAIL [${testNum}]: ${name}${detail ? " - " + detail : ""}`);
    failed++;
  }
}

log("=== Handoff E2E Data Path Verification ===\n");

// ---------------------------------------------------------------------------
// Test 1: Basic handoff - set data on step, retrieve via toUV
// ---------------------------------------------------------------------------
log("--- Test 1: Basic Handoff ---");
{
  const ctx = new StepContextImpl();
  ctx.set("initial", { summary: "Issue analysis complete", count: 42 });

  const inputs: InputSpec = {
    "prev_summary": { from: "initial.summary", required: true },
  };
  const uv = ctx.toUV(inputs);

  assert(
    1,
    "Basic handoff resolves value",
    uv["initial_summary"] === "Issue analysis complete",
  );
}

// ---------------------------------------------------------------------------
// Test 2: Composite stepId - dots in stepId are replaced with underscores
// ---------------------------------------------------------------------------
log("\n--- Test 2: Composite StepId ---");
{
  const ctx = new StepContextImpl();
  ctx.set("initial.issue", { status: "open", priority: "high" });

  const inputs: InputSpec = {
    "my_status": { from: "initial.issue.status", required: true },
    "my_priority": { from: "initial.issue.priority" },
  };
  const uv = ctx.toUV(inputs);

  assert(
    2,
    "Composite stepId 'initial.issue' produces UV key 'initial_issue_status'",
    uv["initial_issue_status"] === "open",
    `got key value: ${uv["initial_issue_status"]}`,
  );
  assert(
    3,
    "Second field from composite stepId resolves correctly",
    uv["initial_issue_priority"] === "high",
    `got key value: ${uv["initial_issue_priority"]}`,
  );
}

// ---------------------------------------------------------------------------
// Test 3: Required missing throws
// ---------------------------------------------------------------------------
log("\n--- Test 3: Required Missing Throws ---");
{
  const ctx = new StepContextImpl();
  // No data set for "nonexistent" step

  const inputs: InputSpec = {
    "missing_field": { from: "nonexistent.value", required: true },
  };

  let threw = false;
  let errorMsg = "";
  try {
    ctx.toUV(inputs);
  } catch (e) {
    threw = true;
    errorMsg = (e as Error).message;
  }

  assert(4, "Required missing input throws Error", threw);
  assert(
    5,
    "Error message includes input name",
    errorMsg.includes("missing_field"),
    `got: ${errorMsg}`,
  );
}

// ---------------------------------------------------------------------------
// Test 4: Default fallback
// ---------------------------------------------------------------------------
log("\n--- Test 4: Default Fallback ---");
{
  const ctx = new StepContextImpl();
  // No data set for "missing" step

  const inputs: InputSpec = {
    "fallback_field": { from: "missing.count", default: "fallback_value" },
  };
  const uv = ctx.toUV(inputs);

  assert(
    6,
    "Default value used when step data is missing",
    uv["missing_count"] === "fallback_value",
    `got: ${uv["missing_count"]}`,
  );
}

// ---------------------------------------------------------------------------
// Test 5: Multiple inputs resolve correctly
// ---------------------------------------------------------------------------
log("\n--- Test 5: Multiple Inputs ---");
{
  const ctx = new StepContextImpl();
  ctx.set("step_a", { finding: "Bug in login" });
  ctx.set("step_b", { fix: "Updated auth", verified: true });

  const inputs: InputSpec = {
    "a_finding": { from: "step_a.finding", required: true },
    "b_fix": { from: "step_b.fix", required: true },
    "b_verified": { from: "step_b.verified" },
  };
  const uv = ctx.toUV(inputs);

  assert(
    7,
    "First input from step_a resolves",
    uv["step_a_finding"] === "Bug in login",
  );
  assert(
    8,
    "Second input from step_b resolves",
    uv["step_b_fix"] === "Updated auth",
  );
  assert(
    9,
    "Boolean value converts to string",
    uv["step_b_verified"] === "true",
  );
}

// ---------------------------------------------------------------------------
// Test 6: Channel 1 collision prevention
// UV keys use stepId_key format, not bare varName. Two steps with the
// same key name produce distinct UV entries.
// ---------------------------------------------------------------------------
log("\n--- Test 6: Channel 1 Collision Prevention ---");
{
  const ctx = new StepContextImpl();
  ctx.set("step_a", { result: "A result" });
  ctx.set("step_b", { result: "B result" });

  const inputs: InputSpec = {
    "a_result": { from: "step_a.result" },
    "b_result": { from: "step_b.result" },
  };
  const uv = ctx.toUV(inputs);

  // UV keys are stepId_key, not the varName
  assert(
    10,
    "step_a.result -> UV key 'step_a_result'",
    uv["step_a_result"] === "A result",
  );
  assert(
    11,
    "step_b.result -> UV key 'step_b_result'",
    uv["step_b_result"] === "B result",
  );
  assert(
    12,
    "No bare varName key 'a_result' in UV output",
    !("a_result" in uv),
    `unexpected key 'a_result' found with value: ${uv["a_result"]}`,
  );
  assert(
    13,
    "No bare varName key 'b_result' in UV output",
    !("b_result" in uv),
    `unexpected key 'b_result' found with value: ${uv["b_result"]}`,
  );
  assert(
    14,
    "Distinct UV keys prevent collision between same-named fields",
    uv["step_a_result"] !== uv["step_b_result"],
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
log(`\nSummary: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  Deno.exit(1);
}
