/**
 * AgentBundle loader (design 13 §B + §G).
 *
 * Lifts the climpt 3-file dispersion (`agent.json` +
 * `steps_registry.json` + `workflow.json.agents.{id}`) into a single
 * frozen {@link AgentBundle} aggregate.
 *
 * The on-disk JSON shapes of `agent.json` and `workflow.json` are owned
 * by their respective disk-format migrations; only the in-memory typed
 * projection is consolidated here.
 *
 * Boot rule A1 (id uniqueness across a workflow's agent map) is enforced
 * by {@link assertUniqueBundleIds}. T1.4 promotes the throw to a
 * `Decision = Reject(ValidationError)` return type.
 *
 * @see agents/docs/design/realistic/13-agent-config.md §B / §G
 */

import { join } from "@std/path";
import { BreakdownLogger } from "@tettuan/breakdownlogger";

import type {
  AgentBundle,
  AgentRoleHint,
  CloseBinding,
  CompletionSpec,
  FlowSpec,
  ParamSpec,
  ParamType,
} from "../src_common/types/agent-bundle.ts";
import type {
  AgentDefinition,
  ParameterDefinition,
} from "../src_common/types/agent-definition.ts";
import type { EntryStepPair, Step } from "../common/step-registry/types.ts";
import type {
  AgentDefinition as WorkflowAgentDefinition,
  WorkflowConfig,
} from "../orchestrator/workflow-types.ts";

import { applyDefaults, deepFreeze } from "./defaults.ts";
import { getAgentDir, loadRaw } from "./loader.ts";
import { loadStepRegistry } from "../common/step-registry/loader.ts";
import { PATHS } from "../shared/paths.ts";
import { validate, validateComplete } from "./validator.ts";
import {
  acBundleDuplicateId,
  acValidFailed,
  acValidIncomplete,
} from "../shared/errors/config-errors.ts";

/**
 * Load and assemble an {@link AgentBundle} for a single agent.
 *
 * Reads:
 * 1. `<cwd>/.agent/<agentId>/agent.json`        — runner / parameters / verdict
 * 2. `<cwd>/.agent/<agentId>/steps_registry.json` (when referenced) — Step list
 * 3. (optional) `<cwd>/.agent/workflow.json` `agents.{agentId}` —
 *    `role` / `closeBinding`
 *
 * The bundle is `Object.freeze`d (deep) before return so callers cannot
 * mutate it during Run (Layer 4 immutable, design 20 §E).
 *
 * @param agentId  Logical agent id (also used as agent directory name
 *                 when {@link workflowAgent}.directory is omitted).
 * @param cwd      Repository root (containing `.agent/`).
 * @param options  Optional overrides:
 *                 - `workflowAgent` — pre-resolved
 *                   `workflow.json.agents.{id}` entry. Provide when the
 *                   caller already has the full {@link WorkflowConfig};
 *                   otherwise the bundle's `role` / `closeBinding`
 *                   fields stay `undefined` (standalone `run-agent`
 *                   mode); `closeBinding` defaults to no-close.
 *                 - `agentDir` — explicit agent directory (overrides the
 *                   `agentId` / `workflowAgent.directory` derivation).
 *
 * @throws ConfigError (AC-VALID-*) for raw / complete validation
 *         failures (delegated to {@link validate} / {@link validateComplete}).
 */
