/**
 * AgentBundle (declarative aggregate ADT) — design 13 §B.
 *
 * `AgentBundle` lifts climpt's 3-file dispersion (`agent.json` +
 * `steps_registry.json` + `workflow.json.agents.{id}`) into a single
 * first-class type. Boot loads the 3 files and produces a frozen aggregate;
 * Run-time consumers no longer have to re-thread the 3 sources to know
 * "what one agent is".
 *
 * @see agents/docs/design/realistic/13-agent-config.md §B / §C / §F
 *
 * Status (post T6.2):
 * - `role` is the 3-variant {@link AgentRoleHint} ADT (transformer |
 *   validator | custom). The `custom` variant is the §C escape hatch
 *   for agents that supply their own flow / completion logic; runtime
 *   consumers throw NotImplemented until P3 wires it.
 * - `closeBinding` is the {@link CloseBinding} ADT (§F primary
 *   discriminator: direct | boundary | outboxPre | custom | none),
 *   loaded directly from `workflow.json.agents.{id}.closeBinding`.
 *   T6.2 deleted the legacy inline `closeOnComplete` / `closeCondition`
 *   pair from disk and from this type — `closeBinding` is the single
 *   source of truth ("後方互換性不要").
 * - `runner` embeds the existing `ResolvedRunnerConfig`. A future
 *   Bundle-ADT redistribution will move these fields into the §B-pure
 *   shape (verdict → completion, etc.) and lift the runner-runtime
 *   config into a Policy ADT.
 *
 * The aggregate is `readonly` end-to-end so it can be frozen at Boot and
 * stay immutable throughout Run (Layer 4 in design 20 §E).
 */

import type { ResolvedRunnerConfig } from "./agent-definition.ts";
import type { Step } from "../../common/step-registry/types.ts";
import type { VerdictType } from "./verdict.ts";

// ---------------------------------------------------------------------------
// Identity / version (design 13 §B)
// ---------------------------------------------------------------------------

/**
 * Opaque agent identifier (design 13 §B).
 *
 * Boot dup-checks `id` across the workflow's agent map (rule A1).
 * Promoted to a branded type by T1.4 so cross-bundle references are
 * structurally distinguishable from raw `string`s.
 */
export type AgentId = string;

/**
 * Semantic version string (design 13 §B).
 *
 * Boot rule A2 validates SemVer parseability + cross-file major
 * agreement (`agent.json` vs `steps_registry.json`). T1.5 may promote
 * this to a parsed `{major, minor, patch}` tuple.
 */
export type SemVer = string;

// ---------------------------------------------------------------------------
// Role hint (design 13 §C)
// ---------------------------------------------------------------------------

/**
 * Agent role classification (design 13 §C).
 *
 * Drives `step.kind` placement constraints:
 * - `transformer` → 1 closure step terminal (`outputPhase` single-valued)
 * - `validator`   → ≥2 closure step series for pass / fail (`outputPhases`
 *                   multi-valued)
 * - `custom`      → escape hatch — flow / completion defined freely, no
 *                   placement constraint at the type level (Boot validates
 *                   per ad-hoc rule per design 13 §C / §G). T1.5 introduces
 *                   the variant at the type level only; runtime call sites
 *                   that switch on role throw NotImplemented for `custom`
 *                   until the channel layer (P3) lands.
 *
 * Distinct from the 2-variant workflow-level `AgentRole` in
 * `agents/orchestrator/workflow-types.ts` by design (12-workflow-config §D
 * "B(R2)1"). Workflow routing only needs transformer / validator; the
 * `custom` variant lives in the bundle so role lookup stays single-source
 * (AgentRegistry → AgentBundle).
 */
export type AgentRoleHint = "transformer" | "validator" | "custom";

// ---------------------------------------------------------------------------
// Close binding (design 13 §F)
// ---------------------------------------------------------------------------

