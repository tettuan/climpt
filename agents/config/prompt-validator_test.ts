/**
 * Tests for agents/config/prompt-validator.ts
 *
 * Covers validatePrompts() with inline fixture registries:
 * - Missing c2/c3 produces errors
 * - Mismatched stepId vs c2/c3 produces warnings
 * - Valid steps produce no errors or warnings
 * - C3L file existence checks (when agentDir is provided)
 */

import { assert, assertEquals } from "@std/assert";
import {
  MSG_C2_MISSING,
  MSG_C3_MISSING,
  MSG_NOT_FOUND,
  MSG_PROMPT_PREFIX,
  validatePrompts,
} from "./prompt-validator.ts";
import { join } from "@std/path";

/** Source file under test, referenced in assertion messages for traceability. */
const VALIDATOR_SRC = "prompt-validator.ts";

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

/**
 * Create a temporary directory structure for file existence tests.
 * Returns the agentDir path and a cleanup function.
 */
async function createTempAgentDir(
  files: string[],
): Promise<{ agentDir: string; cleanup: () => Promise<void> }> {
  const agentDir = await Deno.makeTempDir({ prefix: "prompt-validator-test-" });
  for (const file of files) {
    const fullPath = join(agentDir, file);
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(fullPath, "# test prompt\n");
  }
  return {
    agentDir,
    cleanup: async () => {
      await Deno.remove(agentDir, { recursive: true });
    },
  };
}

// =============================================================================
// String validation tests (no agentDir — pure string checks)
// =============================================================================

