/**
 * Tests for agents/config/uv-reachability-validator.ts
 *
 * Covers validateUvReachability() with inline fixtures:
 * - All UV variables have CLI sources -> valid
 * - UV variable not in params (runtime) -> silently skipped
 * - Optional CLI param without default -> warning
 * - Empty uvVariables -> valid (skipped)
 * - No steps -> valid
 * - Mix of param and non-param variables
 * - Prefix substitution consistency (initial.* vs continuation.*)
 */

import { assert, assertEquals } from "@std/assert";
import { validateUvReachability } from "./uv-reachability-validator.ts";

// =============================================================================
// Helpers
// =============================================================================

/** Build a minimal steps registry with a single step entry. */
function registryWith(
  stepId: string,
  stepDef: Record<string, unknown>,
): Record<string, unknown> {
  return { steps: { [stepId]: stepDef } };
}

/** Build a steps registry with multiple step entries. */
function registryWithMultiple(
  entries: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  return { steps: entries };
}

/** Build a minimal agent definition with parameters. */
function agentWith(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  return { parameters };
}

// =============================================================================
// Tests
// =============================================================================

Deno.test("validateUvReachability - all UV variables have CLI sources -> valid", () => {
  const registry = registryWithMultiple({
    "initial.issue": { uvVariables: ["issue", "project"] },
    "continuation.issue": { uvVariables: ["issue", "project"] },
  });
  const agent = agentWith({
    issue: { required: true },
    project: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - UV variable not in params -> silently skipped (no error)", () => {
  const registry = registryWith("step.check", {
    uvVariables: ["iteration", "completed_iterations", "completion_keyword"],
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - UV variable not in any channel -> warning about no supply source", () => {
  // Use a non-initial prefix to avoid prefix substitution warnings
  const registry = registryWith("step.issue", {
    uvVariables: ["unknown_var"],
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 1);
  assertEquals(
    result.warnings[0].includes("no identified supply source"),
    true,
    `Expected warning about no supply source, got: ${result.warnings[0]}`,
  );
});

Deno.test("validateUvReachability - optional CLI param without default -> warning", () => {
  // Use a non-initial prefix to isolate the supply-source warning
  const registry = registryWith("step.issue", {
    uvVariables: ["issue"],
  });
  const agent = agentWith({
    issue: { required: false },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 1);
  assertEquals(
    result.warnings[0].includes("optional CLI parameter"),
    true,
    `Expected warning about optional CLI parameter, got: ${result.warnings[0]}`,
  );
});

Deno.test("validateUvReachability - required CLI param -> no warning", () => {
  const registry = registryWithMultiple({
    "initial.issue": { uvVariables: ["issue"] },
    "continuation.issue": { uvVariables: ["issue"] },
  });
  const agent = agentWith({
    issue: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - optional CLI param with default -> no warning", () => {
  const registry = registryWithMultiple({
    "initial.issue": { uvVariables: ["issue"] },
    "continuation.issue": { uvVariables: ["issue"] },
  });
  const agent = agentWith({
    issue: { required: false, default: "default_value" },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - empty uvVariables -> valid (skipped)", () => {
  // Use a non-initial prefix to avoid prefix substitution warnings
  const registry = registryWith("step.issue", {
    uvVariables: [],
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - missing uvVariables key -> valid (skipped)", () => {
  // Use a non-initial prefix to avoid prefix substitution warnings
  const registry = registryWith("step.issue", {
    c2: "step",
    c3: "issue",
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - no steps -> valid", () => {
  const registry: Record<string, unknown> = { steps: {} };
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - missing steps key -> valid", () => {
  const registry: Record<string, unknown> = {};
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - mix of param, runtime, and unknown variables -> warnings for unknown only", () => {
  // Use a non-initial prefix to isolate the check
  const registry = registryWith("step.issue", {
    uvVariables: ["issue", "iteration", "unknown_var", "another_missing"],
  });
  const agent = agentWith({
    issue: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  // "issue" is a required param -> OK (Channel 1)
  // "iteration" is a runtime variable -> OK (Channel 2)
  // "unknown_var", "another_missing" have no supply source -> warnings
  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 2);
  assertEquals(
    result.warnings[0].includes("unknown_var"),
    true,
    `Expected warning about unknown_var, got: ${result.warnings[0]}`,
  );
  assertEquals(
    result.warnings[1].includes("another_missing"),
    true,
    `Expected warning about another_missing, got: ${result.warnings[1]}`,
  );
});

Deno.test("validateUvReachability - multiple steps: runtime var OK, orphan var -> warning", () => {
  const registry: Record<string, unknown> = {
    steps: {
      "step.issue": {
        uvVariables: ["issue", "iteration"],
      },
      "step.check": {
        uvVariables: ["orphan_var"],
      },
    },
  };
  const agent = agentWith({
    issue: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  // "issue" is required param -> OK (Channel 1)
  // "iteration" is a runtime variable -> OK (Channel 2)
  // "orphan_var" has no supply source -> warning
  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 1);
  assertEquals(
    result.warnings[0].includes("orphan_var"),
    true,
    `Expected warning about orphan_var, got: ${result.warnings[0]}`,
  );
  assertEquals(
    result.warnings[0].includes("no identified supply source"),
    true,
    `Expected 'no identified supply source' in warning, got: ${
      result.warnings[0]
    }`,
  );
});

// =============================================================================
// Prefix substitution consistency tests
// =============================================================================

Deno.test("prefix substitution - matching uvVariables -> no warning", () => {
  const registry = registryWithMultiple({
    "initial.assess": { uvVariables: ["issue", "repo"] },
    "continuation.assess": { uvVariables: ["issue", "repo"] },
  });
  const agent = agentWith({
    issue: { required: true },
    repo: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("prefix substitution - different uvVariables -> warning about mismatch", () => {
  const registry = registryWithMultiple({
    "initial.assess": { uvVariables: ["issue", "repo"] },
    "continuation.assess": { uvVariables: ["issue"] },
  });
  const agent = agentWith({
    issue: { required: true },
    repo: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 1);
  assertEquals(
    result.warnings[0].includes("initial.assess"),
    true,
    `Expected warning to mention "initial.assess", got: ${result.warnings[0]}`,
  );
  assertEquals(
    result.warnings[0].includes("continuation.assess"),
    true,
    `Expected warning to mention "continuation.assess", got: ${
      result.warnings[0]
    }`,
  );
  assertEquals(
    result.warnings[0].includes("Prefix substitution"),
    true,
    `Expected warning about prefix substitution, got: ${result.warnings[0]}`,
  );
});

Deno.test("prefix substitution - initial.X exists but continuation.X missing -> warning", () => {
  const registry = registryWith("initial.assess", {
    uvVariables: ["issue"],
  });
  const agent = agentWith({
    issue: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 1);
  assertEquals(
    result.warnings[0].includes('steps["initial.assess"]'),
    true,
    `Expected warning to reference initial.assess, got: ${result.warnings[0]}`,
  );
  assertEquals(
    result.warnings[0].includes('steps["continuation.assess"] is missing'),
    true,
    `Expected warning about missing continuation step, got: ${
      result.warnings[0]
    }`,
  );
  assertEquals(
    result.warnings[0].includes("Default transition will fail"),
    true,
    `Expected warning about transition failure, got: ${result.warnings[0]}`,
  );
});

Deno.test("prefix substitution - continuation.X without initial.X -> no warning", () => {
  const registry = registryWith("continuation.assess", {
    uvVariables: ["issue"],
  });
  const agent = agentWith({
    issue: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("prefix substitution - no initial.* steps at all -> no warnings", () => {
  const registry = registryWithMultiple({
    "step.assess": { uvVariables: ["issue"] },
    "continuation.assess": { uvVariables: ["issue"] },
  });
  const agent = agentWith({
    issue: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("prefix substitution - multiple initial.* steps with mixed match/mismatch", () => {
  const registry = registryWithMultiple({
    "initial.assess": { uvVariables: ["issue", "repo"] },
    "continuation.assess": { uvVariables: ["issue", "repo"] },
    "initial.plan": { uvVariables: ["issue", "label"] },
    "continuation.plan": { uvVariables: ["issue"] },
    "initial.execute": { uvVariables: ["issue"] },
    // continuation.execute is missing
  });
  const agent = agentWith({
    issue: { required: true },
    repo: { required: true },
    label: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  // Two warnings: mismatch for plan + missing for execute
  assertEquals(result.warnings.length, 2);

  const mismatchWarning = result.warnings.find((w) =>
    w.includes("initial.plan")
  );
  assertEquals(
    mismatchWarning !== undefined,
    true,
    `Expected mismatch warning for initial.plan, got: ${
      JSON.stringify(result.warnings)
    }`,
  );
  assertEquals(
    mismatchWarning!.includes("Prefix substitution"),
    true,
    `Expected prefix substitution mention, got: ${mismatchWarning}`,
  );

  const missingWarning = result.warnings.find((w) =>
    w.includes("initial.execute")
  );
  assertEquals(
    missingWarning !== undefined,
    true,
    `Expected missing warning for initial.execute, got: ${
      JSON.stringify(result.warnings)
    }`,
  );
  assertEquals(
    missingWarning!.includes("continuation.execute"),
    true,
    `Expected mention of continuation.execute, got: ${missingWarning}`,
  );
  assertEquals(
    missingWarning!.includes("is missing"),
    true,
    `Expected "is missing" in warning, got: ${missingWarning}`,
  );
});

// =============================================================================
// Design invariant
// =============================================================================

Deno.test("uv-reachability validator is warnings-only by design", () => {
  // This validator never produces errors -- all issues are warnings.
  // If this test fails, a code change introduced errors where only warnings were intended.
  // Intentionally test with a scenario that triggers multiple warnings but confirm errors stay empty.
  const registry = registryWithMultiple({
    "initial.assess": { uvVariables: ["issue", "optional_param"] },
    "continuation.assess": { uvVariables: ["issue"] }, // mismatch -> prefix substitution warning
    "initial.plan": { uvVariables: ["issue"] },
    // continuation.plan missing -> missing continuation warning
    "step.check": { uvVariables: ["optional_param"] },
  });
  const agent = agentWith({
    issue: { required: true },
    optional_param: { required: false }, // optional without default -> supply-source warning
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "UV reachability validator should always return valid:true (warnings-only by design)",
  );
  assertEquals(
    result.errors.length,
    0,
    "UV reachability validator should never produce errors -- only warnings",
  );
  assert(
    result.warnings.length > 0,
    "Test fixture should trigger at least one warning to avoid vacuous pass",
  );
});

// =============================================================================
// Multi-Channel awareness tests (Channels 2/3/4)
// =============================================================================

Deno.test("Channel 2/3 - runtime-supplied variable matches -> no warning", () => {
  // All Channel 2 and Channel 3 runtime variables should pass without warning
  const allRuntimeVars = [
    // Channel 2: Runner runtime
    "iteration",
    "completed_iterations",
    "completion_keyword",
    // Channel 3: VerdictHandler
    "max_iterations",
    "remaining",
    "previous_summary",
    "check_count",
    "max_checks",
  ];

  const registry = registryWith("step.check", {
    uvVariables: allRuntimeVars,
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(
    result.warnings.length,
    0,
    `Runtime-supplied variables should not produce warnings, got: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

Deno.test("Channel 4 - UV variable supplied via inputs -> no warning", () => {
  // Step with inputs that derive a UV variable via stepId_key namespace
  const registry = registryWith("step.plan", {
    uvVariables: ["initial_issue_number"],
    inputs: {
      issue_number: { from: "initial.issue_number", required: true },
    },
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(
    result.warnings.length,
    0,
    `Channel 4 input-derived UV variable should not produce warnings, got: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

Deno.test("Channel 4 - UV variable from composite stepId inputs -> no warning", () => {
  // Composite stepId: dots replaced with underscores in UV key
  const registry = registryWith("step.execute", {
    uvVariables: ["initial_assess_summary"],
    inputs: {
      summary: { from: "initial.assess.summary", required: true },
    },
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(
    result.warnings.length,
    0,
    `Channel 4 composite stepId UV variable should not produce warnings, got: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

Deno.test("no channel supplies variable -> warning with descriptive message", () => {
  const registry = registryWith("step.process", {
    uvVariables: ["totally_unknown"],
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 1);

  const warning = result.warnings[0];
  assertEquals(
    warning.includes('Step "step.process"'),
    true,
    `Warning should reference step ID, got: ${warning}`,
  );
  assertEquals(
    warning.includes('"totally_unknown"'),
    true,
    `Warning should reference variable name, got: ${warning}`,
  );
  assertEquals(
    warning.includes("not a CLI parameter"),
    true,
    `Warning should mention CLI parameter, got: ${warning}`,
  );
  assertEquals(
    warning.includes("not a runtime variable"),
    true,
    `Warning should mention runtime variable, got: ${warning}`,
  );
  assertEquals(
    warning.includes("not an input handoff"),
    true,
    `Warning should mention input handoff, got: ${warning}`,
  );
});

Deno.test("all four channels combined - each channel covers its variables", () => {
  const registry = registryWith("step.combined", {
    uvVariables: [
      "issue", // Channel 1: CLI param
      "iteration", // Channel 2: runtime
      "max_iterations", // Channel 3: verdict handler
      "prev_result", // Channel 4: input handoff
      "mystery_var", // No channel -> warning
    ],
    inputs: {
      result: { from: "prev.result", required: true },
    },
  });
  const agent = agentWith({
    issue: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  // Only "mystery_var" should produce a warning
  assertEquals(
    result.warnings.length,
    1,
    `Expected exactly 1 warning for mystery_var, got ${result.warnings.length}: ${
      JSON.stringify(result.warnings)
    }`,
  );
  assertEquals(
    result.warnings[0].includes("mystery_var"),
    true,
    `Warning should reference mystery_var, got: ${result.warnings[0]}`,
  );
});
