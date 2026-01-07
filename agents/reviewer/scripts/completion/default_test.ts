/**
 * DefaultReviewCompletionHandler Tests
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  createReviewerFallbackProvider,
  FALLBACK_PROMPTS,
} from "../fallback-prompts.ts";

// Test fallback prompts
Deno.test("fallback-prompts: FALLBACK_PROMPTS has required keys", () => {
  assertEquals("initial_default" in FALLBACK_PROMPTS, true);
  assertEquals("continuation_default" in FALLBACK_PROMPTS, true);
});

Deno.test("fallback-prompts: initial_default contains required placeholders", () => {
  const prompt = FALLBACK_PROMPTS.initial_default;
  assertStringIncludes(prompt, "{uv-project}");
  assertStringIncludes(prompt, "{uv-requirements_label}");
  assertStringIncludes(prompt, "{uv-review_label}");
  assertStringIncludes(prompt, "{requirements_issues}");
  assertStringIncludes(prompt, "{review_targets}");
  assertStringIncludes(prompt, "{traceability_ids}");
});

Deno.test("fallback-prompts: continuation_default contains required placeholders", () => {
  const prompt = FALLBACK_PROMPTS.continuation_default;
  assertStringIncludes(prompt, "{uv-iteration}");
  assertStringIncludes(prompt, "{created_issues}");
  assertStringIncludes(prompt, "{errors}");
});

Deno.test("fallback-prompts: createReviewerFallbackProvider returns valid provider", () => {
  const provider = createReviewerFallbackProvider();

  assertEquals(provider.hasPrompt("initial_default"), true);
  assertEquals(provider.hasPrompt("continuation_default"), true);
  assertEquals(provider.hasPrompt("nonexistent"), false);

  const prompt = provider.getPrompt("initial_default");
  assertEquals(typeof prompt, "string");
  assertStringIncludes(prompt!, "Review Task");
});

// Test types
Deno.test("types: formatIterationSummary formats correctly", async () => {
  const { formatIterationSummary } = await import("./types.ts");

  const summary = {
    iteration: 1,
    assistantResponses: ["Analyzed the codebase"],
    toolsUsed: ["Grep", "Read"],
    reviewActions: [{
      action: "create-issue" as const,
      body: "Gap found",
      title: "Gap",
    }],
    errors: [],
  };

  const formatted = formatIterationSummary(summary);
  assertStringIncludes(formatted, "Iteration 1");
  assertStringIncludes(formatted, "Analyzed the codebase");
  assertStringIncludes(formatted, "Grep");
  assertStringIncludes(formatted, "create-issue");
});

Deno.test("types: formatIterationSummary handles errors", async () => {
  const { formatIterationSummary } = await import("./types.ts");

  const summary = {
    iteration: 2,
    assistantResponses: [],
    toolsUsed: [],
    reviewActions: [],
    errors: ["Error 1", "Error 2"],
  };

  const formatted = formatIterationSummary(summary);
  assertStringIncludes(formatted, "Errors encountered");
  assertStringIncludes(formatted, "Error 1");
});

Deno.test("types: formatIterationSummary truncates long responses", async () => {
  const { formatIterationSummary } = await import("./types.ts");

  const longResponse = "x".repeat(2000);
  const summary = {
    iteration: 1,
    assistantResponses: [longResponse],
    toolsUsed: [],
    reviewActions: [],
    errors: [],
  };

  const formatted = formatIterationSummary(summary);
  assertStringIncludes(formatted, "...");
  // Should be truncated to 1000 chars + "..."
  assertEquals(formatted.includes("x".repeat(1001)), false);
});
