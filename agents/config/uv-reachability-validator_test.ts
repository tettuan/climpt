/**
 * Tests for agents/config/uv-reachability-validator.ts
 *
 * Covers validateUvReachability() with inline fixtures:
 * - All UV variables have CLI sources → valid
 * - UV variable is a runtime variable → valid
 * - UV variable has no source → error
 * - Optional CLI param without default → warning
 * - Empty uvVariables → valid (skipped)
 * - No steps → valid
 * - Mix of valid and invalid variables
 */

import { assertEquals } from "@std/assert";
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

/** Build a minimal agent definition with parameters. */
function agentWith(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  return { parameters };
}

// =============================================================================
// Tests
// =============================================================================

Deno.test("validateUvReachability - all UV variables have CLI sources → valid", () => {
  const registry = registryWith("initial.issue", {
    uvVariables: ["issue", "project"],
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

Deno.test("validateUvReachability - UV variable is runtime variable (iteration) → valid", () => {
  const registry = registryWith("continuation.check", {
    uvVariables: ["iteration", "completed_iterations", "completion_keyword"],
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - UV variable has no source → error", () => {
  const registry = registryWith("initial.issue", {
    uvVariables: ["unknown_var"],
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, false);
  assertEquals(result.errors.length, 1);
  assertEquals(
    result.errors[0].includes("unknown_var"),
    true,
    `Expected error to mention "unknown_var", got: ${result.errors[0]}`,
  );
  assertEquals(
    result.errors[0].includes("no supply source"),
    true,
    `Expected error to mention "no supply source", got: ${result.errors[0]}`,
  );
});

Deno.test("validateUvReachability - optional CLI param without default → warning", () => {
  const registry = registryWith("initial.issue", {
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

Deno.test("validateUvReachability - required CLI param → no warning", () => {
  const registry = registryWith("initial.issue", {
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

Deno.test("validateUvReachability - optional CLI param with default → no warning", () => {
  const registry = registryWith("initial.issue", {
    uvVariables: ["issue"],
  });
  const agent = agentWith({
    issue: { required: false, default: "default_value" },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - empty uvVariables → valid (skipped)", () => {
  const registry = registryWith("initial.issue", {
    uvVariables: [],
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - missing uvVariables key → valid (skipped)", () => {
  const registry = registryWith("initial.issue", {
    c2: "initial",
    c3: "issue",
  });
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - no steps → valid", () => {
  const registry: Record<string, unknown> = { steps: {} };
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - missing steps key → valid", () => {
  const registry: Record<string, unknown> = {};
  const agent = agentWith({});

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validateUvReachability - mix of valid and invalid variables", () => {
  const registry = registryWith("initial.issue", {
    uvVariables: ["issue", "iteration", "unknown_var", "another_missing"],
  });
  const agent = agentWith({
    issue: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, false);
  assertEquals(result.errors.length, 2);
  assertEquals(
    result.errors.some((e) => e.includes("unknown_var")),
    true,
    `Expected error for "unknown_var", got: ${JSON.stringify(result.errors)}`,
  );
  assertEquals(
    result.errors.some((e) => e.includes("another_missing")),
    true,
    `Expected error for "another_missing", got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("validateUvReachability - multiple steps with mixed results", () => {
  const registry: Record<string, unknown> = {
    steps: {
      "initial.issue": {
        uvVariables: ["issue", "iteration"],
      },
      "continuation.check": {
        uvVariables: ["orphan_var"],
      },
    },
  };
  const agent = agentWith({
    issue: { required: true },
  });

  const result = validateUvReachability(registry, agent);

  assertEquals(result.valid, false);
  assertEquals(result.errors.length, 1);
  assertEquals(
    result.errors[0].includes("continuation.check"),
    true,
    `Expected error for step "continuation.check", got: ${result.errors[0]}`,
  );
  assertEquals(
    result.errors[0].includes("orphan_var"),
    true,
    `Expected error for "orphan_var", got: ${result.errors[0]}`,
  );
});
