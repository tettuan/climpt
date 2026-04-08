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
import {
  MSG_DEFAULT_TRANSITION_FAIL,
  MSG_NO_SUPPLY_SOURCE,
  MSG_OPTIONAL_CLI_NO_DEFAULT,
  MSG_PR_RESOLVE,
  MSG_PREFIX_SUBSTITUTION,
  validateUvReachability,
} from "./uv-reachability-validator.ts";

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
  const uvVars = ["issue", "project"];
  const registry = registryWithMultiple({
    "initial.issue": { uvVariables: uvVars },
    "continuation.issue": { uvVariables: uvVars },
  });
  const agent = agentWith({
    issue: { required: true },
    project: { required: true },
  });
  assert(
    uvVars.length > 0,
    "Test fixture must declare UV variables to avoid vacuous pass",
  );

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "All UV variables have CLI sources, should be valid (fix: uv-reachability-validator.ts Channel 1 logic)",
  );
  assertEquals(
    result.errors.length,
    0,
    "No errors expected when all variables are CLI-supplied (fix: uv-reachability-validator.ts Channel 1 logic)",
  );
  assertEquals(
    result.warnings.length,
    0,
    "No warnings expected for required CLI params (fix: uv-reachability-validator.ts Channel 1 optionality check)",
  );
});

Deno.test("validateUvReachability - UV variable not in params -> silently skipped (no error)", () => {
  const runtimeVars = [
    "iteration",
    "completed_iterations",
    "completion_keyword",
  ];
  const registry = registryWith("step.check", {
    uvVariables: runtimeVars,
  });
  const agent = agentWith({});
  assert(
    runtimeVars.length > 0,
    "Test fixture must declare runtime variables to avoid vacuous pass",
  );

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "Runtime variables should be valid (fix: uv-reachability-validator.ts Channel 2/3 recognition)",
  );
  assertEquals(
    result.errors.length,
    0,
    "No errors expected for runtime-supplied variables (fix: uv-reachability-validator.ts RUNTIME_SUPPLIED_UV_VARS check)",
  );
  assertEquals(
    result.warnings.length,
    0,
    "No warnings expected for runtime-supplied variables (fix: uv-reachability-validator.ts Channel 2/3 logic)",
  );
});

Deno.test("validateUvReachability - UV variable not in any channel -> error about no supply source", () => {
  // Use a non-initial prefix to avoid prefix substitution warnings
  const unknownVars = ["unknown_var"];
  const registry = registryWith("step.issue", {
    uvVariables: unknownVars,
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    false,
    "Should be invalid when UV variable has no supply source (fix: uv-reachability-validator.ts supply-check logic)",
  );
  assertEquals(
    result.errors.length,
    unknownVars.length,
    `Expected one error per unknown UV variable (${unknownVars.length} unknown vars) (fix: uv-reachability-validator.ts no-supply-source error emission)`,
  );
  assertEquals(
    result.warnings.length,
    0,
    "No warnings expected for unknown variables (fix: uv-reachability-validator.ts warning vs error classification)",
  );
  assertEquals(
    result.errors[0].includes(MSG_NO_SUPPLY_SOURCE),
    true,
    `Expected error about ${MSG_NO_SUPPLY_SOURCE} (fix: uv-reachability-validator.ts supply-check logic). Got: ${
      result.errors[0]
    }`,
  );
  assertEquals(
    result.errors[0].includes(MSG_PR_RESOLVE),
    true,
    `Expected error to mention ${MSG_PR_RESOLVE} (fix: uv-reachability-validator.ts error message format). Got: ${
      result.errors[0]
    }`,
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

  assertEquals(
    result.valid,
    true,
    "Optional param warning should not make result invalid (fix: uv-reachability-validator.ts valid flag logic)",
  );
  assertEquals(
    result.errors.length,
    0,
    "Optional param should produce warning, not error (fix: uv-reachability-validator.ts warning vs error classification)",
  );
  assertEquals(
    result.warnings.length,
    1,
    "Expected exactly 1 warning for the optional param without default (fix: uv-reachability-validator.ts Channel 1 optionality check)",
  );
  assertEquals(
    result.warnings[0].includes(MSG_OPTIONAL_CLI_NO_DEFAULT),
    true,
    `Expected warning about ${MSG_OPTIONAL_CLI_NO_DEFAULT} (fix: uv-reachability-validator.ts Channel 1 optionality check). Got: ${
      result.warnings[0]
    }`,
  );
});

Deno.test("validateUvReachability - required CLI param -> no warning", () => {
  const uvVars = ["issue"];
  const registry = registryWithMultiple({
    "initial.issue": { uvVariables: uvVars },
    "continuation.issue": { uvVariables: uvVars },
  });
  const agent = agentWith({
    issue: { required: true },
  });
  assert(
    uvVars.length > 0,
    "Test fixture must declare UV variables to avoid vacuous pass",
  );

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "Required CLI param should be valid (fix: uv-reachability-validator.ts Channel 1 logic)",
  );
  assertEquals(
    result.errors.length,
    0,
    "No errors expected for required CLI params (fix: uv-reachability-validator.ts Channel 1 logic)",
  );
  assertEquals(
    result.warnings.length,
    0,
    "Required CLI param should not produce warnings (fix: uv-reachability-validator.ts Channel 1 optionality check)",
  );
});

Deno.test("validateUvReachability - optional CLI param with default -> no warning", () => {
  const uvVars = ["issue"];
  const registry = registryWithMultiple({
    "initial.issue": { uvVariables: uvVars },
    "continuation.issue": { uvVariables: uvVars },
  });
  const agent = agentWith({
    issue: { required: false, default: "default_value" },
  });
  assert(
    uvVars.length > 0,
    "Test fixture must declare UV variables to avoid vacuous pass",
  );

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "Optional param with default should be valid (fix: uv-reachability-validator.ts Channel 1 default check)",
  );
  assertEquals(
    result.errors.length,
    0,
    "No errors expected for optional param with default (fix: uv-reachability-validator.ts Channel 1 logic)",
  );
  assertEquals(
    result.warnings.length,
    0,
    "Optional param with default should not produce warnings (fix: uv-reachability-validator.ts Channel 1 optionality check)",
  );
});

