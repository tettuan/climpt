/**
 * Shared 4-level JSON Schema validation engine for agent examples.
 *
 * Validates that agent schemas are correct and resolvable without LLM calls:
 * - L1: Schema file existence
 * - L2: $ref resolution + additionalProperties:false
 * - L3: Structure validation (required, enum)
 * - L4: Gate intent extraction via mock JSON
 *
 * @module
 */

import { resolve } from "@std/path";
import { SchemaResolver } from "../../agents/common/schema-resolver.ts";
import { StepGateInterpreter } from "../../agents/runner/step-gate-interpreter.ts";
import type { PromptStepDefinition } from "../../agents/common/step-registry.ts";

// --- Config interfaces ---

export interface StepValidation {
  stepId: string;
  schemaFile: string;
  schemaName: string;
  expectedIntents: string[];
}

export interface SchemaValidationConfig {
  agentName: string;
  schemasDir: string;
  registryPath: string;
  expectedSchemaFiles: string[];
  stepsToValidate: StepValidation[];
}

export interface ValidationResult {
  passed: number;
  failed: number;
  errors: string[];
}

// --- Helpers ---

// deno-lint-ignore no-console
const log = console.log;
// deno-lint-ignore no-console
const logErr = console.error;

function pass(msg: string): void {
  log(`  \x1b[32m[PASS]\x1b[0m ${msg}`);
}

function fail(msg: string): void {
  logErr(`  \x1b[31m[FAIL]\x1b[0m ${msg}`);
}

/**
 * Recursively check that no `$ref` key remains in the resolved schema.
 */
function assertNoRefs(
  obj: unknown,
  path: string,
  errors: string[],
): void {
  if (obj === null || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      assertNoRefs(obj[i], `${path}[${i}]`, errors);
    }
    return;
  }
  const rec = obj as Record<string, unknown>;
  if ("$ref" in rec) {
    errors.push(`Remaining $ref at ${path}: ${rec.$ref}`);
  }
  for (const [key, value] of Object.entries(rec)) {
    assertNoRefs(value, `${path}.${key}`, errors);
  }
}

// --- Main validation function ---

