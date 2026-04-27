/**
 * AgentBundle loader (design 13 §B + §G).
 *
 * Lifts the climpt 3-file dispersion (`agent.json` +
 * `steps_registry.json` + `workflow.json.agents.{id}`) into a single
 * frozen {@link AgentBundle} aggregate.
 *
 * Disk JSON shape stays unchanged (T1.7 owns disk migration); only the
 * in-memory typed projection is consolidated here.
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
  FlowEntryStepPair,
  FlowSpec,
  ParamSpec,
  ParamType,
} from "../src_common/types/agent-bundle.ts";
import type {
  AgentDefinition,
  ParameterDefinition,
} from "../src_common/types/agent-definition.ts";
import type { Step } from "../common/step-registry/types.ts";
import type {
  AgentDefinition as WorkflowAgentDefinition,
  WorkflowConfig,
} from "../orchestrator/workflow-types.ts";

import { applyDefaults, deepFreeze } from "./defaults.ts";
import { getAgentDir, loadRaw, loadStepsRegistry } from "./loader.ts";
import { validate, validateComplete } from "./validator.ts";
import { normalizeStepRegistry } from "../common/step-registry/loader.ts";
import { PATHS } from "../shared/paths.ts";
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

  // 2. steps_registry.json (typed Step list)
  const steps = await loadTypedSteps(definition, agentDir);

  // 3. workflow.json.agents.{id} (optional, supplies role / close fields)
  const workflowAgent = options?.workflowAgent;

  // ---------------------------------------------------------------------
  // Build the declarative aggregate
  // ---------------------------------------------------------------------

  const flow = buildFlowSpec(steps, agentDir);
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
 * Resolve and normalize the `steps_registry.json` referenced by the
 * agent's `runner.flow.prompts.registry`. Returns an empty list when no
 * registry is referenced (standalone agents that do not use the step
 * graph).
 */
async function loadTypedSteps(
  definition: AgentDefinition,
  agentDir: string,
): Promise<readonly Step[]> {
  const registryPath = definition.runner.flow.prompts.registry;
  if (!registryPath) return [];

  const customPath = registryPath === PATHS.STEPS_REGISTRY
    ? undefined
    : join(agentDir, registryPath);

  const raw = await loadStepsRegistry(agentDir, customPath);
  if (raw === null || raw === undefined) return [];

  const normalized = normalizeStepRegistry(
    raw as Parameters<typeof normalizeStepRegistry>[0],
  );
  return Object.values(normalized.steps);
}

/**
 * Build the {@link FlowSpec} projection from the agent's step list.
 *
 * Splits steps by `kind` (T1.3 typed discriminator) — the typed
 * counterpart of the legacy `c2`-string match. The disk source for
 * `entryStep` / `entryStepMapping` is the same `steps_registry.json`,
 * read here as a second pass.
 */
function buildFlowSpec(
  steps: readonly Step[],
  agentDir: string,
): FlowSpec {
  const workSteps = steps.filter((s) =>
    s.kind === "work" || s.kind === "verification"
  );

  // entryStep / entryStepMapping live at the registry top level; the
  // typed Step list does not carry them. Read them lazily by re-loading
  // the disk JSON (cheap; the agent.json validation has already happened).
  const { entryStep, entryStepMapping } = readEntryFromRegistryFile(agentDir);

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

/**
 * Read `entryStep` / `entryStepMapping` from the disk
 * `steps_registry.json` without re-parsing the typed Step list.
 *
 * Synchronous in spirit (the file was already opened by
 * {@link loadTypedSteps} just above), but we re-`Deno.readTextFile` so
 * the bundle loader stays a pure data dependency on `loader.ts`. The
 * loader caches at the OS-level; perf is not material here (Boot path).
 */
function readEntryFromRegistryFile(agentDir: string): {
  entryStep: string;
  entryStepMapping?: Readonly<Record<string, FlowEntryStepPair>>;
} {
  const path = join(agentDir, PATHS.STEPS_REGISTRY);
  let raw: unknown;
  try {
    raw = JSON.parse(Deno.readTextFileSync(path));
  } catch {
    return { entryStep: "" };
  }
  if (typeof raw !== "object" || raw === null) {
    return { entryStep: "" };
  }
  const obj = raw as Record<string, unknown>;
  const entryStep = typeof obj.entryStep === "string" ? obj.entryStep : "";
  const mapping = obj.entryStepMapping;
  if (mapping && typeof mapping === "object") {
    const out: Record<string, FlowEntryStepPair> = {};
    for (const [k, v] of Object.entries(mapping)) {
      if (
        v && typeof v === "object" &&
        typeof (v as Record<string, unknown>).initial === "string" &&
        typeof (v as Record<string, unknown>).continuation === "string"
      ) {
        out[k] = {
          initial: (v as Record<string, string>).initial,
          continuation: (v as Record<string, string>).continuation,
        };
      }
    }
    return { entryStep, entryStepMapping: out };
  }
  return { entryStep };
}
