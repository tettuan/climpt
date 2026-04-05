/**
 * Tests for C3LPromptLoader
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { C3LPromptLoader } from "./c3l-prompt-loader.ts";
import type { C3LPath } from "./c3l-prompt-loader.ts";

/**
 * Derive the expected prompt path from the agent ID and C3L path components.
 * Mirrors C3LPromptLoader.buildPromptPath so tests stay in sync with the
 * production path-construction logic without duplicating a magic string.
 */
function expectedPromptPath(agentId: string, path: C3LPath): string {
  const edition = path.edition ?? "default";
  const filename = path.adaptation
    ? `f_${edition}_${path.adaptation}.md`
    : `f_${edition}.md`;
  return `.agent/${agentId}/prompts/${path.c1}/${path.c2}/${path.c3}/${filename}`;
}

Deno.test("C3LPromptLoader - creates correct config name", () => {
  const loader = new C3LPromptLoader({
    agentId: "iterator",
    configSuffix: "dev",
  });
  assertEquals(loader.getConfigName(), "iterator-dev");
});

Deno.test("C3LPromptLoader - creates config name without suffix", () => {
  const loader = new C3LPromptLoader({
    agentId: "myagent",
  });
  assertEquals(loader.getConfigName(), "myagent");
});

Deno.test("C3LPromptLoader - creates iterator loader via constructor", () => {
  const loader = new C3LPromptLoader({
    agentId: "iterator",
    configSuffix: "dev",
  });
  assertEquals(loader.getConfigName(), "iterator-dev");
});

Deno.test("C3LPromptLoader - load issue prompt with return mode", async () => {
  const loader = new C3LPromptLoader({
    agentId: "iterator",
    configSuffix: "dev",
  });

  const result = await loader.load(
    { c1: "dev", c2: "start", c3: "issue" },
    {
      uv: {
        agent_name: "climpt",
        completion_criteria: "test completion",
        target_label: "docs",
      },
      inputText: "Test input text for {input_text}",
    },
  );

  // deno-lint-ignore no-console
  console.log("Load result:", {
    ok: result.ok,
    hasContent: !!result.content,
    contentLength: result.content?.length,
    error: result.error,
    promptPath: result.promptPath,
  });

  // Load must succeed; fail loudly if it does not
  assertExists(result);
  assert(result.ok, `Expected load to succeed but got error: ${result.error}`);
  assertExists(result.content, "Content must be present on successful load");

  // Content should have UV variables substituted
  assertEquals(result.content.includes("{uv-agent_name}"), false);
  // Content should contain actual values
  assertEquals(result.content.includes("climpt"), true);

  // Prompt path should match the C3L path components
  const c3lPath: C3LPath = { c1: "dev", c2: "start", c3: "issue" };
  assertEquals(result.promptPath, expectedPromptPath("iterator", c3lPath));
});

Deno.test("C3LPromptLoader - load with custom edition", async () => {
  const loader = new C3LPromptLoader({
    agentId: "iterator",
    configSuffix: "dev",
  });

  // Try loading a non-default edition (processing)
  const result = await loader.load(
    { c1: "dev", c2: "start", c3: "project", edition: "processing" },
    {
      uv: {
        agent_name: "climpt",
        completion_criteria: "test",
        target_label: "docs",
      },
    },
  );

  // deno-lint-ignore no-console
  console.log("Processing edition result:", {
    ok: result.ok,
    promptPath: result.promptPath,
    error: result.error,
  });

  assertExists(result);
  assert(
    result.ok,
    `Expected processing edition load to succeed but got error: ${result.error}`,
  );

  // Prompt path should reflect the custom edition
  const c3lPath: C3LPath = {
    c1: "dev",
    c2: "start",
    c3: "project",
    edition: "processing",
  };
  assertEquals(result.promptPath, expectedPromptPath("iterator", c3lPath));
});

// ============================================================================
// Reviewer Integration Tests
// ============================================================================

Deno.test("C3LPromptLoader - creates reviewer loader via constructor", () => {
  const loader = new C3LPromptLoader({
    agentId: "reviewer",
    configSuffix: "dev",
  });
  assertEquals(loader.getConfigName(), "reviewer-dev");
});

Deno.test("Reviewer - load default prompt", async () => {
  const loader = new C3LPromptLoader({
    agentId: "reviewer",
    configSuffix: "dev",
  });

  const result = await loader.load(
    { c1: "dev", c2: "start", c3: "default" },
    {
      uv: {
        project: "test-project",
        requirements_label: "requirements",
        review_label: "review",
      },
    },
  );

  // deno-lint-ignore no-console
  console.log("Reviewer load result:", {
    ok: result.ok,
    hasContent: !!result.content,
    contentLength: result.content?.length,
    error: result.error,
    promptPath: result.promptPath,
  });

  assertExists(result);
  assert(
    result.ok,
    `Expected reviewer load to succeed but got error: ${result.error}`,
  );
  assertExists(result.content, "Content must be present on successful load");

  // Prompt path should match the C3L path components
  const c3lPath: C3LPath = { c1: "dev", c2: "start", c3: "default" };
  assertEquals(result.promptPath, expectedPromptPath("reviewer", c3lPath));
});