Deno.test("validateUvReachability - empty uvVariables -> valid (skipped)", () => {
  // Use a non-initial prefix to avoid prefix substitution warnings
  const registry = registryWith("step.issue", {
    uvVariables: [],
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "Empty uvVariables should be valid (fix: uv-reachability-validator.ts early-exit guard)",
  );
  assertEquals(
    result.errors.length,
    0,
    "Empty uvVariables should produce no errors (fix: uv-reachability-validator.ts early-exit guard)",
  );
  assertEquals(
    result.warnings.length,
    0,
    "Empty uvVariables should produce no warnings (fix: uv-reachability-validator.ts early-exit guard)",
  );
});

Deno.test("validateUvReachability - missing uvVariables key -> valid (skipped)", () => {
  // Use a non-initial prefix to avoid prefix substitution warnings
  const registry = registryWith("step.issue", {
    c2: "step",
    c3: "issue",
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "Missing uvVariables key should be valid (fix: uv-reachability-validator.ts Array.isArray guard)",
  );
  assertEquals(
    result.errors.length,
    0,
    "Missing uvVariables key should produce no errors (fix: uv-reachability-validator.ts Array.isArray guard)",
  );
  assertEquals(
    result.warnings.length,
    0,
    "Missing uvVariables key should produce no warnings (fix: uv-reachability-validator.ts Array.isArray guard)",
  );
});

Deno.test("validateUvReachability - no steps -> valid", () => {
  const registry: Record<string, unknown> = { steps: {} };
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "Empty steps should be valid (fix: uv-reachability-validator.ts step iteration)",
  );
  assertEquals(
    result.errors.length,
    0,
    "Empty steps should produce no errors (fix: uv-reachability-validator.ts step iteration)",
  );
  assertEquals(
    result.warnings.length,
    0,
    "Empty steps should produce no warnings (fix: uv-reachability-validator.ts prefix substitution loop)",
  );
});

Deno.test("validateUvReachability - missing steps key -> valid", () => {
  const registry: Record<string, unknown> = {};
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "Missing steps key should be valid (fix: uv-reachability-validator.ts asRecord fallback)",
  );
  assertEquals(
    result.errors.length,
    0,
    "Missing steps key should produce no errors (fix: uv-reachability-validator.ts asRecord fallback)",
  );
  assertEquals(
    result.warnings.length,
    0,
    "Missing steps key should produce no warnings (fix: uv-reachability-validator.ts asRecord fallback)",
  );
});

