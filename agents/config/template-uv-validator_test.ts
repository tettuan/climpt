/**
 * Tests for agents/config/template-uv-validator.ts
 *
 * Covers validateTemplateUvConsistency() with temp directory fixtures:
 * - Template uses {uv-issue}, uvVariables declares ["issue"] -> valid
 * - Template uses {uv-issue} but uvVariables is [] -> error (undeclared usage)
 * - uvVariables declares ["repo"] but template has no {uv-repo} -> warning
 * - Prompt file doesn't exist -> skip (no error from this validator)
 * - No steps in registry -> valid
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  MSG_C3L_NOT_FOUND,
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
    });

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validateTemplateUvConsistency(
      registry,
      dir,
      dir,
      promptRoot,
    );

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
    });

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validateTemplateUvConsistency(
      registry,
      dir,
      dir,
      promptRoot,
    );

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
    });

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validateTemplateUvConsistency(
      registry,
      dir,
      dir,
      promptRoot,
    );

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
    });

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validateTemplateUvConsistency(
      registry,
      dir,
      dir,
      promptRoot,
    );

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
// 5. Missing C3L prompt file -> skip with warning
// =============================================================================

Deno.test("template-uv-validator - missing C3L prompt produces skip warning", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: [],
    });

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validateTemplateUvConsistency(
      registry,
      dir,
      dir,
      promptRoot,
    );

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
      `Expected ${stepCount} warning(s) (fix: ${VALIDATOR_FILE} missing-file skip). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
    assertEquals(
      result.warnings.some((w) =>
        w.includes(MSG_C3L_NOT_FOUND) && w.includes(MSG_UV_CHECK_SKIPPED)
      ),
      true,
      `Expected warning containing "${MSG_C3L_NOT_FOUND}" and "${MSG_UV_CHECK_SKIPPED}" (fix: ${VALIDATOR_FILE} missing-file skip). Got: ${
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

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validateTemplateUvConsistency(
      registry,
      dir,
      dir,
      promptRoot,
    );

    assertEquals(
      Object.keys(registry.steps as Record<string, unknown>).length,
      0,
      "Test fixture must have zero steps for this edge-case test",
    );
    assertEquals(
      result.valid,
      true,
      `Expected valid result (fix: ${VALIDATOR_FILE} empty steps handling)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected no errors (fix: ${VALIDATOR_FILE} empty steps handling). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.warnings.length,
      0,
      `Expected no warnings (fix: ${VALIDATOR_FILE} empty steps handling). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("template-uv-validator - missing steps key produces no errors", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const registry: Record<string, unknown> = {};

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validateTemplateUvConsistency(
      registry,
      dir,
      dir,
      promptRoot,
    );

    assertEquals(
      result.valid,
      true,
      `Expected valid result (fix: ${VALIDATOR_FILE} missing steps key handling)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected no errors (fix: ${VALIDATOR_FILE} missing steps key handling). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.warnings.length,
      0,
      `Expected no warnings (fix: ${VALIDATOR_FILE} missing steps key handling). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
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
    });

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validateTemplateUvConsistency(
      registry,
      dir,
      dir,
      promptRoot,
    );

    const uvVars = ["issue", "previous_summary", "iteration"];
    assert(
      uvVars.length > 0,
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

Deno.test("template-uv-validator - mixed undeclared and unused produces both error and warning", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Template uses: phase (declared), project_number (NOT declared)
    // uvVariables: phase (used), unused_var (NOT used)
    const templateUvNames = ["phase", "project_number"];
    const declaredUvNames = ["phase", "unused_var"];
    const undeclaredInTemplate = templateUvNames.filter(
      (v) => !declaredUvNames.includes(v),
    ); // ["project_number"]
    const unusedInDeclaration = declaredUvNames.filter(
      (v) => !templateUvNames.includes(v),
    ); // ["unused_var"]

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
      uvVariables: declaredUvNames,
    });

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validateTemplateUvConsistency(
      registry,
      dir,
      dir,
      promptRoot,
    );

    // project_number is used but not declared -> error
    assertEquals(
      result.valid,
      false,
      `Expected invalid result (fix: ${VALIDATOR_FILE} undeclared UV check)`,
    );
    assertEquals(
      result.errors.length,
      undeclaredInTemplate.length,
      `Expected ${undeclaredInTemplate.length} error(s) (fix: ${VALIDATOR_FILE} undeclared UV check). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.errors.some((e) =>
        e.includes("project_number") && e.includes(MSG_NOT_DECLARED)
      ),
      true,
      `Expected error containing "${MSG_NOT_DECLARED}" for project_number (fix: ${VALIDATOR_FILE} undeclared UV check). Got: ${
        JSON.stringify(result.errors)
      }`,
    );

    // unused_var is declared but not used -> warning
    assertEquals(
      result.warnings.length,
      unusedInDeclaration.length,
      `Expected ${unusedInDeclaration.length} warning(s) (fix: ${VALIDATOR_FILE} unused UV warning). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
    assertEquals(
      result.warnings.some((w) =>
        w.includes("unused_var") && w.includes(MSG_NO_UV_PREFIX)
      ),
      true,
      `Expected warning containing "${MSG_NO_UV_PREFIX}" for unused_var (fix: ${VALIDATOR_FILE} unused UV warning). Got: ${
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
    });

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validateTemplateUvConsistency(
      registry,
      dir,
      dir,
      promptRoot,
    );

    assert(
      (
        (registry.steps as Record<string, Record<string, unknown>>)[
          "initial.issue.label_only"
        ].uvVariables as string[]
      ).length > 0,
      "Test fixture must declare UV variables to avoid vacuous pass",
    );
    assertEquals(
      result.valid,
      true,
      `Expected valid result (fix: ${VALIDATOR_FILE} adaptation path resolution)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected no errors (fix: ${VALIDATOR_FILE} adaptation path resolution). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
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
    const declaredUvNames = ["custom_var", "issue"];
    const templateUvNames = ["custom_var"]; // only custom_var in C3L file
    const unusedCount = declaredUvNames.filter(
      (v) => !templateUvNames.includes(v),
    ).length; // 1: "issue"

    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: declaredUvNames,
    });

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validateTemplateUvConsistency(
      registry,
      dir,
      dir,
      promptRoot,
    );

    assertEquals(
      result.valid,
      true,
      `Expected valid result (fix: ${VALIDATOR_FILE} C3L-only UV check)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected no errors (fix: ${VALIDATOR_FILE} C3L-only UV check). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    // "issue" is declared but not used in C3L file -> warning
    assertEquals(
      result.warnings.length,
      unusedCount,
      `Expected ${unusedCount} warning(s) for unused UV (fix: ${VALIDATOR_FILE} C3L-only UV check). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 10. Missing C3L prompt with UV declarations produces skip warning
// =============================================================================

Deno.test("template-uv-validator - missing C3L prompt skips UV check with warning", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const registry = registryWith("continuation.issue", {
      c2: "continuation",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue"],
    });

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validateTemplateUvConsistency(
      registry,
      dir,
      dir,
      promptRoot,
    );

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
      `Expected ${stepCount} warning(s) (fix: ${VALIDATOR_FILE} missing-file skip). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
    assertEquals(
      result.warnings.some((w) =>
        w.includes("continuation.issue") &&
        w.includes(MSG_C3L_NOT_FOUND) &&
        w.includes(MSG_UV_CHECK_SKIPPED)
      ),
      true,
      `Expected warning containing "${MSG_C3L_NOT_FOUND}" and "${MSG_UV_CHECK_SKIPPED}" (fix: ${VALIDATOR_FILE} missing-file skip). Got: ${
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

    const promptRoot = join(dir, "prompts", "steps");
    const result = await validateTemplateUvConsistency(
      registry,
      dir,
      dir,
      promptRoot,
    );

    assertEquals(
      result.valid,
      true,
      `Expected valid result (fix: ${VALIDATOR_FILE} step skip logic)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected no errors for skipped step (fix: ${VALIDATOR_FILE} step skip logic). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
