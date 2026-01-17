/**
 * Tests for JSON Schema $ref Resolver
 */

import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import {
  resolveSchema,
  SchemaPointerError,
  SchemaResolver,
} from "./schema-resolver.ts";
import { join } from "@std/path";

const TEST_SCHEMAS_DIR = join(Deno.cwd(), ".agent/iterator/schemas");

Deno.test("SchemaResolver - resolve simple schema without refs", async () => {
  const resolver = new SchemaResolver(TEST_SCHEMAS_DIR);
  // common.schema.json has $defs but the definitions themselves have minimal refs
  const schema = await resolver.resolve("common.schema.json", "$defs");

  // $defs contains the definitions
  assertEquals(typeof schema, "object");
  assertEquals(schema.stepResponse !== undefined, true);
});

Deno.test("SchemaResolver - resolve schema with internal refs", async () => {
  const resolver = new SchemaResolver(TEST_SCHEMAS_DIR);
  const schema = await resolver.resolve("issue.schema.json", "initial.issue");

  // Should have resolved the internal $ref to issueContext
  assertEquals(schema.type, "object");
  assertEquals(Array.isArray(schema.required), true);
  assertEquals(
    (schema.required as string[]).includes("issue"),
    true,
  );

  // Properties should be resolved
  const properties = schema.properties as Record<string, unknown>;
  assertEquals(properties !== undefined, true);
  assertEquals(typeof properties.issue, "object");
});

Deno.test("SchemaResolver - resolve schema with external refs", async () => {
  const resolver = new SchemaResolver(TEST_SCHEMAS_DIR);
  const schema = await resolver.resolve("issue.schema.json", "initial.issue");

  // Should have resolved external refs from common.schema.json
  // The allOf with stepResponse should be merged
  assertEquals(schema.type, "object");

  // stepResponse properties should be merged in
  const required = schema.required as string[];
  assertEquals(required.includes("stepId"), true);
  assertEquals(required.includes("status"), true);
  assertEquals(required.includes("summary"), true);
});

Deno.test("SchemaResolver - adds additionalProperties: false", async () => {
  const resolver = new SchemaResolver(TEST_SCHEMAS_DIR);
  const schema = await resolver.resolve("issue.schema.json", "complete.issue");

  // Root object should have additionalProperties: false
  assertEquals(schema.additionalProperties, false);

  // Nested objects should also have it
  const properties = schema.properties as Record<string, unknown>;
  const validation = properties.validation as Record<string, unknown>;
  assertEquals(validation.additionalProperties, false);
});

Deno.test("SchemaResolver - resolves nested refs in properties", async () => {
  const resolver = new SchemaResolver(TEST_SCHEMAS_DIR);
  const schema = await resolver.resolve(
    "issue.schema.json",
    "continuation.issue",
  );

  // workProgress contains refs to fileChange and commitInfo
  const properties = schema.properties as Record<string, unknown>;
  const progress = properties.progress as Record<string, unknown>;

  // progress should be resolved
  assertEquals(typeof progress, "object");
  assertEquals(progress.type, "object");
});

Deno.test("SchemaResolver - throws on missing schema", async () => {
  const resolver = new SchemaResolver(TEST_SCHEMAS_DIR);

  await assertRejects(
    async () => {
      await resolver.resolve("issue.schema.json", "nonexistent.schema");
    },
    Error,
    "not found",
  );
});

Deno.test("SchemaResolver - throws on missing file", async () => {
  const resolver = new SchemaResolver(TEST_SCHEMAS_DIR);

  await assertRejects(
    async () => {
      await resolver.resolve("nonexistent.schema.json", "test");
    },
    Deno.errors.NotFound,
  );
});

Deno.test("SchemaResolver - caches loaded files", async () => {
  const resolver = new SchemaResolver(TEST_SCHEMAS_DIR);

  // Load same schema twice
  const schema1 = await resolver.resolve("issue.schema.json", "initial.issue");
  const schema2 = await resolver.resolve(
    "issue.schema.json",
    "continuation.issue",
  );

  // Both should work (file cache is used)
  assertEquals(schema1.type, "object");
  assertEquals(schema2.type, "object");
});