Deno.test("validateUvReachability - mix of param, runtime, and unknown variables -> errors for unknown only", () => {
  // Use a non-initial prefix to isolate the check
  const unknownVars = ["unknown_var", "another_missing"];
  const registry = registryWith("step.issue", {
    uvVariables: ["issue", "iteration", ...unknownVars],
  });
  const agent = agentWith({
    issue: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  // "issue" is a required param -> OK (Channel 1)
  // "iteration" is a runtime variable -> OK (Channel 2)
  // unknownVars have no supply source -> errors
  assertEquals(
    result.valid,
    false,
    "Should be invalid when UV variables have no supply source (fix: uv-reachability-validator.ts supply-check logic)",
  );
  assertEquals(
    result.errors.length,
    unknownVars.length,
    `Expected one error per unknown UV variable (${unknownVars.length} unknown vars) (fix: uv-reachability-validator.ts no-supply-source error emission)`,
  );
  assertEquals(
    result.warnings.length,
    0,
    "No warnings expected for unknown variables (fix: uv-reachability-validator.ts warning vs error classification)",
  );
  assertEquals(
    result.errors[0].includes(unknownVars[0]),
    true,
    `Expected error about ${
      unknownVars[0]
    } (fix: uv-reachability-validator.ts error message format). Got: ${
      result.errors[0]
    }`,
  );
  assertEquals(
    result.errors[1].includes(unknownVars[1]),
    true,
    `Expected error about ${
      unknownVars[1]
    } (fix: uv-reachability-validator.ts error message format). Got: ${
      result.errors[1]
    }`,
  );
});

Deno.test("validateUvReachability - multiple steps: runtime var OK, orphan var -> error", () => {
  const orphanVars = ["orphan_var"];
  const registry: Record<string, unknown> = {
    steps: {
      "step.issue": {
        uvVariables: ["issue", "iteration"],
      },
      "step.check": {
        uvVariables: orphanVars,
      },
    },
  };
  const agent = agentWith({
    issue: { required: true },
  });
  assert(
    Object.keys(registry.steps as Record<string, unknown>).length > 1,
    "Test fixture must have multiple steps to avoid vacuous pass",
  );

  const result = validateUvReachability(registry, agent);

  // "issue" is required param -> OK (Channel 1)
  // "iteration" is a runtime variable -> OK (Channel 2)
  // orphanVars have no supply source -> error
  assertEquals(
    result.valid,
    false,
    "Should be invalid when orphan UV variable has no supply source (fix: uv-reachability-validator.ts supply-check logic)",
  );
  assertEquals(
    result.errors.length,
    orphanVars.length,
    `Expected one error per orphan UV variable (${orphanVars.length} orphan vars) (fix: uv-reachability-validator.ts no-supply-source error emission)`,
  );
  assertEquals(
    result.warnings.length,
    0,
    "No warnings expected for orphan variables (fix: uv-reachability-validator.ts warning vs error classification)",
  );
  assertEquals(
    result.errors[0].includes(orphanVars[0]),
    true,
    `Expected error about ${
      orphanVars[0]
    } (fix: uv-reachability-validator.ts error message format). Got: ${
      result.errors[0]
    }`,
  );
  assertEquals(
    result.errors[0].includes(MSG_NO_SUPPLY_SOURCE),
    true,
    `Expected '${MSG_NO_SUPPLY_SOURCE}' in error (fix: uv-reachability-validator.ts supply-check logic). Got: ${
      result.errors[0]
    }`,
  );
});

// =============================================================================
// Prefix substitution consistency tests
// =============================================================================

Deno.test("prefix substitution - matching uvVariables -> no warning", () => {
  const uvVars = ["issue", "repo"];
  const registry = registryWithMultiple({
    "initial.assess": { uvVariables: uvVars },
    "continuation.assess": { uvVariables: uvVars },
  });
  const agent = agentWith({
    issue: { required: true },
    repo: { required: true },
  });
  assert(
    uvVars.length > 0,
    "Test fixture must declare UV variables to avoid vacuous pass",
  );

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "Matching prefix pair should be valid (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency)",
  );
  assertEquals(
    result.errors.length,
    0,
    "No errors expected for matching prefix pair (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency)",
  );
  assertEquals(
    result.warnings.length,
    0,
    "No warnings expected when initial/continuation uvVariables match (fix: uv-reachability-validator.ts prefix comparison logic)",
  );
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

  assertEquals(
    result.valid,
    true,
    "Mismatch is a warning, not an error (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency)",
  );
  assertEquals(
    result.errors.length,
    0,
    "Mismatch should not produce errors (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency)",
  );
  assertEquals(
    result.warnings.length,
    1,
    "Expected exactly 1 warning for the mismatch (fix: uv-reachability-validator.ts prefix comparison logic)",
  );
  assertEquals(
    result.warnings[0].includes("initial.assess"),
    true,
    `Expected warning to mention "initial.assess" (fix: uv-reachability-validator.ts prefix comparison logic). Got: ${
      result.warnings[0]
    }`,
  );
  assertEquals(
    result.warnings[0].includes("continuation.assess"),
    true,
    `Expected warning to mention "continuation.assess" (fix: uv-reachability-validator.ts prefix comparison logic). Got: ${
      result.warnings[0]
    }`,
  );
  assertEquals(
    result.warnings[0].includes(MSG_PREFIX_SUBSTITUTION),
    true,
    `Expected warning about ${MSG_PREFIX_SUBSTITUTION} (fix: uv-reachability-validator.ts prefix comparison logic). Got: ${
      result.warnings[0]
    }`,
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

  assertEquals(
    result.valid,
    true,
    "Missing continuation is a warning, not error (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency)",
  );
  assertEquals(
    result.errors.length,
    0,
    "Missing continuation should not produce errors (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency)",
  );
  assertEquals(
    result.warnings.length,
    1,
    "Expected exactly 1 warning for missing continuation step (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency)",
  );
  assertEquals(
    result.warnings[0].includes('steps["initial.assess"]'),
    true,
    `Expected warning to reference initial.assess (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency). Got: ${
      result.warnings[0]
    }`,
  );
  assertEquals(
    result.warnings[0].includes('steps["continuation.assess"] is missing'),
    true,
    `Expected warning about missing continuation step (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency). Got: ${
      result.warnings[0]
    }`,
  );
  assertEquals(
    result.warnings[0].includes(MSG_DEFAULT_TRANSITION_FAIL),
    true,
    `Expected warning about ${MSG_DEFAULT_TRANSITION_FAIL} (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency). Got: ${
      result.warnings[0]
    }`,
  );
});

Deno.test("prefix substitution - continuation.X without initial.X -> no warning", () => {
  const registry = registryWith("continuation.assess", {
    uvVariables: ["issue"],
  });
  const agent = agentWith({
    issue: { required: true },
  });
  assert(
    Object.keys(registry.steps as Record<string, unknown>).length > 0,
    "Test fixture must have steps to avoid vacuous pass",
  );

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "continuation.X without initial.X should be valid (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency)",
  );
  assertEquals(
    result.errors.length,
    0,
    "No errors expected when initial.X is absent (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency)",
  );
  assertEquals(
    result.warnings.length,
    0,
    "No warnings expected - only initial.* triggers prefix check (fix: uv-reachability-validator.ts prefix iteration logic)",
  );
});

Deno.test("prefix substitution - no initial.* steps at all -> no warnings", () => {
  const registry = registryWithMultiple({
    "step.assess": { uvVariables: ["issue"] },
    "continuation.assess": { uvVariables: ["issue"] },
  });
  const agent = agentWith({
    issue: { required: true },
  });
  assert(
    Object.keys(registry.steps as Record<string, unknown>).length > 0,
    "Test fixture must have steps to avoid vacuous pass",
  );

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "No initial.* steps should be valid (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency)",
  );
  assertEquals(
    result.errors.length,
    0,
    "No errors expected without initial.* steps (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency)",
  );
  assertEquals(
    result.warnings.length,
    0,
    "No warnings expected without initial.* steps (fix: uv-reachability-validator.ts prefix iteration logic)",
  );
});

