/**
 * Format Validator Tests
 */

import { assertEquals } from "@std/assert";
import type { IterationSummary } from "../src_common/types.ts";
import { FormatValidator, type ResponseFormat } from "./format-validator.ts";

// =============================================================================
// Test Fixtures
// =============================================================================

function createSummary(
  options: {
    responses?: string[];
    detectedActions?: Array<{
      type: string;
      content: string;
      metadata: Record<string, unknown>;
      raw: string;
    }>;
  } = {},
): IterationSummary {
  return {
    iteration: 1,
    assistantResponses: options.responses ?? [],
    toolsUsed: [],
    detectedActions: options.detectedActions ?? [],
    errors: [],
  };
}

// =============================================================================
// Action Block Validation Tests
// =============================================================================

Deno.test("FormatValidator - validates action-block from detected actions", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    detectedActions: [
      {
        type: "issue-action",
        content: "",
        metadata: {},
        raw: '{"action": "close", "issue": 123, "body": "Done"}',
      },
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
  assertEquals(result.extracted, { action: "close", issue: 123, body: "Done" });
});

Deno.test("FormatValidator - extracts action-block from assistant response", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    responses: [
      `Here is the completion signal:

\`\`\`issue-action
{
  "action": "close",
  "issue": 456,
  "body": "## Resolution\\n\\n- Fixed the bug"
}
\`\`\`
`,
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
  assertEquals((result.extracted as Record<string, unknown>).action, "close");
  assertEquals((result.extracted as Record<string, unknown>).issue, 456);
});

Deno.test("FormatValidator - fails when action-block not found", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    responses: ["Just some text without any action block"],
  });

  const format: ResponseFormat = {
    type: "action-block",
    blockType: "issue-action",
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("not found"), true);
});

Deno.test("FormatValidator - fails when required field is missing", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    detectedActions: [
      {
        type: "issue-action",
        content: "",
        metadata: {},
        raw: '{"action": "close"}', // Missing "issue" field
      },
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

Deno.test("FormatValidator - fails when field has wrong type", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    detectedActions: [
      {
        type: "issue-action",
        content: "",
        metadata: {},
        raw: '{"action": "close", "issue": "not-a-number"}',
      },
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

Deno.test("FormatValidator - fails when specific value doesn't match", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    detectedActions: [
      {
        type: "issue-action",
        content: "",
        metadata: {},
        raw: '{"action": "comment", "issue": 123}',
      },
    ],
  });

  const format: ResponseFormat = {
    type: "action-block",
    blockType: "issue-action",
    requiredFields: {
      action: "close", // Expected "close" but got "comment"
      issue: "number",
    },
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("close"), true);
});

// =============================================================================
// JSON Validation Tests
// =============================================================================

Deno.test("FormatValidator - validates JSON format", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    responses: ['{"status": "ok", "count": 5}'],
  });

  const format: ResponseFormat = {
    type: "json",
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, true);
  assertEquals(result.extracted, { status: "ok", count: 5 });
});

Deno.test("FormatValidator - extracts JSON from code block", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    responses: [
      `Here is the result:
\`\`\`json
{
  "name": "test",
  "value": 42
}
\`\`\`
`,
    ],
  });

  const format: ResponseFormat = {
    type: "json",
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, true);
  assertEquals((result.extracted as Record<string, unknown>).name, "test");
  assertEquals((result.extracted as Record<string, unknown>).value, 42);
});

Deno.test("FormatValidator - fails when no JSON found", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    responses: ["This is just plain text without JSON"],
  });

  const format: ResponseFormat = {
    type: "json",
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("JSON"), true);
});

Deno.test("FormatValidator - validates JSON with basic schema", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    responses: ['{"name": "test", "count": 10}'],
  });

  const format: ResponseFormat = {
    type: "json",
    schema: {
      required: ["name", "count"],
      properties: {
        name: { type: "string" },
        count: { type: "number" },
      },
    },
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, true);
});

Deno.test("FormatValidator - fails JSON schema validation for missing property", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    responses: ['{"name": "test"}'],
  });

  const format: ResponseFormat = {
    type: "json",
    schema: {
      required: ["name", "count"],
    },
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("count"), true);
});

// =============================================================================
// Text Pattern Validation Tests
// =============================================================================

Deno.test("FormatValidator - validates text pattern", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    responses: ["Task completed: SUCCESS"],
  });

  const format: ResponseFormat = {
    type: "text-pattern",
    pattern: "Task completed: (SUCCESS|FAILURE)",
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, true);
  assertEquals(
    (result.extracted as Record<string, unknown>).fullMatch,
    "Task completed: SUCCESS",
  );
});

Deno.test("FormatValidator - extracts named groups from pattern", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    responses: ["Issue #123 closed by user@example.com"],
  });

  const format: ResponseFormat = {
    type: "text-pattern",
    pattern: "Issue #(?<issue>\\d+) closed by (?<user>\\S+)",
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, true);
  const extracted = result.extracted as {
    groups: Record<string, string>;
    captures: string[];
  };
  assertEquals(extracted.groups.issue, "123");
  assertEquals(extracted.groups.user, "user@example.com");
});

Deno.test("FormatValidator - fails when pattern not matched", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    responses: ["Something else entirely"],
  });

  const format: ResponseFormat = {
    type: "text-pattern",
    pattern: "Task completed: \\w+",
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("not found"), true);
});

Deno.test("FormatValidator - fails when pattern is not provided", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    responses: ["Any text"],
  });

  const format: ResponseFormat = {
    type: "text-pattern",
    // Missing pattern
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("required"), true);
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("FormatValidator - handles empty responses", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    responses: [],
  });

  const format: ResponseFormat = {
    type: "action-block",
    blockType: "issue-action",
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, false);
});

Deno.test("FormatValidator - handles unknown format type", () => {
  const validator = new FormatValidator();
  const summary = createSummary();

  const format = {
    type: "unknown-type",
  } as unknown as ResponseFormat;

  const result = validator.validate(summary, format);

  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("Unknown format type"), true);
});

Deno.test("FormatValidator - handles invalid JSON in action block", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    detectedActions: [
      {
        type: "issue-action",
        content: "",
        metadata: {},
        raw: "not valid json {",
      },
    ],
  });

  const format: ResponseFormat = {
    type: "action-block",
    blockType: "issue-action",
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("Invalid JSON"), true);
});

Deno.test("FormatValidator - validates without requiredFields", () => {
  const validator = new FormatValidator();
  const summary = createSummary({
    detectedActions: [
      {
        type: "issue-action",
        content: "",
        metadata: {},
        raw: '{"any": "data"}',
      },
    ],
  });

  const format: ResponseFormat = {
    type: "action-block",
    blockType: "issue-action",
    // No requiredFields specified
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, true);
  assertEquals(result.extracted, { any: "data" });
});

Deno.test("FormatValidator - requires blockType for action-block", () => {
  const validator = new FormatValidator();
  const summary = createSummary();

  const format: ResponseFormat = {
    type: "action-block",
    // Missing blockType
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, false);
  assertEquals(result.error?.includes("blockType"), true);
});
