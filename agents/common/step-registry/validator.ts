/**
 * Step Registry Validators
 *
 * Validation functions for step registry structure and consistency.
 */

import type { StepKind, StepRegistry, StructuredGate } from "./types.ts";
import { STEP_KIND_ALLOWED_INTENTS } from "./types.ts";
import { inferStepKind } from "./utils.ts";
import { SchemaResolver } from "../../common/schema-resolver.ts";
import {
  srEntryMappingInvalid,
  srEntryMissingConfig,
  srEntryStepNotFound,
  srLegacyStepShapeRejected,
  srValidIntentSchemaEnumMismatch,
  srValidIntentSchemaRef,
  srValidRegistryFailed,
  srValidStepKindIntentMismatch,
} from "../../shared/errors/config-errors.ts";

/**
 * Allowed values for `Step.kind` in the new ADT shape (design 14 §B).
 *
 * Kept local to {@link validateStepShape} so the strict raw validator does
 * not depend on `STEP_KIND_ALLOWED_INTENTS` key iteration order.
 */
const VALID_STEP_KINDS: readonly StepKind[] = [
  "work",
  "verification",
  "closure",
] as const;

/**
 * Legacy disk fields that must NOT appear as siblings on a step entry.
 *
 * Per design 14 §B these belong nested inside `address: C3LAddress`. Their
 * presence at the step root is the canonical legacy-shape marker.
 */
const LEGACY_FLAT_ADDRESS_FIELDS = [
  "c2",
  "c3",
  "edition",
  "adaptation",
] as const;

/**
 * Strict raw-shape validator for a single step JSON entry.
 *
 * Runs on parsed JSON BEFORE any normalization. Rejects the legacy on-disk
 * shape (`stepKind` + flat c2/c3/edition/adaptation) and demands the new
 * ADT shape (`kind` + nested `address`) per
 * agents/docs/design/realistic/14-step-registry.md §B.
 *
 * Reject conditions:
 *   1. presence of `stepKind` field (any value)
 *   2. presence of any flat `c2`/`c3`/`edition`/`adaptation` sibling
 *   3. missing `kind` discriminator
 *   4. missing `address` aggregate, or `address` missing required C3LAddress
 *      fields (`c1`, `c2`, `c3`, `edition`)
 *
 * @param rawStep - Parsed JSON value for a single step entry
 * @param stepId - Step identifier (used in error messages)
 * @returns Array of error message strings; empty when the step passes
 */
export function validateStepShape(
  rawStep: unknown,
  stepId: string,
): string[] {
  const errors: string[] = [];

  if (rawStep === null || typeof rawStep !== "object") {
    errors.push(
      `Step "${stepId}": entry must be an object, got ${
        rawStep === null ? "null" : typeof rawStep
      }.`,
    );
    return errors;
  }

  const entry = rawStep as Record<string, unknown>;

  // (1) Reject legacy `stepKind` field outright. Cite design 14 §B.
  if ("stepKind" in entry) {
    errors.push(
      `Step "${stepId}": legacy field "stepKind" is rejected. ` +
        `Rename to "kind" per design 14 §B (Step ADT discriminator).`,
    );
  }

  // (2) Reject flat C3L sibling fields. They must be nested in `address`.
  const flatHits = LEGACY_FLAT_ADDRESS_FIELDS.filter((f) => f in entry);
  if (flatHits.length > 0) {
    errors.push(
      `Step "${stepId}": flat C3L field(s) [${
        flatHits.join(", ")
      }] are rejected at the step root. ` +
        `Move them into the "address" aggregate per design 14 §B / §C ` +
        `(C3LAddress is the only address shape).`,
    );
  }

  // (3) Require `kind` and validate its value.
  if (!("kind" in entry)) {
    errors.push(
      `Step "${stepId}": required field "kind" is missing. ` +
        `Set kind to one of [${VALID_STEP_KINDS.join(", ")}] per design 14 §B.`,
    );
  } else {
    const kind = entry.kind;
    if (
      typeof kind !== "string" ||
      !(VALID_STEP_KINDS as readonly string[]).includes(kind)
    ) {
      errors.push(
        `Step "${stepId}": "kind" must be one of [${
          VALID_STEP_KINDS.join(", ")
        }], got ${JSON.stringify(kind)}.`,
      );
    }
  }

  // (4) Require `address` aggregate and validate C3LAddress required fields.
  if (!("address" in entry)) {
    errors.push(
      `Step "${stepId}": required field "address" is missing. ` +
        `Provide { c1, c2, c3, edition, adaptation? } per design 14 §C.`,
    );
  } else {
    const address = entry.address;
    if (address === null || typeof address !== "object") {
      errors.push(
        `Step "${stepId}": "address" must be a C3LAddress object, got ${
          address === null ? "null" : typeof address
        }.`,
      );
    } else {
      const a = address as Record<string, unknown>;
      for (const field of ["c1", "c2", "c3", "edition"] as const) {
        if (typeof a[field] !== "string" || (a[field] as string).length === 0) {
          errors.push(
            `Step "${stepId}": address.${field} must be a non-empty string ` +
              `per C3LAddress (design 14 §C).`,
          );
        }
      }
      if (
        "adaptation" in a &&
        a.adaptation !== undefined &&
        (typeof a.adaptation !== "string" || a.adaptation.length === 0)
      ) {
        errors.push(
          `Step "${stepId}": address.adaptation, when present, must be a ` +
            `non-empty string (design 14 §C).`,
        );
      }
    }
  }

  return errors;
}

/**
 * Strict raw-shape validator for a parsed registry JSON object.
 *
 * Iterates each entry under `steps` and applies {@link validateStepShape}.
 * Throws {@link srLegacyStepShapeRejected} if any legacy-shape entry is
 * detected, with one diagnostic per offending step.
 *
 * Intended call site: BEFORE any cast (no shim, no translation). The
 * loader proves the raw JSON conforms to the typed `StepRegistry` ADT
 * and then casts directly. This validator is the public entry point for
 * callers (loader, agent-bundle-loader, validator_test) that validate
 * raw JSON.
 *
 * @param rawRegistry - Parsed JSON object (top-level registry shape)
 * @throws ConfigError (SR-VALID-005) when any step uses the legacy shape
 */
export function validateRegistryShape(rawRegistry: unknown): void {
  if (rawRegistry === null || typeof rawRegistry !== "object") {
    throw srLegacyStepShapeRejected([
      `registry root must be an object, got ${
        rawRegistry === null ? "null" : typeof rawRegistry
      }`,
    ]);
  }

  const root = rawRegistry as { steps?: unknown };
  if (
    root.steps === undefined ||
    root.steps === null ||
    typeof root.steps !== "object"
  ) {
    // Missing/invalid `steps` is reported by srLoadInvalidFormat at load
    // time. The shape validator only walks present step entries.
    return;
  }

  const errors: string[] = [];
  for (
    const [stepId, rawStep] of Object.entries(
      root.steps as Record<string, unknown>,
    )
  ) {
    errors.push(...validateStepShape(rawStep, stepId));
  }

  if (errors.length > 0) {
    throw srLegacyStepShapeRejected(errors);
  }
}

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
