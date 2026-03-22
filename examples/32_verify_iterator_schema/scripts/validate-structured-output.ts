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
    "iteration.schema.json",
    "common.schema.json",
    "issue.schema.json",
    "polling.schema.json",
    "project.schema.json",
  ],
  stepsToValidate: [
    // --- iterate path ---
    {
      stepId: "initial.iteration",
      schemaFile: "iteration.schema.json",
      schemaName: "initial.iteration",
      expectedIntents: ["next", "repeat"],
    },
    {
      stepId: "continuation.iteration",
      schemaFile: "iteration.schema.json",
      schemaName: "continuation.iteration",
      expectedIntents: ["next", "repeat", "handoff"],
    },
    {
      stepId: "closure.iteration",
      schemaFile: "iteration.schema.json",
      schemaName: "closure.iteration",
      expectedIntents: ["closing", "repeat"],
    },
    // --- issue path ---
    {
      stepId: "initial.issue",
      schemaFile: "issue.schema.json",
      schemaName: "initial.issue",
      expectedIntents: ["next", "repeat"],
    },
    {
      stepId: "continuation.issue",
      schemaFile: "issue.schema.json",
      schemaName: "continuation.issue",
      expectedIntents: ["next", "repeat", "handoff"],
    },
    {
      stepId: "closure.issue",
      schemaFile: "issue.schema.json",
      schemaName: "closure.issue",
      expectedIntents: ["closing", "repeat"],
    },
    // --- polling path (poll:state verdict type) ---
    {
      stepId: "initial.polling",
      schemaFile: "polling.schema.json",
      schemaName: "initial.polling",
      expectedIntents: ["next", "repeat"],
    },
    {
      stepId: "continuation.polling",
      schemaFile: "polling.schema.json",
      schemaName: "continuation.polling",
      expectedIntents: ["next", "repeat", "handoff"],
    },
    {
      stepId: "closure.polling",
      schemaFile: "polling.schema.json",
      schemaName: "closure.polling",
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