Deno.test("prefix substitution - multiple initial.* steps with mixed match/mismatch", () => {
  // mismatch (plan) + missing (execute) = 2 expected warnings
  const expectedWarningSteps = ["initial.plan", "initial.execute"];
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

  assertEquals(
    result.valid,
    true,
    "Prefix substitution issues are warnings, not errors (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency)",
  );
  assertEquals(
    result.errors.length,
    0,
    "No errors expected for prefix substitution issues (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency)",
  );
  assertEquals(
    result.warnings.length,
    expectedWarningSteps.length,
    `Expected one warning per problematic initial.* step (${expectedWarningSteps.length} steps) (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency)`,
  );

  const mismatchWarning = result.warnings.find((w) =>
    w.includes("initial.plan")
  );
  assertEquals(
    mismatchWarning !== undefined,
    true,
    `Expected mismatch warning for initial.plan (fix: uv-reachability-validator.ts prefix comparison logic). Got: ${
      JSON.stringify(result.warnings)
    }`,
  );
  assertEquals(
    mismatchWarning!.includes(MSG_PREFIX_SUBSTITUTION),
    true,
    `Expected ${MSG_PREFIX_SUBSTITUTION} mention (fix: uv-reachability-validator.ts prefix comparison logic). Got: ${mismatchWarning}`,
  );

  const missingWarning = result.warnings.find((w) =>
    w.includes("initial.execute")
  );
  assertEquals(
    missingWarning !== undefined,
    true,
    `Expected missing warning for initial.execute (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency). Got: ${
      JSON.stringify(result.warnings)
    }`,
  );
  assertEquals(
    missingWarning!.includes("continuation.execute"),
    true,
    `Expected mention of continuation.execute (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency). Got: ${missingWarning}`,
  );
  assertEquals(
    missingWarning!.includes("is missing"),
    true,
    `Expected "is missing" in warning (fix: uv-reachability-validator.ts validatePrefixSubstitutionConsistency). Got: ${missingWarning}`,
  );
});

