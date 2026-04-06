/**
 * FormatValidator Test Suite
 *
 * Tests format validation for agent responses.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { FormatValidator } from "./format-validator.ts";
import type { ResponseFormat } from "../common/validation-types.ts";
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
      assertStringIncludes(result.error ?? "", "No JSON block");
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
          type: "object",
          required: ["name", "value"],
          properties: {
            name: { type: "string" },
            value: { type: "number" },
          },
        },
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, false);
      assertStringIncludes(result.error ?? "", "value");
      assertStringIncludes(result.error ?? "", "Required");
    });

    await st.step(
      "should pass when valid JSON matches schema with all required fields",
      () => {
        const summary = createSummary({
          assistantResponses: [
            '```json\n{"name": "test", "value": 42}\n```',
          ],
        });

        const format: ResponseFormat = {
          type: "json",
          schema: {
            type: "object",
            required: ["name", "value"],
            properties: {
              name: { type: "string" },
              value: { type: "number" },
            },
          },
        };

        const result = validator.validate(summary, format);

        assertEquals(result.valid, true);
        assertExists(result.extracted);
        const data = result.extracted as Record<string, unknown>;
        assertEquals(data.name, "test");
        assertEquals(data.value, 42);
      },
    );

    await st.step(
      "should fail when property type does not match schema",
      () => {
        const summary = createSummary({
          assistantResponses: [
            '```json\n{"name": 123, "value": "not-a-number"}\n```',
          ],
        });

        const format: ResponseFormat = {
          type: "json",
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              value: { type: "number" },
            },
          },
        };

        const result = validator.validate(summary, format);

        assertEquals(result.valid, false);
        assertStringIncludes(result.error ?? "", "Schema validation failed");
        // Error should mention the field path for debuggability
        assertStringIncludes(result.error ?? "", "name");
      },
    );

    await st.step(
      "should fail when value violates enum constraint",
      () => {
        const summary = createSummary({
          assistantResponses: [
            '```json\n{"status": "unknown"}\n```',
          ],
        });

        const format: ResponseFormat = {
          type: "json",
          schema: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["ok", "error", "pending"] },
            },
          },
        };

        const result = validator.validate(summary, format);

        assertEquals(result.valid, false);
        assertStringIncludes(result.error ?? "", "Schema validation failed");
        assertEquals(
          result.error?.includes("enum") || result.error?.includes("not in"),
          true,
        );
      },
    );

    await st.step(
      "should validate nested object properties",
      () => {
        const summary = createSummary({
          assistantResponses: [
            '```json\n{"result": {"code": 200, "message": "ok"}}\n```',
          ],
        });

        const format: ResponseFormat = {
          type: "json",
          schema: {
            type: "object",
            required: ["result"],
            properties: {
              result: {
                type: "object",
                required: ["code", "message"],
                properties: {
                  code: { type: "number" },
                  message: { type: "string" },
                },
              },
            },
          },
        };

        const result = validator.validate(summary, format);

        assertEquals(result.valid, true);
        assertExists(result.extracted);
      },
    );

    await st.step(
      "should fail when nested required field is missing",
      () => {
        const summary = createSummary({
          assistantResponses: [
            '```json\n{"result": {"code": 200}}\n```',
          ],
        });

        const format: ResponseFormat = {
          type: "json",
          schema: {
            type: "object",
            properties: {
              result: {
                type: "object",
                required: ["code", "message"],
                properties: {
                  code: { type: "number" },
                  message: { type: "string" },
                },
              },
            },
          },
        };

        const result = validator.validate(summary, format);

        assertEquals(result.valid, false);
        assertStringIncludes(result.error ?? "", "message");
        assertStringIncludes(result.error ?? "", "Required");
      },
    );

    await st.step(
      "should perform basic JSON validation only when no schema provided",
      () => {
        const summary = createSummary({
          assistantResponses: [
            '```json\n{"any": "structure", "is": true}\n```',
          ],
        });

        const format: ResponseFormat = {
          type: "json",
        };

        const result = validator.validate(summary, format);

        assertEquals(result.valid, true);
        assertExists(result.extracted);
        assertEquals(
          (result.extracted as Record<string, unknown>).any,
          "structure",
        );
      },
    );

    await st.step(
      "should validate array items against schema",
      () => {
        const summary = createSummary({
          assistantResponses: [
            '```json\n{"items": [1, 2, "three"]}\n```',
          ],
        });

        const format: ResponseFormat = {
          type: "json",
          schema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: { type: "number" },
              },
            },
          },
        };

        const result = validator.validate(summary, format);

        assertEquals(result.valid, false);
        assertStringIncludes(result.error ?? "", "Schema validation failed");
        // Should report the specific array index
        assertStringIncludes(result.error ?? "", "[2]");
      },
    );

    await st.step(
      "should report multiple schema errors in single message",
      () => {
        const summary = createSummary({
          assistantResponses: [
            '```json\n{"name": 123}\n```',
          ],
        });

        const format: ResponseFormat = {
          type: "json",
          schema: {
            type: "object",
            required: ["name", "age"],
            properties: {
              name: { type: "string" },
              age: { type: "number" },
            },
          },
        };

        const result = validator.validate(summary, format);

        assertEquals(result.valid, false);
        // Should contain errors for both type mismatch and missing required
        assertStringIncludes(result.error ?? "", "name");
        assertStringIncludes(result.error ?? "", "age");
      },
    );
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
      assertStringIncludes(result.error ?? "", "not found");
    });

    await st.step("should fail when pattern is not specified", () => {
      const summary = createSummary();

      const format: ResponseFormat = {
        type: "text-pattern",
        // pattern not specified
      };

      const result = validator.validate(summary, format);

      assertEquals(result.valid, false);
      assertStringIncludes(result.error ?? "", "pattern");
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
      assertStringIncludes(result.error ?? "", "Invalid regex");
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
      assertStringIncludes(result.error ?? "", "Unknown format type");
    });
  });
});
