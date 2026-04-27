/**
 * Step Registry Validators
 *
 * Validation functions for step registry structure and consistency.
 */

import type { StepRegistry, StructuredGate } from "./types.ts";
import { STEP_KIND_ALLOWED_INTENTS } from "./types.ts";
import { inferStepKind } from "./utils.ts";
import { SchemaResolver } from "../../common/schema-resolver.ts";
import {
  srEntryMappingInvalid,
  srEntryMissingConfig,
  srEntryStepNotFound,
  srValidIntentSchemaEnumMismatch,
  srValidIntentSchemaRef,
  srValidRegistryFailed,
  srValidStepKindIntentMismatch,
} from "../../shared/errors/config-errors.ts";

/**
 * Validate stepKind/allowedIntents consistency.
 *
 * This is called by loadStepRegistry to fail fast when a step's
 * allowedIntents set is not a subset of STEP_KIND_ALLOWED_INTENTS
 * for its stepKind.
 *
 * @param registry - Registry to validate
 * @throws Error if any step has invalid intent configuration
 */
export function validateStepKindIntents(registry: StepRegistry): void {
  const errors: string[] = [];

  for (const [stepId, step] of Object.entries(registry.steps)) {
    const kind = inferStepKind(step);
    if (kind && step.structuredGate) {
      const allowedForKind = STEP_KIND_ALLOWED_INTENTS[kind];
      for (const intent of step.structuredGate.allowedIntents) {
        if (!allowedForKind.includes(intent)) {
          errors.push(
            `Step "${stepId}": intent '${intent}' not allowed for stepKind '${kind}'. ` +
              `Allowed intents for ${kind}: ${allowedForKind.join(", ")}. ` +
              `(Work steps use 'handoff' to transition to closure, closure steps use 'closing' to complete)`,
          );
        }
      }

      // Validate fallbackIntent
      if (
        step.structuredGate.fallbackIntent &&
        !allowedForKind.includes(step.structuredGate.fallbackIntent)
      ) {
        errors.push(
          `Step "${stepId}": fallbackIntent '${step.structuredGate.fallbackIntent}' ` +
            `not allowed for stepKind '${kind}'`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw srValidStepKindIntentMismatch(errors);
  }
}

/**
 * Validate entryStepMapping configuration.
 *
 * This is called by loadStepRegistry to fail fast when:
 * - Neither entryStep nor entryStepMapping is defined
 * - entryStepMapping references non-existent steps
 *
 * @param registry - Registry to validate
 * @throws Error if entry configuration is invalid
 */
export function validateEntryStepMapping(registry: StepRegistry): void {
  // Require either entryStep or entryStepMapping
  if (!registry.entryStepMapping && !registry.entryStep) {
    throw srEntryMissingConfig(registry.agentId);
  }

  // Validate entryStep exists if defined
  if (registry.entryStep && !registry.steps[registry.entryStep]) {
    throw srEntryStepNotFound(registry.agentId, registry.entryStep);
  }

  // Validate all entryStepMapping pairs: each value must be { initial, continuation }
  // and both step ids must exist in registry.steps. The legacy string form is rejected.
  if (registry.entryStepMapping) {
    const errors: string[] = [];
    for (const [type, value] of Object.entries(registry.entryStepMapping)) {
      if (
        typeof value !== "object" || value === null ||
        typeof (value as { initial?: unknown }).initial !== "string" ||
        typeof (value as { continuation?: unknown }).continuation !== "string"
      ) {
        errors.push(
          `entryStepMapping["${type}"] must be { initial: string, continuation: string }`,
        );
        continue;
      }
      const { initial, continuation } = value as {
        initial: string;
        continuation: string;
      };
      if (!registry.steps[initial]) {
        errors.push(
          `entryStepMapping["${type}"].initial references non-existent step "${initial}"`,
        );
      }
      if (!registry.steps[continuation]) {
        errors.push(
          `entryStepMapping["${type}"].continuation references non-existent step "${continuation}"`,
        );
      }
    }
    if (errors.length > 0) {
      throw srEntryMappingInvalid(registry.agentId, errors);
    }
  }
}

/**
 * Validate intentSchemaRef format and presence in structuredGate.
 *
 * This is called by loadStepRegistry to fail fast when:
 * - A step has structuredGate but missing intentSchemaRef
 * - intentSchemaRef doesn't start with `#/` (internal pointer required)
 * - intentField is missing (required per design doc Section 4)
 *
 * Per 08_step_flow_design.md Section 4:
 * > Required: All Flow Steps must define structuredGate.intentSchemaRef
 * > and transitions, otherwise loading will fail.
 *
 * The intentSchemaRef must be an internal JSON Pointer (starts with `#/`).
 * External file references (e.g., "common.schema.json#/...") are NOT allowed.
 * To share definitions, use `$ref` in the step schema file.
 *
 * @param registry - Registry to validate
 * @throws Error if any step with structuredGate has invalid intentSchemaRef
 */
export function validateIntentSchemaRef(registry: StepRegistry): void {
  const errors: string[] = [];

  for (const [stepId, step] of Object.entries(registry.steps)) {
    if (step.structuredGate) {
      // Check intentSchemaRef presence
      if (!step.structuredGate.intentSchemaRef) {
        errors.push(
          `Step "${stepId}" has structuredGate but missing required intentSchemaRef`,
        );
        continue;
      }

      // Check intentSchemaRef format (must be internal pointer starting with #/)
      const ref = step.structuredGate.intentSchemaRef;
      if (!ref.startsWith("#/")) {
        errors.push(
          `Step "${stepId}": intentSchemaRef must be internal pointer starting with "#/" ` +
            `(got "${ref}"). Use $ref in step schema to reference common definitions.`,
        );
      }

      // Check intentField presence (required per design doc Section 4)
      if (!step.structuredGate.intentField) {
        errors.push(
          `Step "${stepId}" has structuredGate but missing required intentField`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw srValidIntentSchemaRef(errors);
  }
}

/**
 * Extract enum values from a JSON pointer path in a resolved schema.
 *
 * @param schema - Resolved schema object
 * @param pointer - JSON Pointer (e.g., "#/properties/next_action/properties/action")
 * @returns Array of enum values or undefined if not found
 */
function extractEnumFromPointer(
  schema: Record<string, unknown>,
  pointer: string,
): string[] | undefined {
  // Remove leading #/ and split by /
  const path = pointer.startsWith("#/") ? pointer.slice(2) : pointer;
  const parts = path.split("/");

  let current: unknown = schema;
  for (const part of parts) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  // Check if we found an enum
  if (current && typeof current === "object" && "enum" in current) {
    const enumValue = (current as { enum: unknown }).enum;
    if (Array.isArray(enumValue)) {
      return enumValue.filter((v): v is string => typeof v === "string");
    }
  }

  return undefined;
}

/**
 * Validate that intentSchemaRef enum matches allowedIntents.
 *
 * This async validation loads each step's schema via SchemaResolver,
 * extracts the enum from intentSchemaRef, and compares with allowedIntents.
 *
 * Per 08_step_flow_design.md Section 4:
 * The enum in the schema must match allowedIntents exactly.
 *
 * @param registry - Registry to validate
 * @param schemasDir - Base directory for schema files
 * @throws Error if enum/allowedIntents mismatch is found
 */
export async function validateIntentSchemaEnums(
  registry: StepRegistry,
  schemasDir: string,
): Promise<void> {
  const resolver = new SchemaResolver(schemasDir);

  // Collect steps that need validation
  const stepsToValidate: Array<{
    stepId: string;
    gate: StructuredGate;
    ref: { file: string; schema: string };
  }> = [];

  for (const [stepId, step] of Object.entries(registry.steps)) {
    // Skip steps without structured gate or output schema
    if (!step.structuredGate || !step.outputSchemaRef) {
      continue;
    }

    const gate = step.structuredGate;
    const ref = step.outputSchemaRef;

    // Skip if intentSchemaRef is invalid format (caught by sync validation)
    if (!gate.intentSchemaRef || !gate.intentSchemaRef.startsWith("#/")) {
      continue;
    }

    stepsToValidate.push({ stepId, gate, ref });
  }

  // Validate all steps in parallel
  const validationResults = await Promise.all(
    stepsToValidate.map(async ({ stepId, gate, ref }) => {
      try {
        // Resolve the step's schema
        const resolvedSchema = await resolver.resolve(ref.file, ref.schema);

        // Extract enum from intentSchemaRef pointer
        const schemaEnum = extractEnumFromPointer(
          resolvedSchema,
          gate.intentSchemaRef,
        );

        if (!schemaEnum) {
          return `Step "${stepId}": intentSchemaRef "${gate.intentSchemaRef}" ` +
            `does not point to an enum in schema ${ref.file}#${ref.schema}`;
        }

        // Per 08_step_flow_design.md Section 4:
        // Schema enum must match allowedIntents exactly (symmetric).
        // Extra values in schema enum indicate configuration drift.
        const schemaSet = new Set(schemaEnum);
        const allowedSet = new Set<string>(gate.allowedIntents);

        // Check for intents in allowedIntents but not in schema
        const missingInSchema = gate.allowedIntents.filter(
          (intent) => !schemaSet.has(intent),
        );

        // Check for intents in schema but not in allowedIntents
        const extraInSchema = schemaEnum.filter(
          (intent) => !allowedSet.has(intent),
        );

        if (missingInSchema.length > 0 || extraInSchema.length > 0) {
          const errors: string[] = [];
          if (missingInSchema.length > 0) {
            errors.push(
              `allowedIntents [${missingInSchema.join(", ")}] not in schema`,
            );
          }
          if (extraInSchema.length > 0) {
            errors.push(
              `schema has extra [${
                extraInSchema.join(", ")
              }] not in allowedIntents`,
            );
          }
          return `Step "${stepId}": enum mismatch - ${errors.join("; ")}. ` +
            `Expected exact match: allowedIntents=[${
              gate.allowedIntents.join(", ")
            }], ` +
            `schema enum=[${schemaEnum.join(", ")}]`;
        }

        return null; // No error
      } catch (error) {
        // Schema resolution errors are non-fatal for this validation
        // The actual schema loading will catch these later
        return `Step "${stepId}": Failed to load schema for enum validation: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    }),
  );

  // Collect errors
  const errors = validationResults.filter((e): e is string => e !== null);

  if (errors.length > 0) {
    throw srValidIntentSchemaEnumMismatch(errors);
  }
}

/**
 * Validate a step registry structure
 *
 * @param registry - Registry to validate
 * @throws Error if validation fails
 */
export function validateStepRegistry(registry: StepRegistry): void {
  const errors: string[] = [];

  // Validate registry-level fields
  if (typeof registry.agentId !== "string" || !registry.agentId) {
    errors.push("agentId must be a non-empty string");
  }
  if (typeof registry.version !== "string" || !registry.version) {
    errors.push("version must be a non-empty string");
  }
  if (typeof registry.c1 !== "string" || !registry.c1) {
    errors.push("c1 must be a non-empty string");
  }
  if (typeof registry.steps !== "object" || registry.steps === null) {
    errors.push("steps must be an object");
  }

  // Validate each step definition
  for (const [stepId, step] of Object.entries(registry.steps)) {
    if (step.stepId !== stepId) {
      errors.push(
        `Step key "${stepId}" does not match stepId "${step.stepId}"`,
      );
    }
    if (typeof step.name !== "string" || !step.name) {
      errors.push(`Step "${stepId}": name must be a non-empty string`);
    }
    const address = step.address as
      | { c2?: unknown; c3?: unknown; edition?: unknown; adaptation?: unknown }
      | undefined;
    if (!address || typeof address !== "object") {
      errors.push(`Step "${stepId}": address must be a C3LAddress object`);
    } else {
      if (typeof address.c2 !== "string" || !address.c2) {
        errors.push(`Step "${stepId}": address.c2 must be a non-empty string`);
      }
      if (typeof address.c3 !== "string" || !address.c3) {
        errors.push(`Step "${stepId}": address.c3 must be a non-empty string`);
      } else if (!/^[a-z]+(-[a-z]+)*$/.test(address.c3)) {
        errors.push(
          `Step "${stepId}": address.c3 "${address.c3}" is invalid. ` +
            `c3 must be lowercase kebab-case (e.g., "issue", "external-state"). ` +
            `camelCase like "externalState" is rejected by @tettuan/breakdown LayerType validation.`,
        );
      }
      if (typeof address.edition !== "string" || !address.edition) {
        errors.push(
          `Step "${stepId}": address.edition must be a non-empty string`,
        );
      }
    }
    if (!Array.isArray(step.uvVariables)) {
      errors.push(`Step "${stepId}": uvVariables must be an array`);
    }
    if (typeof step.usesStdin !== "boolean") {
      errors.push(`Step "${stepId}": usesStdin must be a boolean`);
    }

    // Flow steps (with structuredGate) require an explicit kind for tool
    // permission enforcement. After T1.3 the loader populates `kind`
    // unconditionally (inferred from c2 when JSON omits stepKind) so this
    // assertion is a defensive guard against malformed in-memory steps.
    if (step.structuredGate && !step.kind) {
      errors.push(
        `Step "${stepId}": Flow step (has structuredGate) must have explicit kind. ` +
          `Tool permissions depend on kind. Set kind to "work", "verification", or "closure".`,
      );
    }

    // Validate kind and intent constraints
    const kind = step.kind;
    if (kind && step.structuredGate) {
      const allowedForKind = STEP_KIND_ALLOWED_INTENTS[kind];
      for (const intent of step.structuredGate.allowedIntents) {
        if (!allowedForKind.includes(intent)) {
          errors.push(
            `Step "${stepId}": intent '${intent}' not allowed for stepKind '${kind}'. Allowed: ${
              allowedForKind.join(", ")
            }`,
          );
        }
      }

      // Validate fallbackIntent
      if (
        step.structuredGate.fallbackIntent &&
        !allowedForKind.includes(step.structuredGate.fallbackIntent)
      ) {
        errors.push(
          `Step "${stepId}": fallbackIntent '${step.structuredGate.fallbackIntent}' not allowed for stepKind '${kind}'`,
        );
      }
    }

    // Flow steps (with structuredGate) should have transitions
    if (step.structuredGate && !step.transitions) {
      errors.push(
        `Step "${stepId}": structuredGate defined but transitions missing`,
      );
    }

    // Validate step-level permissionMode if present
    if (step.permissionMode !== undefined) {
      const validModes = [
        "default",
        "plan",
        "acceptEdits",
        "bypassPermissions",
      ];
      if (!validModes.includes(step.permissionMode)) {
        errors.push(
          `Step "${stepId}": permissionMode must be one of: ${
            validModes.join(", ")
          } (got "${step.permissionMode}")`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw srValidRegistryFailed(errors);
  }
}
