/**
 * Tests for agents/config/frontmatter-registry-validator.ts
 *
 * Covers validateFrontmatterRegistry() with temp directory fixtures:
 * - Matching frontmatter and registry uvVariables -> valid
 * - Frontmatter has extra var not in registry -> error
 * - Registry has var not in frontmatter -> warning
 * - Missing prompt file -> skip (no error)
 * - No frontmatter in file -> skip
 * - Runtime-supplied vars excluded from comparison
 * - Empty steps in registry -> valid
 * - Step with missing c2/c3/edition is skipped
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  MSG_EXTRA_IN_FRONTMATTER,
  MSG_MISSING_IN_FRONTMATTER,
  validateFrontmatterRegistry,
} from "./frontmatter-registry-validator.ts";

/** Source file for assertion "where" messages. */
const VALIDATOR_FILE = "frontmatter-registry-validator.ts";

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
// 1. Matching frontmatter and registry uvVariables -> valid
// =============================================================================

Deno.test("frontmatter-registry-validator - matching frontmatter and registry produces no errors", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      "---\nuvVariables: [issue, repo]\n---\n# Issue #{uv-issue}\n\nRepo: {uv-repo}",
    );

    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue", "repo"],
    });

    const result = await validateFrontmatterRegistry(registry, dir, dir);

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
      `Expected valid result (fix: ${VALIDATOR_FILE} main comparison). Got errors: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected no errors (fix: ${VALIDATOR_FILE} main comparison). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.warnings.length,
      0,
      `Expected no warnings (fix: ${VALIDATOR_FILE} main comparison). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 2. Frontmatter has extra var not in registry -> error
// =============================================================================

Deno.test("frontmatter-registry-validator - extra var in frontmatter produces error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Frontmatter declares "issue" and "extra_var", registry only declares "issue"
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      "---\nuvVariables: [issue, extra_var]\n---\n# Issue\n\nContent here.",
    );

    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue"],
    });

    const result = await validateFrontmatterRegistry(registry, dir, dir);

    const extraVarCount = 1; // "extra_var" is in frontmatter but not registry
    assertEquals(
      result.valid,
      false,
      `Expected invalid result (fix: ${VALIDATOR_FILE} extra var check)`,
    );
    assertEquals(
      result.errors.length,
      extraVarCount,
      `Expected ${extraVarCount} error(s) for extra frontmatter var (fix: ${VALIDATOR_FILE} extra var check). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.errors.some((e) =>
        e.includes("initial.issue") && e.includes("extra_var") &&
        e.includes(MSG_EXTRA_IN_FRONTMATTER)
      ),
      true,
      `Expected error containing "${MSG_EXTRA_IN_FRONTMATTER}" for extra_var (fix: ${VALIDATOR_FILE} extra var check). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 3. Registry has var not in frontmatter -> warning
// =============================================================================

Deno.test("frontmatter-registry-validator - missing var in frontmatter produces warning", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Frontmatter declares "issue" only, registry declares "issue" and "repo"
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      "---\nuvVariables: [issue]\n---\n# Issue\n\nContent here.",
    );

    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue", "repo"],
    });

    const result = await validateFrontmatterRegistry(registry, dir, dir);

    const missingVarCount = 1; // "repo" is in registry but not frontmatter
    assertEquals(
      result.valid,
      true,
      `Expected valid result (fix: ${VALIDATOR_FILE} missing var warning)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected no errors (fix: ${VALIDATOR_FILE} missing var warning). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.warnings.length,
      missingVarCount,
      `Expected ${missingVarCount} warning(s) for missing frontmatter var (fix: ${VALIDATOR_FILE} missing var warning). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
    assertEquals(
      result.warnings.some((w) =>
        w.includes("initial.issue") && w.includes("repo") &&
        w.includes(MSG_MISSING_IN_FRONTMATTER)
      ),
      true,
      `Expected warning containing "${MSG_MISSING_IN_FRONTMATTER}" for repo (fix: ${VALIDATOR_FILE} missing var warning). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 4. Missing prompt file -> skip (no error)
// =============================================================================

Deno.test("frontmatter-registry-validator - missing prompt file is skipped without error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Do NOT create any prompt file
    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue"],
    });

    const result = await validateFrontmatterRegistry(registry, dir, dir);

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
      0,
      `Expected no warnings (fix: ${VALIDATOR_FILE} missing-file skip). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 5. No frontmatter in file -> skip
// =============================================================================

Deno.test("frontmatter-registry-validator - no frontmatter in file is skipped without error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Prompt file without any frontmatter
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      "# Issue\n\nContent without frontmatter. {uv-issue}",
    );

    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue"],
    });

    const result = await validateFrontmatterRegistry(registry, dir, dir);

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
      `Expected valid result (fix: ${VALIDATOR_FILE} no-frontmatter skip)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected no errors (fix: ${VALIDATOR_FILE} no-frontmatter skip). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.warnings.length,
      0,
      `Expected no warnings (fix: ${VALIDATOR_FILE} no-frontmatter skip). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 6. Runtime-supplied vars excluded from comparison
// =============================================================================

