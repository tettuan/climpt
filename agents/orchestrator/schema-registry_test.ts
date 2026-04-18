/**
 * Tests for agents/orchestrator/schema-registry.ts
 *
 * Covers InMemorySchemaRegistry register / get / validate behavior:
 *   - Successful registration and retrieval
 *   - Duplicate registration is rejected (strict, no silent override)
 *   - Validation against unknown reference returns structured diagnostic
 *   - Validation of compliant data returns `{ valid: true }`
 *   - Validation of non-compliant data returns `{ valid: false }` with
 *     non-empty errors
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { InMemorySchemaRegistry } from "./schema-registry.ts";

/** Minimal JSON Schema fixture exercising type + required + property types. */
function samplePayloadSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["prNumber", "verdict"],
    properties: {
      prNumber: { type: "number" },
      verdict: { type: "string", enum: ["approved", "rejected"] },
    },
    additionalProperties: false,
  };
}

Deno.test("schema-registry: register then get returns compiled validator", () => {
  const registry = new InMemorySchemaRegistry();
  registry.register("payload@1.0.0", samplePayloadSchema());

  const validator = registry.get("payload@1.0.0");
  assert(
    validator !== undefined,
    "get() must return a validator for a registered ref. " +
      "Fix: InMemorySchemaRegistry.register must store the compiled validator.",
  );
  assertEquals(typeof validator, "function");
});

Deno.test("schema-registry: registering the same ref twice throws", () => {
  const registry = new InMemorySchemaRegistry();
  registry.register("payload@1.0.0", samplePayloadSchema());

  const err = assertThrows(
    () => registry.register("payload@1.0.0", samplePayloadSchema()),
    Error,
  );
  assert(
    err.message.includes("payload@1.0.0"),
    "Duplicate-registration error must mention the conflicting ref. " +
      `Got: ${err.message}`,
  );
});

Deno.test("schema-registry: validate against unknown ref returns structured failure", () => {
  const registry = new InMemorySchemaRegistry();
  const outcome = registry.validate("missing@1.0.0", { anything: true });

  assertEquals(outcome.valid, false);
  assert(
    outcome.errors.length > 0,
    "Unknown ref must surface a non-empty errors list (diagnosable). " +
      "Fix: InMemorySchemaRegistry.validate early-returns with a descriptive error.",
  );
  assert(
    outcome.errors.some((e) => e.includes("missing@1.0.0")),
    `Error message must identify the missing ref. Got: ${
      JSON.stringify(outcome.errors)
    }`,
  );
});

Deno.test("schema-registry: validate valid data returns { valid: true, errors: [] }", () => {
  const registry = new InMemorySchemaRegistry();
  registry.register("payload@1.0.0", samplePayloadSchema());

  const outcome = registry.validate("payload@1.0.0", {
    prNumber: 42,
    verdict: "approved",
  });

  assertEquals(outcome.valid, true);
  assertEquals(outcome.errors.length, 0);
});

Deno.test("schema-registry: validate invalid data returns { valid: false } with non-empty errors", () => {
  const registry = new InMemorySchemaRegistry();
  registry.register("payload@1.0.0", samplePayloadSchema());

  // Missing required `verdict`, plus wrong type for prNumber.
  const outcome = registry.validate("payload@1.0.0", {
    prNumber: "not-a-number",
  });

  assertEquals(outcome.valid, false);
  assert(
    outcome.errors.length > 0,
    "Invalid data must yield at least one Ajv error. " +
      "Fix: InMemorySchemaRegistry.validate must map validator.errors.",
  );
});