/**
 * Custom close-channel descriptor (design 13 §F + 46-channel-U §B).
 *
 * Carried by {@link ClosePrimary} when `kind === "custom"`. T1.5 keeps the
 * shape minimal (channelId + optional schemaRef); the full
 * `subscribesTo` / `decide` / `schemaVersion` shape from To-Be 46 §B is
 * promoted by P3 / P4 when the Channel layer is wired.
 */
export interface ContractDescriptor {
  /**
   * Identifier of the user-defined close channel. Must match a channel
   * registered with the runtime ChannelRegistry at Boot (P3+).
   */
  readonly channelId: string;
  /**
   * Optional reference to the schema that validates the channel's decide
   * input / output. Resolved against the schema registry at load time
   * by P3+.
   */
  readonly schemaRef?: string;
}

/**
 * Primary close-condition discriminator (design 13 §F).
 *
 * Selects which Channel decides the agent's close action:
 * - `direct`     → 41-channel-D (TransitionComputed → terminal phase)
 * - `boundary`   → 43-channel-E (ClosureBoundaryReached)
 * - `outboxPre`  → 42-channel-C (OutboxActionDecided, kind = PreClose)
 * - `custom`     → 46-channel-U (user-defined, ContractDescriptor required)
 * - `none`       → handoff-only agent; no close path declared
 *
 * Discriminator field is `kind`. Framework subscribers (OutboxClose-post,
 * CascadeClose) chain off the primary at Boot — they are NOT declared on
 * AgentBundle (B12 repair, design 13 §F).
 */
export type ClosePrimary =
  | { readonly kind: "direct" }
  | { readonly kind: "boundary" }
  | { readonly kind: "outboxPre" }
  | { readonly kind: "custom"; readonly channel: ContractDescriptor }
  | { readonly kind: "none" };

/**
 * CloseBinding — declarative close-path declaration (design 13 §F).
 *
 * Lifts the legacy climpt `closeOnComplete` (bool) + `closeCondition`
 * (string) pair into a single typed ADT.  Since T6.2 (the closure
 * re-anchoring step) `closeBinding` is the on-disk source-of-truth in
 * `workflow.json.agents.{id}` — the legacy bool/string pair has been
 * deleted from disk, types, and runtime call sites per "後方互換性不要".
 *
 * `cascade` controls sentinel-cascade applicability — when `true`, the
 * framework's CascadeClose subscriber may chain a sentinel close from
 * this agent's IssueClosedEvent. Defaults to `false` (no cascade).
 *
 * `condition` rationalizes the legacy `closeCondition` string: when
 * present (and `primary.kind !== "none"`) the close path fires only
 * when the dispatch outcome equals this value. Absence means
 * "close on every terminal-bound outcome".
 */
export interface CloseBinding {
  readonly primary: ClosePrimary;
  /**
   * Whether sentinel-cascade applies to this agent's close events.
   * Optional; absence means `false` (no cascade chain).
   */
  readonly cascade?: boolean;
  /**
   * Optional outcome-equality guard. Replaces the legacy
   * `closeCondition` field. When set, the close path only fires when
   * the dispatch outcome equals this string.
   */
  readonly condition?: string;
}

// ---------------------------------------------------------------------------
// Flow / Completion specs (design 13 §D)
// ---------------------------------------------------------------------------

/**
 * Per-verdict-type entry step pair.
 *
 * Mirrors `StepRegistry.entryStepMapping[verdictType]` from T1.3.
 * Promoted into the bundle so the §H mode-invariance table reads from a
 * single declarative source.
 */
export interface FlowEntryStepPair {
  readonly initial: string;
  readonly continuation: string;
}

/**
 * FlowSpec — declarative shape of the Flow Loop (design 13 §D).
 *
 * `entryStep` is the unconditional starting point. When the agent needs
 * verdict-type-specific entry routing (climpt v3 entryStepMapping pattern),
 * `entryStepMapping` declares the per-verdict-type initial/continuation
 * pair.
 *
 * `workSteps` is the projection of the agent's steps with
 * `kind ∈ {"work", "verification"}` — the typed counterpart of the
 * c2-string match the legacy code performs.
 */
