/**
 * Schema Fail-Fast Contract Test
 *
 * Validates that SchemaResolver correctly rejects invalid schema
 * references and succeeds on valid ones, without any LLM calls.
 *
 * Scenario 1: Invalid schema pointer -> must throw SchemaPointerError
 * Scenario 2: Valid schema pointer -> must resolve successfully
 * Scenario 3: Malformed identifier (double hash) -> must throw MalformedSchemaIdentifierError
 */

import { resolve } from "@std/path";
import { SchemaResolver } from "../../../agents/common/schema-resolver.ts";
import {
  MalformedSchemaIdentifierError,
  SchemaPointerError,
} from "../../../agents/shared/errors/flow-errors.ts";

// deno-lint-ignore no-console
const log = console.log;
// deno-lint-ignore no-console
const logErr = console.error;

const repoRoot = resolve(import.meta.dirname ?? ".", "../../../");
const schemasDir = resolve(repoRoot, ".agent/iterator/schemas");

let passed = 0;
let failed = 0;

// --- Scenario 1: Invalid schema pointer must throw ---

log("Scenario 1: Invalid schema pointer");
{
  const resolver = new SchemaResolver(schemasDir);
  try {
    // Reference a non-existent definition in a real schema file
    await resolver.resolve(
      "iteration.schema.json",
      "nonexistent_step_that_does_not_exist",
    );
    logErr("  FAIL: expected SchemaPointerError but resolve succeeded");
    failed++;
  } catch (err) {
    if (err instanceof SchemaPointerError) {
      log(`  PASS: SchemaPointerError thrown for invalid pointer`);
      log(`    message: ${err.message.slice(0, 100)}...`);
      passed++;
    } else {
      logErr(
        `  FAIL: expected SchemaPointerError, got ${
          (err as Error).constructor.name
        }: ${(err as Error).message}`,
      );
      failed++;
    }
  }
}

// --- Scenario 2: Valid schema pointer must succeed ---

log("Scenario 2: Valid schema pointer");
{
  const resolver = new SchemaResolver(schemasDir);
  try {
    // Use a known valid reference from the iterator agent
    const schema = await resolver.resolve(
      "iteration.schema.json",
      "initial.iteration",
    );
    if (
      schema && typeof schema === "object" && schema.type === "object"
    ) {
      log(`  PASS: valid schema resolved successfully`);
      log(
        `    type: ${schema.type}, additionalProperties: ${schema.additionalProperties}`,
      );
      passed++;
    } else {
      logErr(`  FAIL: resolved schema has unexpected structure`);
      logErr(`    got: ${JSON.stringify(schema).slice(0, 200)}`);
      failed++;
    }
  } catch (err) {
    logErr(
      `  FAIL: resolve threw for valid pointer: ${(err as Error).message}`,
    );
    failed++;
  }
}

// --- Scenario 3: Malformed identifier must throw ---

log("Scenario 3: Malformed schema identifier (double hash)");
{
  const resolver = new SchemaResolver(schemasDir);
  try {
    await resolver.resolve(
      "iteration.schema.json",
      "##/definitions/initial.iteration",
    );
    logErr(
      "  FAIL: expected MalformedSchemaIdentifierError but resolve succeeded",
    );
    failed++;
  } catch (err) {
    if (err instanceof MalformedSchemaIdentifierError) {
      log(`  PASS: MalformedSchemaIdentifierError thrown for double hash`);
      log(`    message: ${err.message.slice(0, 100)}...`);
      passed++;
    } else {
      logErr(
        `  FAIL: expected MalformedSchemaIdentifierError, got ${
          (err as Error).constructor.name
        }: ${(err as Error).message}`,
      );
      failed++;
    }
  }
}

log(`\nSummary: ${passed} passed, ${failed} failed`);
if (failed > 0) Deno.exit(1);
