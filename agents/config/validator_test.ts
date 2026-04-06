/**
 * Tests for agents/config/validator.ts
 *
 * Covers:
 * - P3-2: CLI flag uniqueness across parameters
 * - P3-3: Parameter type vs default value type consistency
 */

import { assertEquals } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { validate } from "./validator.ts";

const logger = new BreakdownLogger("validator");

// =============================================================================
// Fixture: minimal valid definition with parameters
// =============================================================================

function minimalDefinitionWithParams(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  return {
    name: "test-agent",
    displayName: "Test Agent",
    runner: {
      verdict: { type: "count:iteration", config: { maxIterations: 3 } },
      boundaries: { permissionMode: "default", allowedTools: ["Read"] },
    },
    parameters,
  };
}

// =============================================================================
// P3-2: CLI flag uniqueness
// =============================================================================

Deno.test("validator/parameters - duplicate CLI flag produces error", () => {
  const def = minimalDefinitionWithParams({
    output: {
      type: "string",
      description: "Output path",
      cli: "--output",
    },
    destination: {
      type: "string",
      description: "Destination path",
      cli: "--output",
    },
  });

  logger.debug("validate input (duplicate CLI flag)", {
    paramNames: ["output", "destination"],
  });
  const result = validate(def);
  logger.debug("validate result", {
    valid: result.valid,
    errorCount: result.errors.length,
  });

  assertEquals(result.valid, false, "Should be invalid when CLI flags collide");

  const duplicateError = result.errors.find((e) =>
    e.includes("CLI flag '--output' is used by multiple parameters")
  );
  assertEquals(
    duplicateError !== undefined,
    true,
    `Expected duplicate CLI flag error, got errors: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("validator/parameters - unique CLI flags pass without error", () => {
  const def = minimalDefinitionWithParams({
    output: {
      type: "string",
      description: "Output path",
      cli: "--output",
    },
    format: {
      type: "string",
      description: "Output format",
      cli: "--format",
    },
  });

  logger.debug("validate input (unique CLI flags)", {
    paramNames: ["output", "format"],
  });
  const result = validate(def);
  logger.debug("validate result", {
    valid: result.valid,
    errorCount: result.errors.length,
  });

  const duplicateError = result.errors.find((e) =>
    e.includes("is used by multiple parameters")
  );
  assertEquals(
    duplicateError,
    undefined,
    `Should have no duplicate CLI flag errors, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

// =============================================================================
// P3-3: Parameter type vs default value type consistency
// =============================================================================

Deno.test("validator/parameters - type number with string default produces error", () => {
  const def = minimalDefinitionWithParams({
    count: {
      type: "number",
      description: "Item count",
      cli: "--count",
      default: "five",
    },
  });

  logger.debug("validate input (number type, string default)", {
    paramName: "count",
  });
  const result = validate(def);
  logger.debug("validate result", {
    valid: result.valid,
    errorCount: result.errors.length,
  });

  assertEquals(
    result.valid,
    false,
    "Should be invalid on type/default mismatch",
  );

  const mismatchError = result.errors.find((e) =>
    e.includes("Parameter 'count'") &&
    e.includes("default value type 'string'") &&
    e.includes("declared type 'number'")
  );
  assertEquals(
    mismatchError !== undefined,
    true,
    `Expected type mismatch error for 'count', got errors: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("validator/parameters - type number with number default passes", () => {
  const def = minimalDefinitionWithParams({
    count: {
      type: "number",
      description: "Item count",
      cli: "--count",
      default: 42,
    },
  });

  logger.debug("validate input (number type, number default)", {
    paramName: "count",
  });
  const result = validate(def);
  logger.debug("validate result", {
    valid: result.valid,
    errorCount: result.errors.length,
  });

  const mismatchError = result.errors.find((e) =>
    e.includes("does not match declared type")
  );
  assertEquals(
    mismatchError,
    undefined,
    `Should have no type mismatch errors, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("validator/parameters - type boolean with string default produces error", () => {
  const def = minimalDefinitionWithParams({
    verbose: {
      type: "boolean",
      description: "Verbose mode",
      cli: "--verbose",
      default: "false",
    },
  });

  logger.debug("validate input (boolean type, string default)", {
    paramName: "verbose",
  });
  const result = validate(def);
  logger.debug("validate result", {
    valid: result.valid,
    errorCount: result.errors.length,
  });

  assertEquals(
    result.valid,
    false,
    "Should be invalid on type/default mismatch",
  );

  const mismatchError = result.errors.find((e) =>
    e.includes("Parameter 'verbose'") &&
    e.includes("default value type 'string'") &&
    e.includes("declared type 'boolean'")
  );
  assertEquals(
    mismatchError !== undefined,
    true,
    `Expected type mismatch error for 'verbose', got errors: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("validator/parameters - type array with string default produces error", () => {
  const def = minimalDefinitionWithParams({
    tags: {
      type: "array",
      description: "Tags list",
      cli: "--tags",
      default: "not-array",
    },
  });

  logger.debug("validate input (array type, string default)", {
    paramName: "tags",
  });
  const result = validate(def);
  logger.debug("validate result", {
    valid: result.valid,
    errorCount: result.errors.length,
  });

  assertEquals(
    result.valid,
    false,
    "Should be invalid on type/default mismatch",
  );

  const mismatchError = result.errors.find((e) =>
    e.includes("Parameter 'tags'") &&
    e.includes("default value type 'string'") &&
    e.includes("declared type 'array'")
  );
  assertEquals(
    mismatchError !== undefined,
    true,
    `Expected type mismatch error for 'tags', got errors: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("validator/parameters - type string with matching default passes", () => {
  const def = minimalDefinitionWithParams({
    format: {
      type: "string",
      description: "Output format",
      cli: "--format",
      default: "json",
    },
  });

  logger.debug("validate input (string type, string default)", {
    paramName: "format",
  });
  const result = validate(def);
  logger.debug("validate result", {
    valid: result.valid,
    errorCount: result.errors.length,
  });

  const mismatchError = result.errors.find((e) =>
    e.includes("does not match declared type")
  );
  assertEquals(
    mismatchError,
    undefined,
    `Should have no type mismatch errors, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("validator/parameters - type boolean with matching default passes", () => {
  const def = minimalDefinitionWithParams({
    verbose: {
      type: "boolean",
      description: "Verbose mode",
      cli: "--verbose",
      default: true,
    },
  });

  const result = validate(def);

  const mismatchError = result.errors.find((e) =>
    e.includes("does not match declared type")
  );
  assertEquals(
    mismatchError,
    undefined,
    `Should have no type mismatch errors, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});

Deno.test("validator/parameters - type array with matching default passes", () => {
  const def = minimalDefinitionWithParams({
    tags: {
      type: "array",
      description: "Tags list",
      cli: "--tags",
      default: ["a", "b"],
    },
  });

  const result = validate(def);

  const mismatchError = result.errors.find((e) =>
    e.includes("does not match declared type")
  );
  assertEquals(
    mismatchError,
    undefined,
    `Should have no type mismatch errors, got: ${
      JSON.stringify(result.errors)
    }`,
  );
});
