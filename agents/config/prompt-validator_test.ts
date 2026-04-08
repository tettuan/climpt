/**
 * Tests for agents/config/prompt-validator.ts
 *
 * Covers validatePrompts() with inline fixture registries:
 * - Missing c2/c3 produces errors
 * - Mismatched stepId vs c2/c3 produces warnings
 * - Valid steps produce no errors or warnings
 * - fallbackKey field is ignored when no agentDir (no validation)
 * - C3L file existence checks (when agentDir is provided)
 * - Fallback template existence checks
 */

import { assertEquals } from "@std/assert";
import { validatePrompts } from "./prompt-validator.ts";
import { join } from "@std/path";

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

  const result = await validatePrompts(registry);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((e) => e.includes("c2") && e.includes("missing")),
    true,
    `Expected an error about missing c2, got: ${JSON.stringify(result.errors)}`,
  );
});

Deno.test("validatePrompts - step missing c3 produces an error", async () => {
  const registry = registryWith("initial.issue", {
    c2: "initial",
    // c3 is missing
  });

  const result = await validatePrompts(registry);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((e) => e.includes("c3") && e.includes("missing")),
    true,
    `Expected an error about missing c3, got: ${JSON.stringify(result.errors)}`,
  );
});

Deno.test("validatePrompts - step missing both c2 and c3 produces two errors", async () => {
  const registry = registryWith("initial.issue", {
    fallbackKey: "initial_issue",
  });

  const result = await validatePrompts(registry);

  assertEquals(result.valid, false);
  const c2Errors = result.errors.filter((e) => e.includes("c2"));
  const c3Errors = result.errors.filter((e) => e.includes("c3"));
  assertEquals(c2Errors.length, 1, "Expected exactly one c2 error");
  assertEquals(c3Errors.length, 1, "Expected exactly one c3 error");
});

