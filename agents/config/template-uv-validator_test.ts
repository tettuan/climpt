/**
 * Tests for agents/config/template-uv-validator.ts
 *
 * Covers validateTemplateUvConsistency() with temp directory fixtures:
 * - Template uses {uv-issue}, uvVariables declares ["issue"] -> valid
 * - Template uses {uv-issue} but uvVariables is [] -> error (undeclared usage)
 * - uvVariables declares ["repo"] but template has no {uv-repo} -> warning
 * - Prompt file doesn't exist -> skip (no error from this validator)
 * - Fallback template contains {uv-issue} -> check against declarations
 * - No steps in registry -> valid
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { validateTemplateUvConsistency } from "./template-uv-validator.ts";

// =============================================================================
// Helpers
// =============================================================================

/** Build a minimal registry with c1 and a single step entry. */
function registryWith(
  stepId: string,
  stepDef: Record<string, unknown>,
): Record<string, unknown> {
  return {
    c1: "steps",
    steps: { [stepId]: stepDef },
  };
}

/**
 * Create a prompt file in the C3L layout inside a temp agent directory.
 * Returns the agent directory path.
 */
async function createPromptFile(
  agentDir: string,
  c1: string,
  c2: string,
  c3: string,
  edition: string,
  content: string,
  adaptation?: string,
): Promise<void> {
  const dir = join(agentDir, "prompts", c1, c2, c3);
  await Deno.mkdir(dir, { recursive: true });
  const filename = adaptation
    ? `f_${edition}_${adaptation}.md`
    : `f_${edition}.md`;
  await Deno.writeTextFile(join(dir, filename), content);
}

// =============================================================================
// 1. Template uses {uv-issue}, uvVariables declares ["issue"] -> valid
// =============================================================================

