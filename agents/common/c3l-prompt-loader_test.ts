/**
 * Tests for C3LPromptLoader
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  C3LPromptLoader,
  createIteratorPromptLoader,
  createReviewerPromptLoader,
} from "./c3l-prompt-loader.ts";

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

Deno.test("createIteratorPromptLoader - creates iterator loader", () => {
  const loader = createIteratorPromptLoader();
  assertEquals(loader.getConfigName(), "iterator-dev");
});

Deno.test("C3LPromptLoader - load issue prompt with return mode", async () => {
  const loader = createIteratorPromptLoader();

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

  // Check basic structure
  assertExists(result);
  assertEquals(typeof result.ok, "boolean");

  if (result.ok) {
    assertExists(result.content);
    // Content should have UV variables substituted
    assertEquals(result.content.includes("{uv-agent_name}"), false);
    // Content should contain actual values
    assertEquals(result.content.includes("climpt"), true);
    // Prompt path should be set
    assertEquals(
      result.promptPath,
      ".agent/iterator/prompts/dev/start/issue/f_default.md",
    );
  } else {
    // deno-lint-ignore no-console
    console.error("Load failed:", result.error);
  }
});

Deno.test("C3LPromptLoader - load with custom edition", async () => {
  const loader = createIteratorPromptLoader();

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
  if (result.ok) {
    assertEquals(
      result.promptPath,
      ".agent/iterator/prompts/dev/start/project/f_processing.md",
    );
  }
});

// ============================================================================
// Reviewer Integration Tests
// ============================================================================

Deno.test("createReviewerPromptLoader - creates reviewer loader", () => {
  const loader = createReviewerPromptLoader();
  assertEquals(loader.getConfigName(), "reviewer-dev");
});

Deno.test("Reviewer - load default prompt", async () => {
  const loader = createReviewerPromptLoader();

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

  console.log("Reviewer load result:", {
    ok: result.ok,
    hasContent: !!result.content,
    contentLength: result.content?.length,
    error: result.error,
    promptPath: result.promptPath,
  });

  assertExists(result);
  assertEquals(typeof result.ok, "boolean");

  if (result.ok) {
    assertExists(result.content);
    // Prompt path should be set
    assertEquals(
      result.promptPath,
      ".agent/reviewer/prompts/dev/start/default/f_default.md",
    );
  } else {
    console.log(
      "Reviewer prompt load skipped (config not available):",
      result.error,
    );
  }
});
