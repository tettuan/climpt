/**
 * Tests for agents/config/c3l-path-builder.ts
 *
 * Unit tests for the two public functions:
 * - resolvePromptRoot: delegates to BreakdownConfig (app.yml + user.yml merged)
 * - buildPromptFilePath: C3L filename construction
 *
 * Source of truth: BreakdownConfig from @tettuan/breakdownconfig.
 * Config files are expected at {projectRoot}/.agent/climpt/config/{agentId}-{c1}-app.yml.
 *
 * @module
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { buildPromptFilePath, resolvePromptRoot } from "./c3l-path-builder.ts";

/** Source file under test, referenced in assertion messages. */
const SRC = "c3l-path-builder.ts";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a temp project directory with BreakdownConfig-compatible structure:
 *   {projectRoot}/.agent/climpt/config/{agentId}-{c1}-app.yml
 *
 * Optionally creates a user.yml alongside it.
 */
async function createConfigLayout(
  agentId: string,
  c1: string,
  appYml: string,
  userYml?: string,
): Promise<string> {
  const projectRoot = await Deno.makeTempDir({
    prefix: "c3l-path-builder-test-",
  });
  const configDir = join(projectRoot, ".agent", "climpt", "config");
  await Deno.mkdir(configDir, { recursive: true });
  const prefix = `${agentId}-${c1}`;
  await Deno.writeTextFile(join(configDir, `${prefix}-app.yml`), appYml);
  if (userYml) {
    await Deno.writeTextFile(join(configDir, `${prefix}-user.yml`), userYml);
  }
  return projectRoot;
}

// =============================================================================
// resolvePromptRoot
// =============================================================================

Deno.test("resolvePromptRoot — valid app.yml returns resolved prompt dir", async () => {
  const appYml = [
    'working_dir: ".agent/iterator"',
    "app_prompt:",
    '  base_dir: "prompts/steps"',
    "app_schema:",
    '  base_dir: "schema/steps"',
  ].join("\n");
  const projectRoot = await createConfigLayout("iterator", "steps", appYml);
  try {
    const result = await resolvePromptRoot(projectRoot, "iterator", "steps");

    // BreakdownConfig resolves: resolve(resolve(projectRoot, working_dir), base_dir)
    const expected = resolve(
      resolve(projectRoot, ".agent/iterator"),
      "prompts/steps",
    );
    assertNotEquals(
      result,
      null,
      `Expected non-null for valid config (fix: ${SRC} resolvePromptRoot)`,
    );
    assertEquals(
      result,
      expected,
      `Expected resolved prompt dir (fix: ${SRC} resolvePromptRoot)`,
    );
  } finally {
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test("resolvePromptRoot — user.yml overrides base_dir", async () => {
  const appYml = [
    'working_dir: ".agent/iterator"',
    "app_prompt:",
    '  base_dir: "prompts/steps"',
    "app_schema:",
    '  base_dir: "schema/steps"',
  ].join("\n");
  const userYml = [
    "app_prompt:",
    '  base_dir: "custom/prompts"',
  ].join("\n");
  const projectRoot = await createConfigLayout(
    "iterator",
    "steps",
    appYml,
    userYml,
  );
  try {
    const result = await resolvePromptRoot(projectRoot, "iterator", "steps");

    // user.yml overrides app_prompt.base_dir
    const expected = resolve(
      resolve(projectRoot, ".agent/iterator"),
      "custom/prompts",
    );
    assertNotEquals(
      result,
      null,
      `Expected non-null when user.yml provides override (fix: ${SRC} resolvePromptRoot)`,
    );
    assertEquals(
      result,
      expected,
      `Expected user.yml override to take effect (fix: ${SRC} resolvePromptRoot via BreakdownConfig merge)`,
    );
  } finally {
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test("resolvePromptRoot — missing app.yml returns null", async () => {
  const projectRoot = await Deno.makeTempDir({
    prefix: "c3l-path-builder-test-",
  });
  // Create config dir but no app.yml — BreakdownConfig requires app.yml
  const configDir = join(projectRoot, ".agent", "climpt", "config");
  await Deno.mkdir(configDir, { recursive: true });
  try {
    const result = await resolvePromptRoot(
      projectRoot,
      "nonexistent",
      "steps",
    );

    assertEquals(
      result,
      null,
      `Expected null when app.yml does not exist (fix: ${SRC} resolvePromptRoot null on missing config)`,
    );
  } finally {
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test("resolvePromptRoot — no config dir at all returns null", async () => {
  const projectRoot = await Deno.makeTempDir({
    prefix: "c3l-path-builder-test-",
  });
  // No .agent/climpt/config/ directory created at all
  try {
    const result = await resolvePromptRoot(projectRoot, "test", "steps");

    assertEquals(
      result,
      null,
      `Expected null when config dir does not exist (fix: ${SRC} resolvePromptRoot null on missing dir)`,
    );
  } finally {
    await Deno.remove(projectRoot, { recursive: true });
  }
});

// =============================================================================
// buildPromptFilePath
// =============================================================================

Deno.test("buildPromptFilePath — without adaptation", () => {
  const result = buildPromptFilePath(
    "/root/prompts/steps",
    "initial",
    "issue",
    "default",
  );

  assertEquals(
    result,
    join("/root/prompts/steps", "initial", "issue", "f_default.md"),
    `Expected {promptRoot}/{c2}/{c3}/f_{edition}.md (fix: ${SRC} buildPromptFilePath)`,
  );
});

Deno.test("buildPromptFilePath — with adaptation", () => {
  const result = buildPromptFilePath(
    "/root/prompts/steps",
    "initial",
    "issue",
    "default",
    "label_only",
  );

  assertEquals(
    result,
    join(
      "/root/prompts/steps",
      "initial",
      "issue",
      "f_default_label_only.md",
    ),
    `Expected {promptRoot}/{c2}/{c3}/f_{edition}_{adaptation}.md (fix: ${SRC} buildPromptFilePath)`,
  );
});

Deno.test("buildPromptFilePath — custom edition", () => {
  const result = buildPromptFilePath(
    "/root/prompts/steps",
    "continuation",
    "review",
    "processing",
  );

  assertEquals(
    result,
    join("/root/prompts/steps", "continuation", "review", "f_processing.md"),
    `Expected f_processing.md for edition="processing" (fix: ${SRC} buildPromptFilePath)`,
  );
});