export async function validateSchemaForAgent(
  config: SchemaValidationConfig,
): Promise<ValidationResult> {
  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  const schemasDir = resolve(config.schemasDir);
  const registryPath = resolve(config.registryPath);

  // Load steps_registry.json
  let registry: Record<string, unknown>;
  try {
    const raw = await Deno.readTextFile(registryPath);
    registry = JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    const msg = `[L1] FAIL: Cannot read ${registryPath}: ${e}`;
    fail(msg);
    errors.push(msg);
    return { passed: 0, failed: 1, errors };
  }

  const steps = registry.steps as Record<string, PromptStepDefinition> ??
    {};

  // --- Level 1: File existence ---

  log("\nLevel 1: Schema file existence");

  // Check steps_registry.json
  try {
    const stat = await Deno.stat(registryPath);
    pass(`[L1] PASS: steps_registry.json exists (${stat.size} bytes)`);
    passed++;
  } catch {
    const msg = `[L1] FAIL: steps_registry.json not found at ${registryPath}`;
    fail(msg);
    errors.push(msg);
    failed++;
  }

  // Check each expected schema file (parallel stat)
  const fileChecks = config.expectedSchemaFiles.map(async (file) => {
    const filePath = resolve(schemasDir, file);
    try {
      const stat = await Deno.stat(filePath);
      return { ok: true as const, file, size: stat.size };
    } catch {
      return { ok: false as const, file, filePath };
    }
  });
  for (const result of await Promise.all(fileChecks)) {
    if (result.ok) {
      pass(`[L1] PASS: ${result.file} exists (${result.size} bytes)`);
      passed++;
    } else {
      const msg = `[L1] FAIL: ${result.file} not found at ${result.filePath}`;
      fail(msg);
      errors.push(msg);
      failed++;
    }
  }

  // --- Level 2: $ref resolution ---

  log("\nLevel 2: $ref resolution + additionalProperties");

  const resolver = new SchemaResolver(schemasDir);

  // Resolve all schemas upfront (parallel)
  const resolvedSchemas = await Promise.all(
    config.stepsToValidate.map(async (step) => {
      try {
        const schema = await resolver.resolve(step.schemaFile, step.schemaName);
        return { step, schema, error: null };
      } catch (e) {
        return { step, schema: null, error: e };
      }
    }),
  );

  for (const { step, schema: resolved, error } of resolvedSchemas) {
    if (error || !resolved) {
      const msg = `[L2] FAIL: ${step.schemaName} resolution error: ${
        error instanceof Error ? error.message : error
      }`;
      fail(msg);
      errors.push(msg);
      failed++;
      continue;
    }

    // Check no $ref remaining
    const refErrors: string[] = [];
    assertNoRefs(resolved, step.schemaName, refErrors);
    if (refErrors.length > 0) {
      const msg = `[L2] FAIL: ${step.schemaName} has unresolved $ref: ${
        refErrors.join(", ")
      }`;
      fail(msg);
      errors.push(msg);
      failed++;
      continue;
    }

    // Check additionalProperties: false on root
    if (resolved.additionalProperties !== false) {
      const msg =
        `[L2] FAIL: ${step.schemaName} root missing additionalProperties: false`;
      fail(msg);
      errors.push(msg);
      failed++;
      continue;
    }

    pass(`[L2] PASS: ${step.schemaName} resolved, no $ref remaining`);
    passed++;
  }

  // --- Level 3: Structure validation ---

  log("\nLevel 3: Structure validation");

  for (const { step, schema: resolved, error } of resolvedSchemas) {
    if (error || !resolved) {
      // Already reported in L2
      failed++;
      continue;
    }

    // Check type === "object"
    if (resolved.type !== "object") {
      const msg =
        `[L3] FAIL: ${step.schemaName} type is "${resolved.type}", expected "object"`;
      fail(msg);
      errors.push(msg);
      failed++;
      continue;
    }

    // Check required base fields
    const required = resolved.required as string[] | undefined;
    const baseFields = ["stepId", "status", "summary"];
    const missingFields = baseFields.filter((f) => !required?.includes(f));
    if (missingFields.length > 0) {
      const msg =
        `[L3] FAIL: ${step.schemaName} missing required base fields: ${
          missingFields.join(", ")
        }`;
      fail(msg);
      errors.push(msg);
      failed++;
      continue;
    }

    // Check next_action.action.enum against expected intents
    const props = resolved.properties as Record<string, unknown> | undefined;
    const naProps = (props as Record<string, Record<string, unknown>>)
      ?.["next_action"];
    const naInnerProps = naProps?.properties as
      | Record<string, unknown>
      | undefined;
    const actionDef = naInnerProps?.action as
      | Record<string, unknown>
      | undefined;
    const actionEnum = actionDef?.enum as string[] | undefined;

    if (!actionEnum) {
      const msg =
        `[L3] FAIL: ${step.schemaName} missing properties.next_action.properties.action.enum`;
      fail(msg);
      errors.push(msg);
      failed++;
      continue;
    }

    // Compare with steps_registry allowedIntents
    const stepDef = steps[step.stepId];
    const registryIntents = stepDef?.structuredGate?.allowedIntents as
      | string[]
      | undefined;
    if (registryIntents) {
      const enumSorted = [...actionEnum].sort();
      const registrySorted = [...registryIntents].sort();
      if (JSON.stringify(enumSorted) !== JSON.stringify(registrySorted)) {
        const msg = `[L3] FAIL: ${step.schemaName} enum=${
          JSON.stringify(actionEnum)
        } != registry=${JSON.stringify(registryIntents)}`;
        fail(msg);
        errors.push(msg);
        failed++;
        continue;
      }
    }

    pass(
      `[L3] PASS: ${step.schemaName} structure valid, intents=[${
        actionEnum.join(",")
      }]`,
    );
    passed++;
  }

  // --- Level 4: Gate intent extraction ---

  log("\nLevel 4: Gate intent extraction");

  const interpreter = new StepGateInterpreter();

  for (const step of config.stepsToValidate) {
    const stepDef = steps[step.stepId];
    if (!stepDef) {
      const msg = `[L4] FAIL: ${step.stepId} not found in steps_registry.json`;
      fail(msg);
      errors.push(msg);
      failed++;
      continue;
    }

    for (const intent of step.expectedIntents) {
      const mock: Record<string, unknown> = {
        stepId: step.stepId,
        status: "completed",
        summary: "Mock validation",
        "next_action": { action: intent, reason: "test" },
      };

      try {
        const result = interpreter.interpret(mock, stepDef);

        if (result.intent !== intent) {
          const msg =
            `[L4] FAIL: ${step.stepId} intent="${intent}" -> got "${result.intent}"`;
          fail(msg);
          errors.push(msg);
          failed++;
          continue;
        }
        if (result.usedFallback) {
          const msg =
            `[L4] FAIL: ${step.stepId} intent="${intent}" used fallback`;
          fail(msg);
          errors.push(msg);
          failed++;
          continue;
        }

        pass(
          `[L4] PASS: ${step.stepId} intent="${intent}" extracted correctly`,
        );
        passed++;
      } catch (e) {
        const msg = `[L4] FAIL: ${step.stepId} intent="${intent}": ${
          e instanceof Error ? e.message : e
        }`;
        fail(msg);
        errors.push(msg);
        failed++;
      }
    }
  }

  // --- Summary ---

  log(`\nSummary: ${passed} passed, ${failed} failed`);

  return { passed, failed, errors };
}
