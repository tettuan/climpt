/**
 * Step Registry - Prompt Externalization Foundation
 *
 * Manages step definitions that map logical steps (e.g., "initial.issue")
 * to external prompt files. This enables:
 * - Customizable prompts via user files in .agent/{agent}/prompts/
 * - Fallback to built-in prompts when user files don't exist
 * - Variable substitution for dynamic content
 * - Response format validation for structured outputs
 */

import { join } from "@std/path";
import type { InputSpec } from "../src_common/contracts.ts";
import { SchemaResolver } from "./schema-resolver.ts";

/**
 * Step type for categorization
 * - prompt: Regular prompt step
 */
export type StepType = "prompt";

/**
 * Step kind for flow taxonomy.
 *
 * - work: Generates artifacts, emits next/repeat/jump/handoff
 * - verification: Validates work, emits next/repeat/jump/escalate
 * - closure: Final validation, emits closing/repeat
 *
 * @see agents/docs/design/08_step_flow_design.md Section 2.1
 */
export type StepKind = "work" | "verification" | "closure";

/**
 * Step definition for external prompt resolution (C3L-based)
 *
 * Maps a logical step identifier to a prompt file and its requirements.
 * Uses C3L path components (c2, c3, edition, adaptation) for breakdown integration.
 *
 * NOTE: This is different from FlowStepDefinition in src_common/types.ts.
 * - PromptStepDefinition (here): C3L-based prompt file resolution
 * - FlowStepDefinition (src_common): Step flow execution control
 */
export interface PromptStepDefinition {
  /** Unique step identifier (e.g., "initial.issue", "continuation.project.processing") */
  stepId: string;

  /** Human-readable name for logging/debugging */
  name: string;

  /**
   * Step type for categorization
   * Default: "prompt"
   */
  type?: StepType;

  /**
   * Step kind for flow taxonomy.
   *
   * Determines allowed intents and validation rules:
   * - work: next/repeat/jump/handoff (generates artifacts)
   * - verification: next/repeat/jump/escalate (validates work)
   * - closure: closing/repeat (final validation)
   *
   * If not specified, inferred from c2:
   * - "initial", "continuation" -> "work"
   * - "verification" -> "verification"
   * - "closure" -> "closure"
   */
  stepKind?: StepKind;

  /**
   * C3L path component: c2 (e.g., "initial", "continuation", "section")
   */
  c2: string;

  /**
   * C3L path component: c3 (e.g., "issue", "project", "iterate")
   */
  c3: string;

  /**
   * C3L path component: edition (e.g., "default", "preparation", "review")
   */
  edition: string;

  /**
   * C3L path component: adaptation (optional, e.g., "empty", "done")
   * Used for variant prompts
   */
  adaptation?: string;

  /**
   * Key for fallback prompt in embedded prompts
   * Used when user prompt file doesn't exist
   */
  fallbackKey: string;

  /**
   * List of UV (user variable) names required by this prompt
   * Example: ["issue_number", "repository"]
   */
  uvVariables: string[];

  /**
   * Whether this step uses STDIN input
   * If true, {input_text} variable will be available
   */
  usesStdin: boolean;

  /**
   * Reference to external JSON Schema for structured output.
   * Alternative to inline schema definition.
   */
  outputSchemaRef?: {
    /** Schema file name (relative to schemasBase) */
    file: string;
    /** Schema name within the file (top-level key) */
    schema: string;
  };

  /**
   * Input specification for handoff data.
   * Defines which outputs from previous steps this step needs.
   */
  inputs?: InputSpec;

  /**
   * Structured gate configuration for intent/target routing.
   */
  structuredGate?: StructuredGate;

  /**
   * Intent to step transition mapping.
   */
  transitions?: Transitions;

  /**
   * Optional description of what this step does
   */
  description?: string;
}

/**
 * Allowed intents for structured gate.
 *
 * - next: Proceed to next step
 * - repeat: Retry current step
 * - jump: Go to a specific step
 * - closing: Signal workflow completion (closure step only)
 * - abort: Terminate workflow with error
 * - escalate: Escalate to verification support step (verification only)
 * - handoff: Hand off to another workflow/agent (work only)
 */
