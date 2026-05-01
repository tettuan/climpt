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
 * C3LAddress — 5-tuple aggregate for prompt resolution.
 *
 * Per design 14 §C, prompt selection is *always* a 5-level address resolution:
 *   {c1}/{c2}/{c3}/f_{edition}[_{adaptation}].md
 *
 * The address is the *only* selector for a prompt file. CLI flags or runtime
 * branches that override edition / adaptation are structurally forbidden
 * (climpt §I anti-list).
 *
 * Fields are `readonly` to prepare for Layer 4 (Boot frozen) immutability.
 */
export interface C3LAddress {
  /** Registry-level constant namespace (e.g. "steps", "dev"). */
  readonly c1: string;
  /** Category — step grouping (e.g. "initial", "continuation", "closure"). */
  readonly c2: string;
  /** Classification — sub-category (e.g. "issue", "project", "iteration"). */
  readonly c3: string;
  /** Edition — step variant (e.g. "default", "preparation", "review"). */
  readonly edition: string;
  /** Adaptation — failure-specific overlay (optional). */
  readonly adaptation?: string;
}

/**
 * RetryPolicy — per-step retry configuration (design 14 §F).
 *
 * Retry is expressed as a C3L address overlay: on failure, the step's
 * `failurePatterns[patternRef]` provides a new edition/adaptation pair that
 * the step's address is overlaid with for a different prompt file. The retry
 * is *not* a same-prompt re-invocation.
 *
 * Bookkeeping fields (`postLLMConditions`, `preflightConditions`) are names
 * of validators registered at registry top level. They migrate into
 * `RetryPolicy` so retry semantics are localized to a single step-level field.
 */
export interface RetryPolicy {
  /** Maximum retry attempts (no exponential backoff; Layer 4 frozen). */
  readonly maxAttempts: number;
  /** Validator names run after the LLM response (failure → retry). */
  readonly postLLMConditions?: readonly string[];
  /** Validator names run before LLM call (failure → ExecutionError). */
  readonly preflightConditions?: readonly string[];
  /** Failure-pattern reference (resolves to registry `failurePatterns[name]`). */
  readonly onFailure?: { readonly patternRef: string };
}

/**
 * Step — typed in-memory shape for a registry step (design 14 §B).
 *
 * Required discriminator + aggregate address replaces the legacy 5-field
 * sprawl (c1/c2/c3/edition/adaptation). `kind` and `address` are required
 * both on the typed in-memory `Step` and on the on-disk JSON: the loader
 * rejects the legacy disk shape via `validateRegistryShape` (no synthesis,
 * no inference). Validators that still read raw JSON via `asRecord(stepDef)`
 * navigate the same `address` aggregate and are NOT typed by this interface.
 */
export interface Step {
  /** Unique step identifier (e.g., "initial.issue", "continuation.project.processing"). */
  readonly stepId: string;

  /** Step kind — explicit discriminator for the dual loop (R4). */
  readonly kind: StepKind;

  /** C3L 5-tuple address — single aggregate for prompt resolution. */
  readonly address: C3LAddress;

  /** Per-step optional retry overlay (design 14 §F). */
  readonly retry?: RetryPolicy;

  /** Per-step LLM model override (optional). */
  readonly model?: ModelRef;

  /** Human-readable name for logging/debugging. */
  name: string;

  /**
   * Step type for categorization.
   * Default: "prompt".
   */
  type?: StepType;

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
 * Reference to an LLM model (per-step override).
 *
 * Currently a thin alias to a model identifier string. Future ToDos may
 * promote this to a discriminated union (e.g. `{ provider, model, version }`).
 */
export type ModelRef = string;

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
 * Frozen 6-value ADT per design 14 §E. Run-time fatal failure is expressed
 * as a thrown `ExecutionError` (e.g. `AgentValidationAbortError`), not as
 * an Intent value (design 16 §C).
 *
 * - next: Proceed to next step
 * - repeat: Retry current step
 * - jump: Go to a specific step
 * - closing: Signal workflow completion (closure step only)
 * - escalate: Escalate to verification support step (verification only)
 * - handoff: Hand off to another workflow/agent (work only)
 */
export type GateIntent =
  | "next"
  | "repeat"
  | "jump"
  | "closing"
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
 * Entry step pair declared by `entryStepMapping[verdictType]`.
 *
 * `initial`      - Step id used at the start of a verdict cycle (Flow Loop iteration 1).
 * `continuation` - Step id used by the verdict handler's continuation prompt fallback
 *                  in the Completion Loop. Set equal to `initial` when the agent has no
 *                  separate continuation step.
 */
export interface EntryStepPair {
  initial: string;
  continuation: string;
}

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
  steps: Record<string, Step>;