Deno.test("frontmatter-registry-validator - runtime-supplied vars are excluded from comparison", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Frontmatter declares "issue" and "iteration" (runtime-supplied)
    // Registry declares "issue" only
    // "iteration" should NOT produce an error because it's runtime-supplied
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      "---\nuvVariables: [issue, iteration]\n---\n# Issue\n\n{uv-issue} iteration {uv-iteration}",
    );

    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue"],
    });

    const result = await validateFrontmatterRegistry(registry, dir, dir);

    assertEquals(
      result.valid,
      true,
      `Expected valid result (fix: ${VALIDATOR_FILE} runtime-supplied exclusion). Got errors: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected no errors because "iteration" is runtime-supplied (fix: ${VALIDATOR_FILE} runtime-supplied exclusion). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.warnings.length,
      0,
      `Expected no warnings (fix: ${VALIDATOR_FILE} runtime-supplied exclusion). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("frontmatter-registry-validator - runtime-supplied vars in registry are excluded from warnings", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Frontmatter declares "issue" only
    // Registry declares "issue" and "max_iterations" (runtime-supplied)
    // "max_iterations" should NOT produce a warning because it's runtime-supplied
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      "---\nuvVariables: [issue]\n---\n# Issue\n\n{uv-issue}",
    );

    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue", "max_iterations"],
    });

    const result = await validateFrontmatterRegistry(registry, dir, dir);

    assertEquals(
      result.valid,
      true,
      `Expected valid result (fix: ${VALIDATOR_FILE} runtime-supplied exclusion). Got errors: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.warnings.length,
      0,
      `Expected no warnings because "max_iterations" is runtime-supplied (fix: ${VALIDATOR_FILE} runtime-supplied exclusion). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 7. Empty steps in registry -> valid
// =============================================================================

Deno.test("frontmatter-registry-validator - empty steps produces no errors", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const registry: Record<string, unknown> = { c1: "steps", steps: {} };

    const result = await validateFrontmatterRegistry(registry, dir, dir);

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

// =============================================================================
// 8. Step with missing c2/c3/edition is skipped
// =============================================================================

Deno.test("frontmatter-registry-validator - step with missing c2 is skipped", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const registry = registryWith("initial.issue", {
      // c2 missing
      c3: "issue",
      edition: "default",
      uvVariables: ["issue"],
    });

    const result = await validateFrontmatterRegistry(registry, dir, dir);

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

// =============================================================================
// 9. Frontmatter with no uvVariables key -> skip
// =============================================================================

Deno.test("frontmatter-registry-validator - frontmatter without uvVariables key is skipped", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Frontmatter exists but has no uvVariables key
    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      "---\ntitle: Issue Prompt\nversion: 1.0\n---\n# Issue\n\n{uv-issue}",
    );

    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: ["issue"],
    });

    const result = await validateFrontmatterRegistry(registry, dir, dir);

    assertEquals(
      result.valid,
      true,
      `Expected valid result (fix: ${VALIDATOR_FILE} no uvVariables key skip)`,
    );
    assertEquals(
      result.errors.length,
      0,
      `Expected no errors (fix: ${VALIDATOR_FILE} no uvVariables key skip). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.warnings.length,
      0,
      `Expected no warnings (fix: ${VALIDATOR_FILE} no uvVariables key skip). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// 10. Mixed extra and missing vars produce both error and warning
// =============================================================================

Deno.test("frontmatter-registry-validator - mixed extra and missing vars produce both error and warning", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Frontmatter: ["issue", "phantom_var"]
    // Registry: ["issue", "repo"]
    // "phantom_var" in frontmatter but not registry -> error
    // "repo" in registry but not frontmatter -> warning
    const frontmatterVars = ["issue", "phantom_var"];
    const registryVars = ["issue", "repo"];
    const extraInFrontmatter = frontmatterVars.filter(
      (v) => !registryVars.includes(v),
    ); // ["phantom_var"]
    const missingInFrontmatter = registryVars.filter(
      (v) => !frontmatterVars.includes(v),
    ); // ["repo"]

    await createPromptFile(
      dir,
      "steps",
      "initial",
      "issue",
      "default",
      `---\nuvVariables: [${
        frontmatterVars.join(", ")
      }]\n---\n# Issue\n\nContent.`,
    );

    const registry = registryWith("initial.issue", {
      c2: "initial",
      c3: "issue",
      edition: "default",
      uvVariables: registryVars,
    });

    const result = await validateFrontmatterRegistry(registry, dir, dir);

    assertEquals(
      result.valid,
      false,
      `Expected invalid result (fix: ${VALIDATOR_FILE} extra var check)`,
    );
    assertEquals(
      result.errors.length,
      extraInFrontmatter.length,
      `Expected ${extraInFrontmatter.length} error(s) (fix: ${VALIDATOR_FILE} extra var check). Got: ${
        JSON.stringify(result.errors)
      }`,
    );
    assertEquals(
      result.errors.some((e) =>
        e.includes("phantom_var") && e.includes(MSG_EXTRA_IN_FRONTMATTER)
      ),
      true,
      `Expected error containing "${MSG_EXTRA_IN_FRONTMATTER}" for phantom_var (fix: ${VALIDATOR_FILE} extra var check). Got: ${
        JSON.stringify(result.errors)
      }`,
    );

    assertEquals(
      result.warnings.length,
      missingInFrontmatter.length,
      `Expected ${missingInFrontmatter.length} warning(s) (fix: ${VALIDATOR_FILE} missing var warning). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
    assertEquals(
      result.warnings.some((w) =>
        w.includes("repo") && w.includes(MSG_MISSING_IN_FRONTMATTER)
      ),
      true,
      `Expected warning containing "${MSG_MISSING_IN_FRONTMATTER}" for repo (fix: ${VALIDATOR_FILE} missing var warning). Got: ${
        JSON.stringify(result.warnings)
      }`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