export type GateIntent =
  | "next"
  | "repeat"
  | "jump"
  | "closing"
  | "abort"
  | "escalate"
  | "handoff";

/**
 * Allowed intents for each step kind.
 *
 * @see agents/docs/design/08_step_flow_design.md Section 2.1
 */
export const STEP_KIND_ALLOWED_INTENTS: Record<
  StepKind,
  readonly GateIntent[]
> = {
  work: ["next", "repeat", "jump", "handoff"],
  verification: ["next", "repeat", "jump", "escalate"],
  closure: ["closing", "repeat"],
} as const;

/**
 * Structured gate configuration for intent/target routing.
 */
export interface StructuredGate {
  /** List of intents this step can emit */
  allowedIntents: GateIntent[];
  /**
   * JSON Pointer to intent enum in schema.
   * Example: '#/definitions/initial.default/properties/next_action/properties/action'
   * Required per 08_step_flow_design.md Section 4.
   */
  intentSchemaRef: string;
  /**
   * JSON path to extract intent from structured output (e.g., 'next_action.action').
   * Required - Runtime does not infer this field.
   */
  intentField: string;
  /** JSON path to extract target step ID for jump intent (e.g., 'next_action.details.target') */
  targetField?: string;
  /** JSON paths to extract for handoff data (e.g., ['analysis.understanding', 'issue']) */
  handoffFields?: string[];
  /** How target step IDs are determined */
  targetMode?: "explicit" | "dynamic" | "conditional";
  /**
   * When true (default), throw error instead of using fallback if intent cannot be determined.
   * Required for production agents per 08_step_flow_design.md Section 4/6.
   * Set to false only for debugging - logs [StepFlow][SpecViolation] when fallback is used.
   * @default true
   */
  failFast?: boolean;
  /** Default intent if response parsing fails. Ignored when failFast is true. */
  fallbackIntent?: GateIntent;
}

/**
 * Transition rule for a single intent.
 *
 * - `target: string` - Transition to the specified step
 * - `target: null` - Signal completion (terminal step)
 * - `condition` variant - Conditional transition based on handoff data
 */
export type TransitionRule =
  | { target: string | null; fallback?: string }
  | { condition: string; targets: Record<string, string | null> };

/**
 * Map of intent to transition rule.
 */
export type Transitions = Record<string, TransitionRule>;

/**
 * Step registry for an agent
 *
 * Contains all step definitions and metadata for the agent.
 */
export interface StepRegistry {
  /** Agent identifier (e.g., "iterator", "reviewer") */
  agentId: string;

  /** Registry version for compatibility checking */
  version: string;

  /**
   * C3L path component: c1 (e.g., "steps")
   * Shared by all steps in this registry
   */
  c1: string;

  /**
   * Path template for prompt resolution with adaptation
   * Example: "{c1}/{c2}/{c3}/f_{edition}_{adaptation}.md"
   */
  pathTemplate?: string;

  /**
   * Path template for prompt resolution without adaptation
   * Example: "{c1}/{c2}/{c3}/f_{edition}.md"
   */
  pathTemplateNoAdaptation?: string;

  /** All step definitions indexed by stepId */
  steps: Record<string, PromptStepDefinition>;

  /**
   * Default base directory for user prompts
   * Default: ".agent/{agentId}/prompts"
   */
  userPromptsBase?: string;

  /**
   * Base directory for schema files
   * Default: ".agent/{agentId}/schemas"
   */
  schemasBase?: string;

  /**
   * Entry step ID for starting execution
   */
  entryStep?: string;

  /**
   * Mode-based entry step mapping.
   * Allows dynamic entry step selection based on execution mode.
   * Example: { "issue": "initial.issue", "project": "initial.project" }
   */
  entryStepMapping?: Record<string, string>;
}

/**
 * Registry loader options
 */
export interface RegistryLoaderOptions {
  /** Custom registry file path (overrides default) */
  registryPath?: string;

  /** Validate schema on load */
  validateSchema?: boolean;