  /**
   * Entry step ID for starting execution
   */
  entryStep?: string;

  /**
   * Verdict-type to entry step pair.
   * Each value declares both the initial step (used by Flow Loop iteration 1)
   * and the continuation step (used by the verdict handler's continuation
   * prompt fallback in the Completion Loop). Set continuation = initial when
   * the agent has no separate continuation step.
   * Example:
   *   {
   *     "poll:state":    { "initial": "initial.issue",  "continuation": "continuation.issue" },
   *     "count:iteration": { "initial": "clarify",      "continuation": "clarify" }
   *   }
   */
  entryStepMapping?: Record<string, EntryStepPair>;
}

/**
 * Registry loader options — discriminated union.
 *
 * The shape is split by the `validateIntentEnums` discriminator so the type
 * system makes the silent-skip cell `(validateIntentEnums:true, schemasDir:absent)`
 * structurally unrepresentable (T29 / critique-5 B#2).
 *
 * - **Strict variant (default)**: omitting `validateIntentEnums` or setting it
 *   to `true` forces the caller to provide `schemasDir`. The loader runs
 *   `validateIntentSchemaEnums` against that directory.
 * - **Opt-out variant**: setting `validateIntentEnums:false` makes
 *   `schemasDir` optional. The loader skips its own enum validation; the
 *   caller is then *required* to run `validateIntentSchemaEnums` itself with
 *   a caller-resolved schemasDir (closure-manager is the only legitimate
 *   site — it loads the registry before `cwd`-rooted paths are stable, so
 *   schemasDir resolution must wait until post-load).
 *
 * `allowMissing` (T38 / critique-6 N#5, T42 / critique-7 NEW#2) lives on
 * {@link RegistryLoaderStrictOptions} only — the **single point** where the
 * "registry file absent on disk" policy is expressed. Default = `false` =
 * loud `SR-LOAD-003`. Set to `true` only when the caller's domain
 * legitimately treats an absent registry as "no step graph" and is happy
 * with an {@link createEmptyRegistry}-shaped result (the loader fabricates
 * one with `c1 = "steps"` so downstream consumers — `PromptResolver`,
 * `loadTypedSteps` — can keep operating). All other `ConfigError` codes
 * (`SR-VALID-*`, `SR-LOAD-002`, `SR-INTENT-*`) propagate regardless of
 * `allowMissing` — only the not-found case is opt-in remapped.
 */
export type RegistryLoaderOptions =
  | RegistryLoaderStrictOptions
  | RegistryLoaderOptOutOptions;

/**
 * Strict (default) loader variant: enum validation runs inside the loader,
 * so the caller MUST hand it a `schemasDir`. The unset / `true` form of the
 * discriminator both pick this variant.
 */
export interface RegistryLoaderStrictOptions {
  /** Custom registry file path (overrides default). */
  registryPath?: string;

  /**
   * Strict-by-default enum validation. Omit or set to `true`. Set to `false`
   * only via the {@link RegistryLoaderOptOutOptions} variant.
   */
  validateIntentEnums?: true;

  /**
   * Base directory for schema files. Required for the strict variant —
   * the type system enforces this so `(true, absent)` cannot compile.
   */
  schemasDir: string;

  /**
   * Opt-in swallow for `SR-LOAD-003` (registry file absent on disk).
   * Default `false` = loud throw. Set to `true` only when the caller's
   * domain treats an absent registry as a legitimate empty-step state
   * (`PromptResolver` factory, `loadTypedSteps`, non-`detect:graph`
   * verdict handlers). All other error codes propagate.
   */
  allowMissing?: boolean;
}

/**
 * Opt-out variant for callers that perform their own enum validation later
 * (the only legitimate site is `closure-manager.ts`, which resolves
 * `schemasDir` from `cwd + .agent/<name>/schemas` after load).
 *
 * Note: `allowMissing` is intentionally absent. The opt-out variant has zero
 * legitimate callers for the SR-LOAD-003 swallow (closure-manager requires
 * the registry to exist), so `allowMissing` lives only on
 * {@link RegistryLoaderStrictOptions}. Removing it here keeps the API surface
 * to actual demand (CLAUDE.md "fallback minimum" / "no backward-compat").
 */
export interface RegistryLoaderOptOutOptions {
  /** Custom registry file path (overrides default). */
  registryPath?: string;

  /** Explicit opt-out — caller commits to running enum validation later. */
  validateIntentEnums: false;

  /** Optional in this variant; the loader will not consult it. */
  schemasDir?: string;
}
