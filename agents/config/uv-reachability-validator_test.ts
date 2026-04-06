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

Deno.test("validateUvReachability - UV variable not in params -> no error (assumed runtime)", () => {
  // Use a non-initial prefix to avoid prefix substitution warnings
  const registry = registryWith("step.issue", {
    uvVariables: ["unknown_var"],
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
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

Deno.test("validateUvReachability - mix of param and non-param variables -> no errors", () => {
  // Use a non-initial prefix to isolate the check
  const registry = registryWith("step.issue", {
    uvVariables: ["issue", "iteration", "unknown_var", "another_missing"],
  });
  const agent = agentWith({
    issue: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  // "issue" is a required param -> OK, no warning
  // "iteration", "unknown_var", "another_missing" are not in params -> silently skipped
  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - multiple steps with non-param variables -> no errors", () => {
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

  // "issue" is required param -> OK
  // "iteration", "orphan_var" not in params -> silently skipped
  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
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
  // See file header: "Variables not found in CLI parameters are silently skipped"
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