Deno.test("validatePrompts - step missing c2 produces an error", async () => {
  const registry = registryWith("initial.issue", {
    c3: "issue",
    // c2 is missing
  });
  assert(
    Object.keys(registry.steps as Record<string, unknown>).length > 0,
    "Fixture must have steps to avoid vacuous pass",
  );

  const result = await validatePrompts(registry);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((e) => e.includes(MSG_C2_MISSING)),
    true,
    `Expected error containing "${MSG_C2_MISSING}" (fix: ${VALIDATOR_SRC} c2 check logic). Got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("validatePrompts - step missing c3 produces an error", async () => {
  const registry = registryWith("initial.issue", {
    c2: "initial",
    // c3 is missing
  });
  assert(
    Object.keys(registry.steps as Record<string, unknown>).length > 0,
    "Fixture must have steps to avoid vacuous pass",
  );

  const result = await validatePrompts(registry);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((e) => e.includes(MSG_C3_MISSING)),
    true,
    `Expected error containing "${MSG_C3_MISSING}" (fix: ${VALIDATOR_SRC} c3 check logic). Got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("validatePrompts - step missing both c2 and c3 produces two errors", async () => {
  const registry = registryWith("initial.issue", {});
  const stepCount = Object.keys(registry.steps as Record<string, unknown>)
    .length;
  assert(stepCount > 0, "Fixture must have steps to avoid vacuous pass");

  const result = await validatePrompts(registry);

  assertEquals(result.valid, false);
  const c2Errors = result.errors.filter((e) => e.includes(MSG_C2_MISSING));
  const c3Errors = result.errors.filter((e) => e.includes(MSG_C3_MISSING));
  // Each step missing both fields produces exactly 1 c2 + 1 c3 error
  assertEquals(
    c2Errors.length,
    stepCount,
    `Expected ${stepCount} c2 error(s) (fix: ${VALIDATOR_SRC} c2 check). Got ${c2Errors.length}`,
  );
  assertEquals(
    c3Errors.length,
    stepCount,
    `Expected ${stepCount} c3 error(s) (fix: ${VALIDATOR_SRC} c3 check). Got ${c3Errors.length}`,
  );
});

Deno.test("validatePrompts - mismatched c2 vs stepId prefix produces a warning", async () => {
  const registry = registryWith("initial.issue", {
    c2: "continuation", // mismatch: stepId prefix is "initial"
    c3: "issue",
  });
  assert(
    Object.keys(registry.steps as Record<string, unknown>).length > 0,
    "Fixture must have steps to avoid vacuous pass",
  );

  const result = await validatePrompts(registry);

  // No errors -- c2/c3 are present
  assertEquals(result.valid, true);
  assertEquals(
    result.warnings.some((w) =>
      w.includes("c2") && w.includes("continuation") && w.includes("initial")
    ),
    true,
    `Expected a c2 mismatch warning (fix: ${VALIDATOR_SRC} stepId-consistency check). Got: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

Deno.test("validatePrompts - mismatched c3 vs stepId second part produces a warning", async () => {
  const registry = registryWith("initial.issue", {
    c2: "initial",
    c3: "project", // mismatch: stepId second part is "issue"
  });
  assert(
    Object.keys(registry.steps as Record<string, unknown>).length > 0,
    "Fixture must have steps to avoid vacuous pass",
  );

  const result = await validatePrompts(registry);

  assertEquals(result.valid, true);
  assertEquals(
    result.warnings.some((w) =>
      w.includes("c3") && w.includes("project") && w.includes("issue")
    ),
    true,
    `Expected a c3 mismatch warning (fix: ${VALIDATOR_SRC} stepId-consistency check). Got: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

Deno.test("validatePrompts - empty steps object produces no errors", async () => {
  const registry: Record<string, unknown> = { steps: {} };

  const result = await validatePrompts(registry);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validatePrompts - missing steps key produces no errors", async () => {
  const registry: Record<string, unknown> = {};

  const result = await validatePrompts(registry);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

Deno.test("validatePrompts - no file checks without agentDir", async () => {
  const registry = registryWith("initial.issue", {
    c2: "initial",
    c3: "issue",
  });
  assert(
    Object.keys(registry.steps as Record<string, unknown>).length > 0,
    "Fixture must have steps to avoid vacuous pass",
  );

  const result = await validatePrompts(registry);

  assertEquals(
    result.valid,
    true,
    `Valid step should pass (fix: ${VALIDATOR_SRC} agentDir guard)`,
  );
  assertEquals(
    result.errors.length,
    0,
    `No errors expected (fix: ${VALIDATOR_SRC} agentDir guard). Got: ${
      JSON.stringify(result.errors)
    }`,
  );
  assertEquals(
    result.warnings.length,
    0,
    `No warnings expected without agentDir (fix: ${VALIDATOR_SRC} file-check skip). Got: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

// =============================================================================
// File existence tests (with agentDir)
// =============================================================================

Deno.test("validatePrompts - existing main C3L file produces no file warning", async () => {
  const { agentDir, cleanup } = await createTempAgentDir([
    "prompts/steps/initial/issue/f_default.md",
  ]);

  try {
    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
    });
    assert(
      Object.keys(registry.steps as Record<string, unknown>).length > 0,
      "Fixture must have steps to avoid vacuous pass",
    );

    const result = await validatePrompts(registry, agentDir);

    assertEquals(result.valid, true);
    assertEquals(
      result.warnings.filter((w) => w.includes(MSG_PROMPT_PREFIX)).length,
      0,
      `Expected no ${MSG_PROMPT_PREFIX} warnings (fix: ${VALIDATOR_SRC} file-check logic). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("validatePrompts - missing C3L file produces warning", async () => {
  const { agentDir, cleanup } = await createTempAgentDir([]);

  try {
    const registry = registryWith("continuation.review", {
      c2: "continuation",
      c3: "review",
      edition: "default",
    });
    const stepCount = Object.keys(registry.steps as Record<string, unknown>)
      .length;
    assert(stepCount > 0, "Fixture must have steps to avoid vacuous pass");

    const result = await validatePrompts(registry, agentDir);

    assertEquals(
      result.valid,
      true,
      `File warnings should not cause invalid (fix: ${VALIDATOR_SRC} valid flag)`,
    );
    const promptWarnings = result.warnings.filter((w) =>
      w.includes(MSG_PROMPT_PREFIX)
    );
    assertEquals(
      promptWarnings.length,
      stepCount,
      `Expected ${stepCount} ${MSG_PROMPT_PREFIX} warning(s) (fix: ${VALIDATOR_SRC} file-check logic). Got: ${
        JSON.stringify(promptWarnings)
      }`,
    );
    assertEquals(
      promptWarnings[0].includes(MSG_NOT_FOUND),
      true,
      `Warning should mention file ${MSG_NOT_FOUND} (fix: ${VALIDATOR_SRC} file-check logic). Got: ${
        promptWarnings[0]
      }`,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("validatePrompts - edition defaults to 'default' when not specified", async () => {
  const { agentDir, cleanup } = await createTempAgentDir([
    "prompts/steps/initial/issue/f_default.md",
  ]);

  try {
    // Step without explicit edition -- should default to "default"
    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      // no edition field
    });
    assert(
      Object.keys(registry.steps as Record<string, unknown>).length > 0,
      "Fixture must have steps to avoid vacuous pass",
    );

    const result = await validatePrompts(registry, agentDir);

    assertEquals(result.valid, true);
    assertEquals(
      result.warnings.filter((w) => w.includes(MSG_PROMPT_PREFIX)).length,
      0,
      `Expected no ${MSG_PROMPT_PREFIX} warnings when default edition file exists (fix: ${VALIDATOR_SRC} edition-default logic). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await cleanup();
  }
});
