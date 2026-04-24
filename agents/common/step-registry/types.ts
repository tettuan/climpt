/**
 * Step Registry Types
 *
 * Type definitions for the step registry system.
 */

import type { InputSpec } from "../../src_common/contracts.ts";
import type { PermissionMode } from "../../src_common/types/agent-definition.ts";

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
   * List of UV (user variable) names required by this prompt
   * Example: ["issue", "repository"]
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
    /** Schema file name (relative to the agent's schemas directory) */
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
   * Override SDK permissionMode for this step.
   * When set, takes priority over `permissions.defaultMode` from
   * `.agent/climpt/config/claude.settings.climpt.agents.*.json`.
   */
  permissionMode?: PermissionMode;

  /**
   * Subprocess runner for closure steps.
   *
   * When set on a closure step, the AgentRunner spawns this command via
   * Deno.Command instead of invoking the LLM. Enables deterministic side
   * effects (e.g., merge-pr.ts) that escape the LLM boundary.
   *
   * args elements may contain `${context.<key>}` placeholders; the runner
   * substitutes them from the execution context (agent parameters) before
   * spawn. Unresolved placeholders abort with an error.
   *
   * @see docs/internal/pr-merger-design/ Phase 0-b/0-c
   */
  runner?: StepSubprocessRunner;

  /**
   * Optional description of what this step does
   */
  description?: string;
}

/**
 * Subprocess runner spec for closure steps (Phase 0-c).
 *
 * Declares a command to execute instead of an LLM call. Enables closure
 * steps to perform deterministic side effects via external binaries.
 */
export interface StepSubprocessRunner {
  /** Executable binary (e.g., "deno") */
  command: string;
  /** Command arguments; elements may contain `${context.<key>}` templates */
  args: string[];
  /** Subprocess timeout in milliseconds (default: 30000) */
  timeout?: number;
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