  /**
   * Validate intentSchemaRef enum matches allowedIntents.
   * Requires schemasDir to be set. Default: false.
   */
  validateIntentEnums?: boolean;

  /**
   * Base directory for schema files.
   * Required when validateIntentEnums is true.
   */
  schemasDir?: string;
}

/**
 * Load a step registry from JSON file
 *
 * Default location: agents/{agentId}/registry.json
 *
 * @param agentId - Agent identifier
 * @param agentsDir - Base directory for agents (default: "agents")
 * @param options - Loader options
 * @returns Loaded step registry
 */
export async function loadStepRegistry(
  agentId: string,
  agentsDir: string = "agents",
  options: RegistryLoaderOptions = {},
): Promise<StepRegistry> {
  const registryPath = options.registryPath ??
    join(agentsDir, agentId, "registry.json");

  try {
    const content = await Deno.readTextFile(registryPath);
    const registry = JSON.parse(content) as StepRegistry;

    // Validate basic structure
    if (!registry.agentId || !registry.version || !registry.steps) {
      throw new Error(
        `Invalid registry format: missing required fields (agentId, version, steps)`,
      );
    }

    // Ensure agentId matches
    if (registry.agentId !== agentId) {
      throw new Error(
        `Registry agentId mismatch: expected "${agentId}", got "${registry.agentId}"`,
      );
    }

    // Always validate stepKind/allowedIntents consistency (fail fast)
    validateStepKindIntents(registry);

    // Validate entryStepMapping references (fail fast)
    validateEntryStepMapping(registry);

    // Validate intentSchemaRef presence and format (fail fast per design doc Section 4)
    validateIntentSchemaRef(registry);

    // Optionally validate intent schema enum matches allowedIntents
    if (options.validateIntentEnums && options.schemasDir) {
      await validateIntentSchemaEnums(registry, options.schemasDir);
    }

    // Optionally validate full schema
    if (options.validateSchema) {
      validateStepRegistry(registry);
    }

    return registry;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Step registry not found at ${registryPath}`);
    }
    throw error;
  }
}

/**
 * Get a step definition by ID
 *
 * @param registry - Step registry
 * @param stepId - Step identifier to find
 * @returns Step definition or undefined
 */
export function getStepDefinition(
  registry: StepRegistry,
  stepId: string,
): PromptStepDefinition | undefined {
  return registry.steps[stepId];
}

/**
 * Get all step IDs in a registry
 *
 * @param registry - Step registry
 * @returns Array of step IDs
 */
export function getStepIds(registry: StepRegistry): string[] {
  return Object.keys(registry.steps);
}

/**
 * Check if a step exists in the registry
 *
 * @param registry - Step registry
 * @param stepId - Step identifier to check
 * @returns true if step exists
 */
export function hasStep(registry: StepRegistry, stepId: string): boolean {
  return stepId in registry.steps;
}

/**
 * Create an empty registry for an agent
 *
 * @param agentId - Agent identifier
 * @param c1 - C3L path component c1 (e.g., "steps")
 * @param version - Registry version (default: "1.0.0")
 * @returns Empty step registry
 */
export function createEmptyRegistry(
  agentId: string,
  c1: string = "steps",
  version: string = "1.0.0",
): StepRegistry {
  return {
    agentId,
    version,
    c1,
    steps: {},
    userPromptsBase: `.agent/${agentId}/prompts`,
  };
}

/**
 * Add a step definition to a registry
 *
 * @param registry - Step registry to modify
 * @param step - Step definition to add
 * @throws Error if step already exists
 */
export function addStepDefinition(
  registry: StepRegistry,
  step: PromptStepDefinition,
): void {
  if (registry.steps[step.stepId]) {
    throw new Error(`Step "${step.stepId}" already exists in registry`);
  }
  registry.steps[step.stepId] = step;
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
    throw new Error(
      `Step registry validation failed (stepKind/intent mismatch):\n- ${
        errors.join("\n- ")
      }`,
    );
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
    throw new Error(
      `Step registry for "${registry.agentId}" missing entry configuration. ` +
        `Define either "entryStep" or "entryStepMapping".`,
    );
  }

  // Validate entryStep exists if defined
  if (registry.entryStep && !registry.steps[registry.entryStep]) {
    throw new Error(
      `Step registry for "${registry.agentId}": entryStep "${registry.entryStep}" ` +
        `does not exist in steps.`,
    );
  }

  // Validate all entryStepMapping targets exist
  if (registry.entryStepMapping) {
    const errors: string[] = [];
    for (const [type, stepId] of Object.entries(registry.entryStepMapping)) {
      if (!registry.steps[stepId]) {
        errors.push(
          `entryStepMapping["${type}"] references non-existent step "${stepId}"`,
        );
      }
    }
    if (errors.length > 0) {
      throw new Error(
        `Step registry for "${registry.agentId}" has invalid entryStepMapping:\n- ${
          errors.join("\n- ")
        }`,
      );
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
    throw new Error(
      `Step registry validation failed (intentSchemaRef):\n- ${
        errors.join("\n- ")
      }`,
    );
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
    throw new Error(
      `Step registry validation failed (intent schema enum mismatch):\n- ${
        errors.join("\n- ")
      }`,
    );
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
    if (typeof step.c2 !== "string" || !step.c2) {
      errors.push(`Step "${stepId}": c2 must be a non-empty string`);
    }
    if (typeof step.c3 !== "string" || !step.c3) {
      errors.push(`Step "${stepId}": c3 must be a non-empty string`);
    }
    if (typeof step.edition !== "string" || !step.edition) {
      errors.push(`Step "${stepId}": edition must be a non-empty string`);
    }
    if (typeof step.fallbackKey !== "string" || !step.fallbackKey) {
      errors.push(`Step "${stepId}": fallbackKey must be a non-empty string`);
    }
    if (!Array.isArray(step.uvVariables)) {
      errors.push(`Step "${stepId}": uvVariables must be an array`);
    }
    if (typeof step.usesStdin !== "boolean") {
      errors.push(`Step "${stepId}": usesStdin must be a boolean`);
    }

    // Flow steps (with structuredGate) require explicit stepKind for tool permission enforcement
    // This is a mandatory requirement per 08_step_flow_design.md
    if (step.structuredGate && !step.stepKind) {
      errors.push(
        `Step "${stepId}": Flow step (has structuredGate) must have explicit stepKind. ` +
          `Tool permissions depend on stepKind. Set stepKind to "work", "verification", or "closure".`,
      );
    }

    // Validate stepKind and intent constraints
    const kind = inferStepKind(step);
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
  }

  if (errors.length > 0) {
    throw new Error(`Registry validation failed:\n- ${errors.join("\n- ")}`);
  }
}

/**
 * Infer stepKind from step definition.
 *
 * Priority:
 * 1. Explicit stepKind if defined
 * 2. Infer from c2 value
 *
 * @param step - Step definition
 * @returns Inferred step kind or undefined
 */
export function inferStepKind(
  step: PromptStepDefinition,
): StepKind | undefined {
  // Use explicit stepKind if defined
  if (step.stepKind) {
    return step.stepKind;
  }

  // Infer from c2
  switch (step.c2) {
    case "initial":
    case "continuation":
      return "work";
    case "verification":
      return "verification";
    case "closure":
      return "closure";
    default:
      // section and other non-flow steps don't have a kind
      return undefined;
  }
}

/**
 * Serialize a registry to JSON string
 *
 * @param registry - Registry to serialize
 * @param pretty - Use pretty formatting (default: true)
 * @returns JSON string
 */
export function serializeRegistry(
  registry: StepRegistry,
  pretty: boolean = true,
): string {
  return JSON.stringify(registry, null, pretty ? 2 : 0);
}

/**
 * Save a registry to a file
 *
 * @param registry - Registry to save
 * @param filePath - Destination file path
 */
export async function saveStepRegistry(
  registry: StepRegistry,
  filePath: string,
): Promise<void> {
  const content = serializeRegistry(registry);
  await Deno.writeTextFile(filePath, content + "\n");
}
