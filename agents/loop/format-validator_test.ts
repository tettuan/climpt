/**
 * FormatValidator Test Suite
 *
 * Tests format validation for agent responses.
 */

import { assertEquals, assertExists } from "@std/assert";
import { FormatValidator, type ResponseFormat } from "./format-validator.ts";
import type { DetectedAction, IterationSummary } from "../src_common/types.ts";

// Helper to create a minimal iteration summary
function createSummary(
  options: Partial<IterationSummary> = {},
): IterationSummary {
  return {
    iteration: 1,
    assistantResponses: [],
    toolsUsed: [],
    detectedActions: [],
    errors: [],
    ...options,
  };
}

// Helper to create a detected action
function createAction(
  type: string,
  content: string,
  raw?: string,
): DetectedAction {
  return {
    type,
    content,
    raw: raw ?? content,
    metadata: {},
  };
}

Deno.test("FormatValidator", async (t) => {
  const validator = new FormatValidator();

  await t.step("action-block validation", async (st) => {
    await st.step("should validate valid action block", () => {
      const summary = createSummary({
        detectedActions: [
          createAction("issue-action", '{"action":"close","issue":123}'),
        ],
      });

      const format: ResponseFormat = {
        type: "action-block",
        blockType: "issue-action",
        requiredFields: {
          action: "close",
          issue: "number",
        },
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, true);
      assertExists(result.extracted);
      assertEquals(
        (result.extracted as Record<string, unknown>).action,
        "close",
      );
      assertEquals((result.extracted as Record<string, unknown>).issue, 123);
    });

    await st.step("should fail when action block not found", () => {
      const summary = createSummary({
        detectedActions: [
          createAction("other-action", '{"action":"something"}'),
        ],
      });

      const format: ResponseFormat = {
        type: "action-block",
        blockType: "issue-action",
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, false);
      assertExists(result.error);
      assertEquals(
        result.error?.includes("not found"),
        true,
      );
    });

    await st.step("should fail when required field is missing", () => {
      const summary = createSummary({
        detectedActions: [
          createAction("issue-action", '{"action":"close"}'),
        ],
      });

      const format: ResponseFormat = {
        type: "action-block",
        blockType: "issue-action",
        requiredFields: {
          action: "close",
          issue: "number",
        },
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, false);
      assertEquals(result.error?.includes("issue"), true);
      assertEquals(result.error?.includes("missing"), true);
    });

    await st.step("should fail when field type is wrong", () => {
      const summary = createSummary({
        detectedActions: [
          createAction(
            "issue-action",
            '{"action":"close","issue":"not-a-number"}',
          ),
        ],
      });

      const format: ResponseFormat = {
        type: "action-block",
        blockType: "issue-action",
        requiredFields: {
          action: "close",
          issue: "number",
        },
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, false);
      assertEquals(result.error?.includes("number"), true);
    });

    await st.step("should fail when literal value does not match", () => {
      const summary = createSummary({
        detectedActions: [
          createAction("issue-action", '{"action":"progress","issue":123}'),
        ],
      });

      const format: ResponseFormat = {
        type: "action-block",
        blockType: "issue-action",
        requiredFields: {
          action: "close", // Expecting literal "close"
          issue: "number",
        },
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, false);
      assertEquals(result.error?.includes("close"), true);
    });

    await st.step("should fail when blockType is not specified", () => {
      const summary = createSummary();

      const format: ResponseFormat = {
        type: "action-block",
        // blockType not specified
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, false);
      assertEquals(result.error?.includes("blockType"), true);
    });

    await st.step("should handle invalid JSON in action", () => {
      const summary = createSummary({
        detectedActions: [
          createAction("issue-action", "not valid json"),
        ],
      });

      const format: ResponseFormat = {
        type: "action-block",
        blockType: "issue-action",
        requiredFields: {
          action: "close",
        },
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, false);
      assertEquals(
        result.error?.includes("JSON") || result.error?.includes("parse"),
        true,
      );
    });
  });

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
