/**
 * Tests for agents/config/prompt-validator.ts
 *
 * Covers validatePrompts() with inline fixture registries:
 * - Missing c2/c3 produces errors
 * - Mismatched stepId vs c2/c3 produces warnings
 * - Unknown fallbackKey produces a warning mentioning the key
 * - Valid steps produce no errors or warnings
 */

import { assertEquals } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { validatePrompts } from "./prompt-validator.ts";

const _logger = new BreakdownLogger("prompt-validator");

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

// =============================================================================
// Tests
// =============================================================================

Deno.test("validatePrompts - step missing c2 produces an error", () => {
  const registry = registryWith("initial.issue", {
    c3: "issue",
    // c2 is missing
  });

  const result = validatePrompts(registry);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((e) => e.includes("c2") && e.includes("missing")),
    true,
    `Expected an error about missing c2, got: ${JSON.stringify(result.errors)}`,
  );
});

Deno.test("validatePrompts - step missing c3 produces an error", () => {
  const registry = registryWith("initial.issue", {
    c2: "initial",
    // c3 is missing
  });

  const result = validatePrompts(registry);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((e) => e.includes("c3") && e.includes("missing")),
    true,
    `Expected an error about missing c3, got: ${JSON.stringify(result.errors)}`,
  );
});

Deno.test("validatePrompts - step missing both c2 and c3 produces two errors", () => {
  const registry = registryWith("initial.issue", {
    fallbackKey: "initial_issue",
  });

  const result = validatePrompts(registry);

  assertEquals(result.valid, false);
  const c2Errors = result.errors.filter((e) => e.includes("c2"));
  const c3Errors = result.errors.filter((e) => e.includes("c3"));
  assertEquals(c2Errors.length, 1, "Expected exactly one c2 error");
  assertEquals(c3Errors.length, 1, "Expected exactly one c3 error");
});

Deno.test("validatePrompts - mismatched c2 vs stepId prefix produces a warning", () => {
  const registry = registryWith("initial.issue", {
    c2: "continuation", // mismatch: stepId prefix is "initial"
    c3: "issue",
  });

  const result = validatePrompts(registry);

  // No errors — c2/c3 are present
  assertEquals(result.valid, true);
  assertEquals(
    result.warnings.some((w) =>
      w.includes("c2") && w.includes("continuation") && w.includes("initial")
    ),
    true,
    `Expected a c2 mismatch warning, got: ${JSON.stringify(result.warnings)}`,
  );
});

Deno.test("validatePrompts - mismatched c3 vs stepId second part produces a warning", () => {
  const registry = registryWith("initial.issue", {
    c2: "initial",
    c3: "project", // mismatch: stepId second part is "issue"
  });

  const result = validatePrompts(registry);

  assertEquals(result.valid, true);
  assertEquals(
    result.warnings.some((w) =>
      w.includes("c3") && w.includes("project") && w.includes("issue")
    ),
    true,
    `Expected a c3 mismatch warning, got: ${JSON.stringify(result.warnings)}`,
  );
});

Deno.test("validatePrompts - unknown fallbackKey produces a warning mentioning the key", () => {
  const unknownKey = "nonexistent_template_key_xyz";
  const registry = registryWith("initial.issue", {
    c2: "initial",
    c3: "issue",
    fallbackKey: unknownKey,
  });

  const result = validatePrompts(registry);

  // c2/c3 are valid so no errors
  assertEquals(result.valid, true);
  assertEquals(
    result.warnings.some((w) => w.includes(unknownKey)),
    true,
    `Expected a warning mentioning "${unknownKey}", got: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

Deno.test("validatePrompts - valid step with known fallbackKey produces no errors or warnings", () => {
  const registry = registryWith("initial.issue", {
    c2: "initial",
    c3: "issue",
    fallbackKey: "initial_issue",
  });

  const result = validatePrompts(registry);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0, "Expected no errors");
  assertEquals(result.warnings.length, 0, "Expected no warnings");
});

Deno.test("validatePrompts - empty steps object produces no errors", () => {
  const registry: Record<string, unknown> = { steps: {} };

  const result = validatePrompts(registry);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validatePrompts - missing steps key produces no errors", () => {
  const registry: Record<string, unknown> = {};

  const result = validatePrompts(registry);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});