export async function loadAgentBundle(
  agentId: string,
  cwd: string,
  options?: {
    readonly workflowAgent?: WorkflowAgentDefinition;
    readonly agentDir?: string;
  },
): Promise<AgentBundle> {
  const directoryName = options?.workflowAgent?.directory ?? agentId;
  const agentDir = options?.agentDir ?? getAgentDir(directoryName, cwd);

  // 1. agent.json (raw → validated → defaults applied)
  const raw = await loadRaw(agentDir);

  const rawValidation = validate(raw);
  if (!rawValidation.valid) {
    throw acValidFailed(rawValidation.errors.join(", "));
  }
  if (rawValidation.warnings.length > 0) {
    const logger = new BreakdownLogger("config");
    for (const warning of rawValidation.warnings) logger.warn(warning);
  }

  const definition = applyDefaults(raw);

  const completeValidation = validateComplete(definition);
  if (!completeValidation.valid) {
    throw acValidIncomplete(completeValidation.errors.join(", "));
  }

  // 2. steps_registry.json (typed Step list + entry mapping)
  const { steps, entryStep, entryStepMapping } = await loadTypedSteps(
    definition,
    agentDir,
  );

  // 3. workflow.json.agents.{id} (optional, supplies role / close fields)
  const workflowAgent = options?.workflowAgent;

  // ---------------------------------------------------------------------
  // Build the declarative aggregate
  // ---------------------------------------------------------------------

  const flow = buildFlowSpec(steps, entryStep, entryStepMapping);
  const completion = buildCompletionSpec(steps, definition);
  const parameters = buildParamSpecs(definition);
  const closeBinding = readCloseBinding(workflowAgent?.closeBinding);

  const bundle: AgentBundle = {
    id: definition.name as AgentBundle["id"],
    version: definition.version,
    displayName: definition.displayName,
    description: definition.description,
    role: workflowAgent ? toRoleHint(workflowAgent.role) : undefined,
    flow,
    completion,
    parameters,
    steps,
    closeBinding,
    runner: definition.runner,
  };

  return deepFreeze(bundle);
}

/**
 * Boot rule A1 (design 13 §G) — assert that no two bundles in a
 * workflow share the same `id`. Throws on first conflict so Boot
 * fail-fasts (P4).
 *
 * Promoted to a `Decision = Reject(ValidationError)` return shape by
 * T1.4.
 */