export interface FlowSpec {
  readonly entryStep: string;
  readonly entryStepMapping?: Readonly<Record<string, FlowEntryStepPair>>;
  readonly workSteps: readonly Step[];
}

/**
 * CompletionSpec — declarative shape of the Completion Loop (design 13 §D).
 *
 * `closureSteps` is the projection of the agent's steps with
 * `kind === "closure"` (≥1 required, validated by Boot rule A4).
 *
 * `verdictKind` is the climpt `runner.verdict.type` lifted to the bundle
 * so design §H mode-invariance can be observed at a glance. Optional in
 * T1.2 because the disk JSON shape still owns it; T1.4 promotes the
 * VerdictKind ADT and makes this required.
 */
export interface CompletionSpec {
  readonly closureSteps: readonly Step[];
  readonly verdictKind?: VerdictType;
}

// ---------------------------------------------------------------------------
// Parameter spec (design 13 §E)
// ---------------------------------------------------------------------------

/**
 * Parameter type literal accepted by the bundle.
 *
 * Keeps the climpt v3 set; design 13 §E plans `enum<lit*>` and `path`
 * additions in T1.4.
 */
export type ParamType = "string" | "number" | "boolean" | "array";

/**
 * ParamSpec — single CLI parameter declaration (design 13 §E).
 *
 * 2-mode invariant (run-agent argv / run-workflow `params` map) routes
 * through this single declaration, matching `run-agent.ts` argv-forward
 * behavior in climpt C7.
 */
export interface ParamSpec {
  readonly name: string;
  readonly type: ParamType;
  readonly required: boolean;
  readonly cli: string;
  readonly description?: string;
  readonly default?: unknown;
}

// ---------------------------------------------------------------------------
// AgentBundle root (design 13 §B)
// ---------------------------------------------------------------------------

/**
 * AgentBundle — root declarative aggregate for one agent (design 13 §B).
 *
 * Lifts the 3-file dispersion into 1 ADT. The on-disk shape of
 * `agent.json` and `workflow.json` is owned by their respective
 * disk-format migrations; only the in-memory typed projection changes
 * here.
 *
 * Field-by-field origin (climpt → bundle):
 * - `id`             ← `agent.json.name`
 * - `version`        ← `agent.json.version`
 * - `displayName`    ← `agent.json.displayName` (UX field, surfaced to
 *                     CLI before runner internals)
 * - `description`    ← `agent.json.description`
 * - `role`           ← `workflow.json.agents.{id}.role`
 *                      (falls back to undefined if standalone)
 * - `flow`           ← `steps_registry.json` (entryStep / entryStepMapping
 *                      + steps with kind ∈ work|verification)
 * - `completion`     ← `steps_registry.json` (steps with kind=closure)
 *                      + `agent.json.runner.verdict.type`
 * - `parameters`     ← `agent.json.parameters`
 * - `steps`          ← `steps_registry.json.steps` (full typed list)
 * - `closeBinding`   ← `workflow.json.agents.{id}.closeBinding`
 *                      (single source of truth since T6.2; the legacy
 *                      `closeOnComplete` / `closeCondition` pair has been
 *                      deleted from disk and types per "後方互換性不要").
 * - `runner`         ← `agent.json.runner` (entire ResolvedRunnerConfig).
 *                      A future Bundle-ADT redistribution will move these
 *                      into §B-pure fields; kept here so AgentRunner
 *                      consumers stay runtime-equivalent in the meantime.
 */
export interface AgentBundle {
  readonly id: AgentId;
  readonly version: SemVer;
  readonly displayName: string;
  readonly description: string;
  readonly role?: AgentRoleHint;
  readonly flow: FlowSpec;
  readonly completion: CompletionSpec;
  readonly parameters: readonly ParamSpec[];
  readonly steps: readonly Step[];
  /**
   * Declarative close path (design 13 §F). Single source of truth since
   * T6.2 — the orchestrator and validators read this directly; the
   * legacy `closeOnComplete` / `closeCondition` pair no longer exists
   * in the type system.
   */
  readonly closeBinding: CloseBinding;
  readonly runner: ResolvedRunnerConfig;
}