Deno.test("validatePrompts - mismatched c2 vs stepId prefix produces a warning", async () => {
  const registry = registryWith("initial.issue", {
    c2: "continuation", // mismatch: stepId prefix is "initial"
    c3: "issue",
  });

  const result = await validatePrompts(registry);

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

Deno.test("validatePrompts - mismatched c3 vs stepId second part produces a warning", async () => {
  const registry = registryWith("initial.issue", {
    c2: "initial",
    c3: "project", // mismatch: stepId second part is "issue"
  });

  const result = await validatePrompts(registry);

  assertEquals(result.valid, true);
  assertEquals(
    result.warnings.some((w) =>
      w.includes("c3") && w.includes("project") && w.includes("issue")
    ),
    true,
    `Expected a c3 mismatch warning, got: ${JSON.stringify(result.warnings)}`,
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

Deno.test("validatePrompts - fallbackKey field is ignored when no agentDir", async () => {
  // Without agentDir, no file checks are performed.
  // prompt-validator must NOT produce warnings or errors about fallbackKey.
  const registry = registryWith("initial.issue", {
    c2: "initial",
    c3: "issue",
    fallbackKey: "nonexistent_key_that_would_have_failed_before",
  });

  const result = await validatePrompts(registry);

  assertEquals(result.valid, true, "Step with fallbackKey should be valid");
  assertEquals(result.errors.length, 0, "No errors expected");
  assertEquals(
    result.warnings.length,
    0,
    `fallbackKey should produce no warnings without agentDir, got: ${
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

    const result = await validatePrompts(registry, agentDir);

    assertEquals(result.valid, true);
    assertEquals(
      result.warnings.filter((w) => w.includes("[PROMPT]")).length,
      0,
      `Expected no [PROMPT] warnings, got: ${JSON.stringify(result.warnings)}`,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("validatePrompts - missing main file but existing fallback produces warning with fallback note", async () => {
  // Main file does NOT exist, but fallback template does
  const { agentDir, cleanup } = await createTempAgentDir([
    "prompts/steps/initial/issue/f_default.md", // fallback path for fallbackKey "initial_issue"
  ]);

  try {
    const registry = registryWith("continuation.review", {
      c2: "continuation",
      c3: "review",
      edition: "default",
      fallbackKey: "initial_issue",
    });

    const result = await validatePrompts(registry, agentDir);

    assertEquals(result.valid, true, "File warnings should not cause invalid");
    const promptWarnings = result.warnings.filter((w) =>
      w.includes("[PROMPT]")
    );
    assertEquals(
      promptWarnings.length,
      1,
      `Expected exactly 1 [PROMPT] warning, got: ${
        JSON.stringify(promptWarnings)
      }`,
    );
    assertEquals(
      promptWarnings[0].includes("not found"),
      true,
      "Warning should mention main file not found",
    );
    assertEquals(
      promptWarnings[0].includes("fallback template") &&
        promptWarnings[0].includes("exists"),
      true,
      `Warning should mention fallback exists, got: ${promptWarnings[0]}`,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("validatePrompts - missing main file and missing fallback produces warning about both", async () => {
  // Neither main file nor fallback template exists
  const { agentDir, cleanup } = await createTempAgentDir([]);

  try {
    const registry = registryWith("continuation.review", {
      c2: "continuation",
      c3: "review",
      edition: "default",
      fallbackKey: "initial_issue",
    });

    const result = await validatePrompts(registry, agentDir);

    assertEquals(result.valid, true, "File warnings should not cause invalid");
    const promptWarnings = result.warnings.filter((w) =>
      w.includes("[PROMPT]")
    );
    assertEquals(
      promptWarnings.length,
      1,
      `Expected exactly 1 [PROMPT] warning, got: ${
        JSON.stringify(promptWarnings)
      }`,
    );
    assertEquals(
      promptWarnings[0].includes("not found") &&
        promptWarnings[0].includes("also not found"),
      true,
      `Warning should mention both files missing, got: ${promptWarnings[0]}`,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("validatePrompts - missing main file with empty fallbackKey produces warning about no fallback", async () => {
  // Main file does NOT exist and fallbackKey is empty
  const { agentDir, cleanup } = await createTempAgentDir([]);

  try {
    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      fallbackKey: "",
    });

    const result = await validatePrompts(registry, agentDir);

    assertEquals(result.valid, true, "File warnings should not cause invalid");
    const promptWarnings = result.warnings.filter((w) =>
      w.includes("[PROMPT]")
    );
    assertEquals(
      promptWarnings.length,
      1,
      `Expected exactly 1 [PROMPT] warning, got: ${
        JSON.stringify(promptWarnings)
      }`,
    );
    assertEquals(
      promptWarnings[0].includes("not found") &&
        promptWarnings[0].includes("no fallbackKey"),
      true,
      `Warning should mention no fallbackKey, got: ${promptWarnings[0]}`,
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
    // Step without explicit edition — should default to "default"
    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      // no edition field
    });

    const result = await validatePrompts(registry, agentDir);

    assertEquals(result.valid, true);
    assertEquals(
      result.warnings.filter((w) => w.includes("[PROMPT]")).length,
      0,
      `Expected no [PROMPT] warnings when default edition file exists, got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("validatePrompts - missing main file without fallbackKey field produces warning", async () => {
  // Step has no fallbackKey field at all (not even empty string)
  const { agentDir, cleanup } = await createTempAgentDir([]);

  try {
    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      // no fallbackKey field
    });

    const result = await validatePrompts(registry, agentDir);

    assertEquals(result.valid, true, "File warnings should not cause invalid");
    const promptWarnings = result.warnings.filter((w) =>
      w.includes("[PROMPT]")
    );
    assertEquals(
      promptWarnings.length,
      1,
      `Expected exactly 1 [PROMPT] warning, got: ${
        JSON.stringify(promptWarnings)
      }`,
    );
    assertEquals(
      promptWarnings[0].includes("no fallbackKey"),
      true,
      `Warning should mention no fallbackKey, got: ${promptWarnings[0]}`,
    );
  } finally {
    await cleanup();
  }
});
