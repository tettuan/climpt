/**
 * Verify reviewer agent JSON schemas (4-level validation).
 *
 * Checks schema file existence, $ref resolution, structure, and
 * gate intent extraction without any LLM calls.
 */

import { resolve } from "@std/path";
import { validateSchemaForAgent } from "../../_shared/validate-schema.ts";
import type { SchemaValidationConfig } from "../../_shared/validate-schema.ts";

const repoRoot = resolve(import.meta.dirname ?? ".", "../../../");

const config: SchemaValidationConfig = {
  agentName: "reviewer",
  schemasDir: resolve(repoRoot, ".agent/reviewer/schemas"),
  registryPath: resolve(repoRoot, ".agent/reviewer/steps_registry.json"),
  expectedSchemaFiles: [
    "reviewer.schema.json",
    "common.schema.json",
  ],
  stepsToValidate: [
    {
      stepId: "initial.issue",
      schemaFile: "reviewer.schema.json",
      schemaName: "initial.issue",
      expectedIntents: ["next", "repeat", "handoff"],
    },
    {
      stepId: "continuation.issue",
      schemaFile: "reviewer.schema.json",
      schemaName: "continuation.issue",
      expectedIntents: ["next", "repeat", "handoff"],
    },
    {
      stepId: "closure.review",
      schemaFile: "reviewer.schema.json",
      schemaName: "closure.review",
      expectedIntents: ["closing", "repeat"],
    },
  ],
};

// deno-lint-ignore no-console
const log = console.log;
// deno-lint-ignore no-console
const logErr = console.error;

log(`=== Verify Reviewer Schema (4-Level) ===`);
log(`Agent: ${config.agentName}`);

const result = await validateSchemaForAgent(config);

if (result.failed > 0) {
  logErr(`\nFailed with ${result.failed} error(s).`);
  Deno.exit(1);
}