// =============================================================================
// Design invariant
// =============================================================================

Deno.test("uv-reachability validator: no-supply-source produces error, other issues remain warnings", () => {
  // Scenario with mixed diagnostics:
  // - optional_param without default on initial.assess and step.check -> warnings (Channel 1)
  // - initial/continuation mismatch -> warning (prefix substitution)
  // - missing continuation.plan -> warning (prefix substitution)
  // - "no_source_var" has no supply channel at all -> error
  const unsuppliedVars = ["no_source_var"];
  const registry = registryWithMultiple({
    "initial.assess": { uvVariables: ["issue", "optional_param"] },
    "continuation.assess": { uvVariables: ["issue"] }, // mismatch -> prefix substitution warning
    "initial.plan": { uvVariables: ["issue"] },
    // continuation.plan missing -> missing continuation warning
    "step.check": { uvVariables: ["optional_param", ...unsuppliedVars] },
  });
  const agent = agentWith({
    issue: { required: true },
    optional_param: { required: false }, // optional without default -> warning
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    false,
    "Should be invalid because no_source_var has no supply source (fix: uv-reachability-validator.ts supply-check logic)",
  );
  assertEquals(
    result.errors.length,
    unsuppliedVars.length,
    `Expected one error per unsupplied variable (${unsuppliedVars.length} vars) (fix: uv-reachability-validator.ts no-supply-source error emission). Got: ${
      JSON.stringify(result.errors)
    }`,
  );
  assertEquals(
    result.errors[0].includes(unsuppliedVars[0]),
    true,
    `Error should mention ${
      unsuppliedVars[0]
    } (fix: uv-reachability-validator.ts error message format). Got: ${
      result.errors[0]
    }`,
  );
  assert(
    result.warnings.length > 0,
    "Test fixture should trigger at least one warning (optional param, prefix substitution) to avoid vacuous pass",
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
  assert(
    allRuntimeVars.length > 0,
    "Test fixture must declare runtime variables to avoid vacuous pass",
  );

  const registry = registryWith("step.check", {
    uvVariables: allRuntimeVars,
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "All runtime-supplied variables should be valid (fix: uv-reachability-validator.ts Channel 2/3 recognition)",
  );
  assertEquals(
    result.errors.length,
    0,
    "No errors expected for runtime-supplied variables (fix: uv-reachability-validator.ts RUNTIME_SUPPLIED_UV_VARS check)",
  );
  assertEquals(
    result.warnings.length,
    0,
    `Runtime-supplied variables should not produce warnings (fix: uv-reachability-validator.ts Channel 2/3 logic). Got: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

Deno.test("Channel 4 - UV variable supplied via inputs -> no warning", () => {
  // Step with inputs that derive a UV variable via stepId_key namespace
  const inputUvVars = ["initial_issue_number"];
  const registry = registryWith("step.plan", {
    uvVariables: inputUvVars,
    inputs: {
      issue_number: { from: "initial.issue_number", required: true },
    },
  });
  const agent = agentWith({});
  assert(
    inputUvVars.length > 0,
    "Test fixture must declare input-derived UV variables to avoid vacuous pass",
  );

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "Channel 4 input-derived variable should be valid (fix: uv-reachability-validator.ts deriveChannel4UvNames)",
  );
  assertEquals(
    result.errors.length,
    0,
    "No errors expected for input-derived UV variables (fix: uv-reachability-validator.ts Channel 4 check)",
  );
  assertEquals(
    result.warnings.length,
    0,
    `Channel 4 input-derived UV variable should not produce warnings (fix: uv-reachability-validator.ts deriveChannel4UvNames). Got: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

Deno.test("Channel 4 - UV variable from composite stepId inputs -> no warning", () => {
  // Composite stepId: dots replaced with underscores in UV key
  const compositeUvVars = ["initial_assess_summary"];
  const registry = registryWith("step.execute", {
    uvVariables: compositeUvVars,
    inputs: {
      summary: { from: "initial.assess.summary", required: true },
    },
  });
  const agent = agentWith({});
  assert(
    compositeUvVars.length > 0,
    "Test fixture must declare composite UV variables to avoid vacuous pass",
  );

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "Channel 4 composite stepId variable should be valid (fix: uv-reachability-validator.ts deriveChannel4UvNames dot replacement)",
  );
  assertEquals(
    result.errors.length,
    0,
    "No errors expected for composite stepId UV variables (fix: uv-reachability-validator.ts Channel 4 check)",
  );
  assertEquals(
    result.warnings.length,
    0,
    `Channel 4 composite stepId UV variable should not produce warnings (fix: uv-reachability-validator.ts deriveChannel4UvNames). Got: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

Deno.test("no channel supplies variable -> error with descriptive message", () => {
  const unsuppliedVars = ["totally_unknown"];
  const registry = registryWith("step.process", {
    uvVariables: unsuppliedVars,
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    false,
    "Should be invalid when no channel supplies the variable (fix: uv-reachability-validator.ts supply-check logic)",
  );
  assertEquals(
    result.errors.length,
    unsuppliedVars.length,
    `Expected one error per unsupplied variable (${unsuppliedVars.length} vars) (fix: uv-reachability-validator.ts no-supply-source error emission)`,
  );
  assertEquals(
    result.warnings.length,
    0,
    "No warnings expected for unsupplied variables (fix: uv-reachability-validator.ts warning vs error classification)",
  );

  const error = result.errors[0];
  assertEquals(
    error.includes('Step "step.process"'),
    true,
    `Error should reference step ID (fix: uv-reachability-validator.ts error message format). Got: ${error}`,
  );
  assertEquals(
    error.includes(`"${unsuppliedVars[0]}"`),
    true,
    `Error should reference variable name (fix: uv-reachability-validator.ts error message format). Got: ${error}`,
  );
  assertEquals(
    error.includes("not a CLI parameter"),
    true,
    `Error should mention CLI parameter (fix: uv-reachability-validator.ts error message format). Got: ${error}`,
  );
  assertEquals(
    error.includes("not a runtime variable"),
    true,
    `Error should mention runtime variable (fix: uv-reachability-validator.ts error message format). Got: ${error}`,
  );
  assertEquals(
    error.includes("not an input handoff"),
    true,
    `Error should mention input handoff (fix: uv-reachability-validator.ts error message format). Got: ${error}`,
  );
  assertEquals(
    error.includes(MSG_PR_RESOLVE),
    true,
    `Error should mention ${MSG_PR_RESOLVE} (fix: uv-reachability-validator.ts error message format). Got: ${error}`,
  );
});

Deno.test("all four channels combined - each channel covers its variables, unsupplied -> error", () => {
  const unsuppliedVars = ["mystery_var"];
  const registry = registryWith("step.combined", {
    uvVariables: [
      "issue", // Channel 1: CLI param
      "iteration", // Channel 2: runtime
      "max_iterations", // Channel 3: verdict handler
      "prev_result", // Channel 4: input handoff
      ...unsuppliedVars, // No channel -> error
    ],
    inputs: {
      result: { from: "prev.result", required: true },
    },
  });
  const agent = agentWith({
    issue: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    false,
    "Should be invalid because mystery_var has no supply source (fix: uv-reachability-validator.ts supply-check logic)",
  );
  assertEquals(
    result.errors.length,
    unsuppliedVars.length,
    `Expected one error per unsupplied variable (${unsuppliedVars.length} vars) (fix: uv-reachability-validator.ts no-supply-source error emission). Got ${result.errors.length}: ${
      JSON.stringify(result.errors)
    }`,
  );
  assertEquals(
    result.errors[0].includes(unsuppliedVars[0]),
    true,
    `Error should reference ${
      unsuppliedVars[0]
    } (fix: uv-reachability-validator.ts error message format). Got: ${
      result.errors[0]
    }`,
  );
  assertEquals(
    result.warnings.length,
    0,
    "No warnings expected when all other variables are channel-supplied (fix: uv-reachability-validator.ts channel routing)",
  );
});

// =============================================================================
// Issue #459: continuation-only variables excluded from prefix substitution
// =============================================================================

Deno.test("prefix substitution - continuation-only UV vars do not trigger mismatch warning (#459)", () => {
  // Reproduction: initial has [issue, iteration], continuation adds previous_summary.
  // previous_summary is in CONTINUATION_ONLY_UV_VARS, so the difference is expected.
  const registry = registryWithMultiple({
    "initial.manual": {
      uvVariables: ["issue", "iteration"],
    },
    "continuation.manual": {
      uvVariables: ["issue", "iteration", "previous_summary"],
    },
  });
  const agent = agentWith({
    issue: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(
    result.valid,
    true,
    "Continuation-only UV var difference should not invalidate (fix: uv-reachability-validator.ts CONTINUATION_ONLY_UV_VARS filter)",
  );
  assertEquals(
    result.errors.length,
    0,
    "No errors expected when difference is continuation-only (fix: uv-reachability-validator.ts CONTINUATION_ONLY_UV_VARS filter)",
  );
  const prefixWarnings = result.warnings.filter((w) =>
    w.includes(MSG_PREFIX_SUBSTITUTION)
  );
  assertEquals(
    prefixWarnings.length,
    0,
    `continuation-only UV vars should not trigger ${MSG_PREFIX_SUBSTITUTION} warning (fix: uv-reachability-validator.ts CONTINUATION_ONLY_UV_VARS filter). Got: ${
      JSON.stringify(prefixWarnings)
    }`,
  );
});

Deno.test("prefix substitution - non-continuation-only difference still triggers warning", () => {
  // extra_var is NOT in CONTINUATION_ONLY_UV_VARS, so the mismatch should still warn.
  // extra_var also has no supply source -> error (separate from the prefix substitution warning).
  const unsuppliedVars = ["extra_var"];
  const registry = registryWithMultiple({
    "initial.manual": {
      uvVariables: ["issue"],
    },
    "continuation.manual": {
      uvVariables: ["issue", ...unsuppliedVars],
    },
  });
  const agent = agentWith({
    issue: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  // extra_var has no supply source -> error
  assertEquals(
    result.valid,
    false,
    "Should be invalid because extra_var has no supply source (fix: uv-reachability-validator.ts supply-check logic)",
  );
  assertEquals(
    result.errors.length,
    unsuppliedVars.length,
    `Expected one error per unsupplied variable (${unsuppliedVars.length} vars) (fix: uv-reachability-validator.ts no-supply-source error emission)`,
  );
  assertEquals(
    result.errors[0].includes(unsuppliedVars[0]),
    true,
    `Error should mention ${
      unsuppliedVars[0]
    } (fix: uv-reachability-validator.ts error message format). Got: ${
      result.errors[0]
    }`,
  );

  // Prefix substitution mismatch -> warning (separate concern)
  const prefixWarnings = result.warnings.filter((w) =>
    w.includes(MSG_PREFIX_SUBSTITUTION)
  );
  assertEquals(
    prefixWarnings.length,
    1,
    `Non-continuation-only difference should trigger ${MSG_PREFIX_SUBSTITUTION} warning (fix: uv-reachability-validator.ts CONTINUATION_ONLY_UV_VARS filter). Got: ${
      JSON.stringify(prefixWarnings)
    }`,
  );
});