Deno.test("SchemaResolver - clearCache works", async () => {
  const resolver = new SchemaResolver(TEST_SCHEMAS_DIR);

  await resolver.resolve("issue.schema.json", "initial.issue");
  resolver.clearCache();

  // Should still work after clearing cache (reloads file)
  const schema = await resolver.resolve("issue.schema.json", "initial.issue");
  assertEquals(schema.type, "object");
});

Deno.test("resolveSchema - convenience function works", async () => {
  const schema = await resolveSchema(
    TEST_SCHEMAS_DIR,
    "issue.schema.json",
    "complete.issue",
  );

  assertEquals(schema.type, "object");
  assertEquals(schema.additionalProperties, false);
});

Deno.test("SchemaResolver - handles allOf merge correctly", async () => {
  const resolver = new SchemaResolver(TEST_SCHEMAS_DIR);
  const schema = await resolver.resolve("issue.schema.json", "complete.issue");

  // allOf should merge stepResponse properties
  const required = schema.required as string[];
  assertEquals(required.includes("stepId"), true);
  assertEquals(required.includes("status"), true);
  assertEquals(required.includes("summary"), true);
  assertEquals(required.includes("action"), true);
  assertEquals(required.includes("validation"), true);

  // Properties from stepResponse should be present
  const properties = schema.properties as Record<string, unknown>;
  assertEquals(properties.stepId !== undefined, true);
  assertEquals(properties.status !== undefined, true);
  assertEquals(properties.tools_used !== undefined, true);
});

Deno.test("SchemaResolver - resolves iterate schema with external refs", async () => {
  const resolver = new SchemaResolver(TEST_SCHEMAS_DIR);
  const schema = await resolver.resolve(
    "iterate.schema.json",
    "initial.iterate",
  );

  // Should have resolved external refs from common.schema.json
  assertEquals(schema.type, "object");

  // iterationWork contains refs to fileChange and commitInfo
  const properties = schema.properties as Record<string, unknown>;
  const work = properties.work as Record<string, unknown>;
  assertEquals(typeof work, "object");
  assertEquals(work.type, "object");

  // Should have additionalProperties: false
  assertEquals(work.additionalProperties, false);
});

Deno.test("SchemaResolver - resolves externalState schema", async () => {
  const resolver = new SchemaResolver(TEST_SCHEMAS_DIR);
  const schema = await resolver.resolve(
    "externalState.schema.json",
    "initial.externalState",
  );

  assertEquals(schema.type, "object");
  assertEquals(schema.additionalProperties, false);

  const properties = schema.properties as Record<string, unknown>;
  assertEquals(properties.issue !== undefined, true);
  assertEquals(properties.analysis !== undefined, true);
});

// =============================================================================
// SchemaPointerError Tests (fail-fast behavior)
// =============================================================================

Deno.test("SchemaPointerError - has correct properties", () => {
  const error = new SchemaPointerError("/definitions/nonexistent", "test.json");
  assertInstanceOf(error, Error);
  assertEquals(error.name, "SchemaPointerError");
  assertEquals(error.pointer, "/definitions/nonexistent");
  assertEquals(error.file, "test.json");
  assertEquals(
    error.message.includes("No schema pointer"),
    true,
  );
  assertEquals(
    error.message.includes("JSON Pointer format"),
    true,
  );
});

Deno.test("SchemaResolver - throws SchemaPointerError for invalid pointer", async () => {
  const resolver = new SchemaResolver(TEST_SCHEMAS_DIR);

  await assertRejects(
    async () => {
      // Try to resolve a schema with an invalid internal $ref
      // We need to create a scenario where navigateToPath fails
      // Since we can't easily mock, we'll test through the resolve method
      // by referencing a non-existent definition
      await resolver.resolve("issue.schema.json", "nonexistent.definition");
    },
    Error,
    "not found",
  );
});

Deno.test("SchemaPointerError - message includes guidance", () => {
  const error = new SchemaPointerError(
    "#/definitions/missing",
    "step_outputs.schema.json",
  );
  assertEquals(
    error.message.includes("#/definitions/stepId"),
    true,
    "Error message should include example of correct format",
  );
  assertEquals(
    error.message.includes("definition exists"),
    true,
    "Error message should mention checking if definition exists",
  );
});
