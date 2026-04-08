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

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  MSG_ALSO_NOT_FOUND,
  MSG_C3L_NOT_FOUND,
  MSG_FALLBACK_NO_UV_PREFIX,
  MSG_FALLBACK_TEMPLATE,
  MSG_FALLBACK_TEMPLATE_REF,
  MSG_NO_UV_PREFIX,
  MSG_NOT_DECLARED,
  MSG_UV_CHECK_SKIPPED,
  validateTemplateUvConsistency,
} from "./template-uv-validator.ts";

/** Source file for assertion "where" messages. */
const VALIDATOR_FILE = "template-uv-validator.ts";

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

    const declaredUvs = registry.steps as Record<
      string,
      Record<string, unknown>
    >;
    assert(
      (declaredUvs["initial.issue"].uvVariables as string[]).length > 0,
      "Test fixture must declare UV variables to avoid vacuous pass",
    );
    assertEquals(
      result.valid,
      true,
      `Expected valid result (fix: ${VALIDATOR_FILE} main UV check)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected no errors (fix: ${VALIDATOR_FILE} main UV check). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.warnings.length,
      0,
      `Expected no warnings (fix: ${VALIDATOR_FILE} main UV check). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
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

    // Template has 1 UV variable ("issue"), uvVariables is empty -> exactly 1 error
    const templateUvCount = 1; // {uv-issue} in template
    assertEquals(
      result.valid,
      false,
      `Expected invalid result (fix: ${VALIDATOR_FILE} undeclared UV check)`,
    );
    assertEquals(
      result.errors.length,
      templateUvCount,
      `Expected ${templateUvCount} error(s) for undeclared UV (fix: ${VALIDATOR_FILE} undeclared UV check). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.errors.some((e) =>
        e.includes("initial.issue") && e.includes("uv-issue") &&
        e.includes(MSG_NOT_DECLARED)
      ),
      true,
      `Expected error containing "${MSG_NOT_DECLARED}" (fix: ${VALIDATOR_FILE} undeclared UV check). Got: ${
        JSON.stringify(result.errors)
      }`,
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

    // 1 declared UV ("repo") not used in template -> exactly 1 warning
    const unusedUvCount = 1; // "repo" declared but absent from template
    assertEquals(
      result.valid,
      true,
      `Expected valid result (fix: ${VALIDATOR_FILE} unused UV warning)`,
    );
    assertEquals(
      result.warnings.length,
      unusedUvCount,
      `Expected ${unusedUvCount} warning(s) for unused UV (fix: ${VALIDATOR_FILE} unused UV warning). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
    assertEquals(
      result.warnings.some((w) =>
        w.includes("initial.issue") && w.includes("repo") &&
        w.includes(MSG_NO_UV_PREFIX)
      ),
      true,
      `Expected warning containing "${MSG_NO_UV_PREFIX}" (fix: ${VALIDATOR_FILE} unused UV warning). Got: ${
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

    // 1 step with missing file -> exactly 1 warning
    const stepCount = Object.keys(
      registry.steps as Record<string, unknown>,
    ).length;
    assert(
      stepCount > 0,
      "Test fixture must have steps to avoid vacuous pass",
    );
    assertEquals(
      result.valid,
      true,
      `Expected valid result (fix: ${VALIDATOR_FILE} missing-file skip)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected no errors (fix: ${VALIDATOR_FILE} missing-file skip). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.warnings.length,
      stepCount,
      `Expected ${stepCount} warning(s) for missing file(s) (fix: ${VALIDATOR_FILE} missing-file skip). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
    assertEquals(
      result.warnings.some((w) =>
        w.includes("initial.issue") && w.includes(MSG_C3L_NOT_FOUND)
      ),
      true,
      `Expected warning containing "${MSG_C3L_NOT_FOUND}" (fix: ${VALIDATOR_FILE} missing-file skip). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 5. Fallback template contains {uv-issue} -> check against declarations
// =============================================================================

Deno.test("template-uv-validator - fallback-only step warns about both missing files", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // No C3L prompt file and no fallback template file
    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: [],
      fallbackKey: "initial_issue",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    // Both main and fallback missing: warning mentions both
    const stepCount = Object.keys(
      registry.steps as Record<string, unknown>,
    ).length;
    assert(
      stepCount > 0,
      "Test fixture must have steps to avoid vacuous pass",
    );
    assertEquals(
      result.valid,
      true,
      `Expected valid result (fix: ${VALIDATOR_FILE} both-missing fallback path)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected no errors (fix: ${VALIDATOR_FILE} both-missing fallback path). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.warnings.length,
      stepCount,
      `Expected ${stepCount} warning(s) (fix: ${VALIDATOR_FILE} both-missing fallback path). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
    assertEquals(
      result.warnings.some((w) =>
        w.includes(MSG_C3L_NOT_FOUND) &&
        w.includes(MSG_FALLBACK_TEMPLATE_REF) &&
        w.includes("initial_issue") &&
        w.includes(MSG_ALSO_NOT_FOUND)
      ),
      true,
      `Expected warning containing "${MSG_C3L_NOT_FOUND}" and "${MSG_ALSO_NOT_FOUND}" (fix: ${VALIDATOR_FILE} both-missing fallback path). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("template-uv-validator - fallback template UV declared but both files missing warns", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // "initial_issue" fallback uses {uv-issue}, but neither C3L nor fallback file exists
    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue"],
      fallbackKey: "initial_issue",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    const stepCount = Object.keys(
      registry.steps as Record<string, unknown>,
    ).length;
    assert(
      stepCount > 0,
      "Test fixture must have steps to avoid vacuous pass",
    );
    assertEquals(
      result.valid,
      true,
      `Expected valid result (fix: ${VALIDATOR_FILE} both-missing fallback path)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected no errors (fix: ${VALIDATOR_FILE} both-missing fallback path). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    // Warning about both missing files (UV check skipped)
    assertEquals(
      result.warnings.length,
      stepCount,
      `Expected ${stepCount} warning(s) (fix: ${VALIDATOR_FILE} both-missing fallback path). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
    assertEquals(
      result.warnings.some((w) =>
        w.includes(MSG_C3L_NOT_FOUND) &&
        w.includes(MSG_FALLBACK_TEMPLATE_REF) &&
        w.includes(MSG_ALSO_NOT_FOUND)
      ),
      true,
      `Expected warning containing "${MSG_C3L_NOT_FOUND}" and "${MSG_ALSO_NOT_FOUND}" (fix: ${VALIDATOR_FILE} both-missing fallback path). Got: ${
        JSON.stringify(result.warnings)
      }`,
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
// 10. Fallback template: missing main but valid fallback runs UV check
// =============================================================================

Deno.test("template-uv-validator - missing main template with valid fallback runs UV check on fallback", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // No main C3L prompt file for c2=continuation, c3=issue
    // But fallback "initial_issue" template exists at c2=initial, c3=issue
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      "# Fallback\n\nIssue #{uv-issue}\nRepo: {uv-repo}",
    );

    const registry = registryWith("continuation.issue", {
      c2: "continuation",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue", "repo"],
      fallbackKey: "initial_issue",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    // Fallback template uses {uv-issue} and {uv-repo}, both declared -> valid
    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
    assertEquals(result.warnings.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 11. Fallback template has undeclared UV variable -> error
// =============================================================================

Deno.test("template-uv-validator - fallback template with undeclared UV produces error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // No main C3L prompt file for c2=continuation, c3=issue
    // Fallback "initial_issue" template uses {uv-secret} which is not declared
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      "# Fallback\n\nSecret: {uv-secret}",
    );

    const registry = registryWith("continuation.issue", {
      c2: "continuation",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue"],
      fallbackKey: "initial_issue",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    // Fallback uses {uv-secret} not declared -> error
    assertEquals(result.valid, false);
    assertEquals(
      result.errors.some((e) =>
        e.includes("continuation.issue") &&
        e.includes("fallback template") &&
        e.includes("uv-secret") &&
        e.includes("not declared")
      ),
      true,
      `Expected undeclared UV error for fallback, got: ${
        JSON.stringify(result.errors)
      }`,
    );

    // "issue" is declared but not used in fallback -> warning
    assertEquals(
      result.warnings.some((w) =>
        w.includes("continuation.issue") &&
        w.includes("issue") &&
        w.includes("no {uv-issue}")
      ),
      true,
      `Expected unused declaration warning for fallback, got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 12. Missing main template, both main and fallback missing -> warning mentions both
// =============================================================================

Deno.test("template-uv-validator - missing main and missing fallback warns about both", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // No main C3L prompt file and no fallback template file either
    const registry = registryWith("continuation.issue", {
      c2: "continuation",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue"],
      fallbackKey: "initial_issue",
    });

    const result = await validateTemplateUvConsistency(registry, dir, dir);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
    assertEquals(result.warnings.length, 1);
    assertEquals(
      result.warnings.some((w) =>
        w.includes("continuation.issue") &&
        w.includes("C3L prompt file not found") &&
        w.includes("fallback template") &&
        w.includes("initial_issue") &&
        w.includes("also not found")
      ),
      true,
      `Expected both-missing warning, got: ${JSON.stringify(result.warnings)}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 13. Missing main template, empty fallbackKey -> original warn-and-skip behavior
// =============================================================================

Deno.test("template-uv-validator - missing main template with empty fallbackKey warns and skips", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // No main C3L prompt file, fallbackKey is empty
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
    // Original behavior: simple "C3L prompt file not found" without fallback mention
    assertEquals(
      result.warnings[0].includes("C3L prompt file not found") &&
        !result.warnings[0].includes("fallback"),
      true,
      `Expected simple skip warning without fallback mention, got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 14. Step with missing c2/c3/edition is skipped
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