Deno.test("template-uv-validator - matching UV usage and declaration is valid", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      "# Issue #{uv-issue}\n\nWork on issue #{uv-issue}.",
    );

    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue"],
      fallbackKey: "",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
    assertEquals(result.warnings.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 2. Template uses {uv-issue} but uvVariables is [] -> error
// =============================================================================

Deno.test("template-uv-validator - undeclared UV usage produces error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      "# Issue #{uv-issue}\n\nWork on this.",
    );

    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: [],
      fallbackKey: "",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    assertEquals(result.valid, false);
    assertEquals(result.errors.length >= 1, true);
    assertEquals(
      result.errors.some((e) =>
        e.includes("initial.issue") && e.includes("uv-issue") &&
        e.includes("not declared")
      ),
      true,
      `Expected undeclared UV error, got: ${JSON.stringify(result.errors)}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 3. uvVariables declares ["repo"] but template has no {uv-repo} -> warning
// =============================================================================

Deno.test("template-uv-validator - unused UV declaration produces warning", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      "# Simple prompt\n\nNo UV variables here.",
    );

    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: ["repo"],
      fallbackKey: "",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    assertEquals(result.valid, true);
    assertEquals(result.warnings.length >= 1, true);
    assertEquals(
      result.warnings.some((w) =>
        w.includes("initial.issue") && w.includes("repo") &&
        w.includes("no {uv-repo}")
      ),
      true,
      `Expected unused declaration warning, got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 4. Prompt file doesn't exist -> skip (no error from this validator)
// =============================================================================

Deno.test("template-uv-validator - missing prompt file produces warning", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Do NOT create any prompt file
    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue"],
      fallbackKey: "",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
    assertEquals(result.warnings.length, 1);
    assertEquals(
      result.warnings.some((w) =>
        w.includes("initial.issue") && w.includes("C3L prompt file not found")
      ),
      true,
      `Expected skip warning, got: ${JSON.stringify(result.warnings)}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 5. Fallback template contains {uv-issue} -> check against declarations
// =============================================================================

Deno.test("template-uv-validator - fallback-only step warns about missing C3L file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // No C3L prompt file — only fallback template
    // "initial_issue" fallback uses {uv-issue} (from DefaultFallbackProvider)
    // Since no C3L file exists, fallback UV requirements should NOT be imposed.
    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: [],
      fallbackKey: "initial_issue",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    // Fallback-only: no C3L file produces a warning about skipped UV check
    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
    assertEquals(result.warnings.length, 1);
    assertEquals(
      result.warnings.some((w) => w.includes("C3L prompt file not found")),
      true,
      `Expected skip warning, got: ${JSON.stringify(result.warnings)}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("template-uv-validator - fallback template UV declared but no C3L file warns", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // "initial_issue" fallback uses {uv-issue}, but no C3L file exists
    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue"],
      fallbackKey: "initial_issue",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
    // Warning about missing C3L file (UV check skipped)
    assertEquals(result.warnings.length, 1);
    assertEquals(
      result.warnings.some((w) => w.includes("C3L prompt file not found")),
      true,
      `Expected skip warning, got: ${JSON.stringify(result.warnings)}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 6. No steps in registry -> valid
// =============================================================================

Deno.test("template-uv-validator - empty steps produces no errors", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const registry: Record<string, unknown> = { c1: "steps", steps: {} };

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
    assertEquals(result.warnings.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("template-uv-validator - missing steps key produces no errors", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const registry: Record<string, unknown> = {};

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
    assertEquals(result.warnings.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 7. Multiple UV variables in template
// =============================================================================

Deno.test("template-uv-validator - multiple UV variables all declared is valid", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createPromptFile(
      dir,
      "steps",
      "continuation",
      "issue",
      "default",
      "Issue #{uv-issue}\n\n{uv-previous_summary}\n\nIteration {uv-iteration}",
    );

    const registry = registryWith("continuation.issue", {
      c2: "continuation",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue", "previous_summary", "iteration"],
      fallbackKey: "",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
    assertEquals(result.warnings.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("template-uv-validator - mixed undeclared and unused produces both error and warning", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "project",
      "default",
      "# Project\n\nPhase: {uv-phase}\nNumber: {uv-project_number}",
    );

    const registry = registryWith("initial.project", {
      c2: "initial",
      c3: "project",
      edition: "default",
      uvVariables: ["phase", "unused_var"],
      fallbackKey: "",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    // project_number is used but not declared -> error
    assertEquals(result.valid, false);
    assertEquals(
      result.errors.some((e) =>
        e.includes("project_number") && e.includes("not declared")
      ),
      true,
      `Expected undeclared error for project_number, got: ${
        JSON.stringify(result.errors)
      }`,
    );

    // unused_var is declared but not used -> warning
    assertEquals(
      result.warnings.some((w) =>
        w.includes("unused_var") && w.includes("no {uv-unused_var}")
      ),
      true,
      `Expected unused warning for unused_var, got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 8. Step with adaptation in path
// =============================================================================

Deno.test("template-uv-validator - adaptation path resolves correctly", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      "# Issue #{uv-issue} (Label-Only)",
      "label_only",
    );

    const registry = registryWith("initial.issue.label_only", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      adaptation: "label_only",
      uvVariables: ["issue"],
      fallbackKey: "",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 9. Only C3L file UVs are checked (fallback templates removed)
// =============================================================================

Deno.test("template-uv-validator - only C3L file UVs are checked", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // C3L prompt uses {uv-custom_var} only
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      "Custom: {uv-custom_var}",
    );

    // uvVariables declares custom_var (used in C3L) and issue (not used anywhere)
    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: ["custom_var", "issue"],
      fallbackKey: "initial_issue",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
    // "issue" is declared but not used in C3L file → 1 warning
    assertEquals(result.warnings.length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 10. Step with missing c2/c3/edition is skipped
// =============================================================================

Deno.test("template-uv-validator - step with missing c2 is skipped", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const registry = registryWith("initial.issue", {
      // c2 missing
      c3: "issue",
      edition: "default",
      uvVariables: ["issue"],
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
