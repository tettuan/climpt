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
  /** JSON path to extract intent from structured output (e.g., 'next_action.action') */
  intentField?: string;
  /** JSON path to extract target step ID for jump intent (e.g., 'next_action.details.target') */
  targetField?: string;
  /** JSON paths to extract for handoff data (e.g., ['analysis.understanding', 'issue']) */
  handoffFields?: string[];
  /** How target step IDs are determined */
  targetMode?: "explicit" | "dynamic" | "conditional";
  /** Default intent if response parsing fails */
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

    // Optionally validate schema
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
