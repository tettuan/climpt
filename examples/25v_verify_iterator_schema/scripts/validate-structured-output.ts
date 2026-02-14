/**
 * Verify iterator agent JSON schemas (4-level validation).
 *
 * Checks schema file existence, $ref resolution, structure, and
 * gate intent extraction without any LLM calls.
 */

import { resolve } from "@std/path";
import { validateSchemaForAgent } from "../../_shared/validate-schema.ts";
import type { SchemaValidationConfig } from "../../_shared/validate-schema.ts";

const repoRoot = resolve(import.meta.dirname ?? ".", "../../../");

const config: SchemaValidationConfig = {
  agentName: "iterator",
  schemasDir: resolve(repoRoot, ".agent/iterator/schemas"),
  registryPath: resolve(repoRoot, ".agent/iterator/steps_registry.json"),
  expectedSchemaFiles: [
    "iterate.schema.json",
    "common.schema.json",
    "issue.schema.json",
    "externalState.schema.json",
    "project.schema.json",
  ],
  stepsToValidate: [
    {
      stepId: "initial.iterate",
      schemaFile: "iterate.schema.json",
      schemaName: "initial.iterate",
      expectedIntents: ["next", "repeat"],
    },
    {
      stepId: "continuation.iterate",
      schemaFile: "iterate.schema.json",
      schemaName: "continuation.iterate",
      expectedIntents: ["next", "repeat", "handoff"],
    },
    {
      stepId: "closure.iterate",
      schemaFile: "iterate.schema.json",
      schemaName: "closure.iterate",
      expectedIntents: ["closing", "repeat"],
    },
  ],
};

// deno-lint-ignore no-console
const log = console.log;
// deno-lint-ignore no-console
const logErr = console.error;

log(`=== Verify Iterator Schema (4-Level) ===`);
log(`Agent: ${config.agentName}`);

const result = await validateSchemaForAgent(config);

if (result.failed > 0) {
  logErr(`\nFailed with ${result.failed} error(s).`);
  Deno.exit(1);
}