export function assertUniqueBundleIds(
  bundles: readonly AgentBundle[],
): void {
  const seen = new Set<string>();
  for (const bundle of bundles) {
    if (seen.has(bundle.id)) {
      throw acBundleDuplicateId(bundle.id);
    }
    seen.add(bundle.id);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * TypedRegistryProjection — fields of the typed StepRegistry needed to
 * build the {@link AgentBundle} aggregate.
 *
 * Returning a tuple here keeps the caller (`loadAgentBundle`) free of
 * raw-JSON re-reads: `loadStepRegistry` is invoked exactly once per
 * Boot, the validators (R1 chain) run exactly once, and downstream
 * helpers consume only the typed projection.
 */
interface TypedRegistryProjection {
  readonly steps: readonly Step[];
  readonly entryStep: string;
  readonly entryStepMapping?: Readonly<Record<string, EntryStepPair>>;
}

/**
 * Resolve and normalize the `steps_registry.json` referenced by the
 * agent's `runner.flow.prompts.registry`. Returns an empty projection
 * (no steps, empty entryStep, no mapping) when no registry is referenced
 * (standalone agents that do not use the step graph) or when the
 * referenced file is absent on disk.
 *
 * Delegates to the singular {@link loadStepRegistry} (R1 in
 * tmp/step-adt-migration/investigation/stepsRegistry-consumers.md) so
 * the codebase has a single typed entry point for `steps_registry.json`.
 * The validator chain ({@link validateRegistryShape},
 * {@link validateStepKindIntents}, {@link validateEntryStepMapping},
 * {@link validateIntentSchemaRef}) runs inside `loadStepRegistry`. The
 * typed registry's top-level `entryStep` / `entryStepMapping` are
 * returned alongside the step list so the caller does not re-read the
 * file (T19 / B1 — single typed reader).
 */
async function loadTypedSteps(
  definition: AgentDefinition,
  agentDir: string,
): Promise<TypedRegistryProjection> {
  const registryPath = definition.runner.flow.prompts.registry;
  if (!registryPath) return { steps: [], entryStep: "" };

  const resolvedRegistryPath = join(agentDir, registryPath);

  // T38 / critique-6 N#5: SR-LOAD-003 swallow is centralized in the
  // loader (`allowMissing: true`). When the referenced file is absent
  // on disk the loader fabricates an empty registry; the projection
  // below transparently collapses to `{ steps: [], entryStep: "" }`
  // because an empty registry has `steps = {}` and no
  // `entryStep`/`entryStepMapping`. All other validation errors
  // (SR-VALID-*, SR-LOAD-002, SR-INTENT-*) propagate.
  //
  // T29 / critique-5 B#2: schemasDir is type-required for the strict
  // (default) loader variant. The boot path resolves it from the agent
  // directory's canonical schemas folder so validateIntentSchemaEnums
  // runs as part of bundle assembly (no silent skip).
  const registry = await loadStepRegistry(definition.name, agentDir, {
    registryPath: resolvedRegistryPath,
    schemasDir: join(agentDir, PATHS.SCHEMAS_DIR),
    allowMissing: true,
  });
  return {
    steps: Object.values(registry.steps),
    entryStep: registry.entryStep ?? "",
    entryStepMapping: registry.entryStepMapping,
  };
}

/**
 * Build the {@link FlowSpec} projection from the agent's step list.
 *
 * Splits steps by `kind` (T1.3 typed discriminator) — the typed
 * counterpart of the legacy `c2`-string match. `entryStep` and
 * `entryStepMapping` are read directly from the typed StepRegistry that
 * {@link loadTypedSteps} already validated; no second-pass disk read.
 */
function buildFlowSpec(
  steps: readonly Step[],
  entryStep: string,
  entryStepMapping: Readonly<Record<string, EntryStepPair>> | undefined,
): FlowSpec {
  const workSteps = steps.filter((s) =>
    s.kind === "work" || s.kind === "verification"
  );

  return {
    entryStep,
    entryStepMapping,
    workSteps,
  };
}

function buildCompletionSpec(
  steps: readonly Step[],
  definition: AgentDefinition,
): CompletionSpec {
  const closureSteps = steps.filter((s) => s.kind === "closure");
  return {
    closureSteps,
    verdictKind: definition.runner.verdict.type,
  };
}

function buildParamSpecs(
  definition: AgentDefinition,
): readonly ParamSpec[] {
  const params: ParamSpec[] = [];
  for (const [name, param] of Object.entries(definition.parameters ?? {})) {
    params.push(toParamSpec(name, param));
  }
  return params;
}

function toParamSpec(
  name: string,
  param: ParameterDefinition,
): ParamSpec {
  const spec: ParamSpec = {
    name,
    type: param.type as ParamType,
    required: param.required ?? false,
    cli: param.cli,
    description: param.description,
    default: param.default,
  };
  return spec;
}

function toRoleHint(
  role: WorkflowAgentDefinition["role"],
): AgentRoleHint {
  // workflow-types.AgentRole is 2-variant by design (12-workflow-config §D
  // "B(R2)1") — workflow-level routing only needs transformer / validator.
  // The 3rd `custom` variant on AgentRoleHint enters AgentBundle through
  // standalone construction paths (not via workflow.json), so this switch
  // stays exhaustive over the 2 workflow-side variants.
  switch (role) {
    case "transformer":
      return "transformer";
    case "validator":
      return "validator";
  }
}

/**
 * Read a {@link CloseBinding} directly from the workflow.json disk shape
 * (design 13 §F).
 *
 * Since T6.2 the on-disk source-of-truth is `closeBinding`; the legacy
 * `closeOnComplete` (bool) + `closeCondition` (string) pair has been
 * deleted per "後方互換性不要".  Absence yields the no-close default
 * (`{ primary: { kind: "none" }, cascade: false }`) — equivalent to the
 * pre-T6.2 `closeOnComplete: undefined` interpretation.
 */
function readCloseBinding(
  binding: CloseBinding | undefined,
): CloseBinding {
  if (binding === undefined) {
    return { primary: { kind: "none" }, cascade: false };
  }
  return binding;
}
