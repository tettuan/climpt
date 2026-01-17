/**
 * FormatValidator Test Suite
 *
 * Tests format validation for agent responses.
 */

import { assertEquals, assertExists } from "@std/assert";
import { FormatValidator, type ResponseFormat } from "./format-validator.ts";
import type { IterationSummary } from "../src_common/types.ts";

// Helper to create a minimal iteration summary
function createSummary(
  options: Partial<IterationSummary> = {},
): IterationSummary {
  return {
    iteration: 1,
    assistantResponses: [],
    toolsUsed: [],
    errors: [],
    ...options,
  };
}

Deno.test("FormatValidator", async (t) => {
  const validator = new FormatValidator();

  await t.step("json validation", async (st) => {
    await st.step("should validate valid JSON block", () => {
      const summary = createSummary({
        assistantResponses: [
          'Here is the result:\n```json\n{"name": "test", "value": 42}\n```',
        ],
      });

      const format: ResponseFormat = {
        type: "json",
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, true);
      assertExists(result.extracted);
      assertEquals((result.extracted as Record<string, unknown>).name, "test");
    });

    await st.step("should fail when no JSON block found", () => {
      const summary = createSummary({
        assistantResponses: ["Just text, no JSON here"],
      });

      const format: ResponseFormat = {
        type: "json",
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, false);
      assertEquals(result.error?.includes("No JSON block"), true);
    });

    await st.step("should validate schema required properties", () => {
      const summary = createSummary({
        assistantResponses: [
          '```json\n{"name": "test"}\n```',
        ],
      });

      const format: ResponseFormat = {
        type: "json",
        schema: {
          required: ["name", "value"],
        },
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, false);
      assertEquals(result.error?.includes("value"), true);
    });
  });

  await t.step("text-pattern validation", async (st) => {
    await st.step("should validate matching pattern", () => {
      const summary = createSummary({
        assistantResponses: ["The task is COMPLETE-123"],
      });

      const format: ResponseFormat = {
        type: "text-pattern",
        pattern: "COMPLETE-\\d+",
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, true);
      assertEquals(result.extracted, "COMPLETE-123");
    });

    await st.step("should fail when pattern not found", () => {
      const summary = createSummary({
        assistantResponses: ["No matching text here"],
      });

      const format: ResponseFormat = {
        type: "text-pattern",
        pattern: "COMPLETE-\\d+",
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, false);
      assertEquals(result.error?.includes("not found"), true);
    });

    await st.step("should fail when pattern is not specified", () => {
      const summary = createSummary();

      const format: ResponseFormat = {
        type: "text-pattern",
        // pattern not specified
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, false);
      assertEquals(result.error?.includes("pattern"), true);
    });

    await st.step("should fail on invalid regex pattern", () => {
      const summary = createSummary({
        assistantResponses: ["Some text"],
      });

      const format: ResponseFormat = {
        type: "text-pattern",
        pattern: "[invalid(regex",
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, false);
      assertEquals(result.error?.includes("Invalid regex"), true);
    });
  });

  await t.step("unknown format type", async (st) => {
    await st.step("should fail on unknown format type", () => {
      const summary = createSummary();

      const format = {
        type: "unknown-type",
      } as unknown as ResponseFormat;

      const result = validator.validate(summary, format);

      assertEquals(result.valid, false);
      assertEquals(result.error?.includes("Unknown format type"), true);
    });
  });
});
