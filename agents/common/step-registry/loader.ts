/**
 * Step Registry Loader
 *
 * Functions for loading step registries from files.
 */

import { join } from "@std/path";
import type {
  C3LAddress,
  RegistryLoaderOptions,
  Step,
  StepKind,
  StepRegistry,
} from "./types.ts";
import {
  validateEntryStepMapping,
  validateIntentSchemaEnums,
  validateIntentSchemaRef,
  validateStepKindIntents,
  validateStepRegistry,
} from "./validator.ts";
import { PATHS } from "../../shared/paths.ts";
import { STEP_PHASE, type StepPhase } from "../../shared/step-phases.ts";
import {
  srLoadAgentIdMismatch,
  srLoadInvalidFormat,
  srLoadNotFound,
} from "../../shared/errors/config-errors.ts";

/**
 * Disk-shape of a step entry: legacy 5-tuple split + optional `stepKind`.
 *
 * The on-disk JSON format keeps the 5 separate C3L fields
 * (`c2`, `c3`, `edition`, `adaptation`) and an optional `stepKind`. The
 * loader transforms this into the typed in-memory `Step` ADT (which uses an
 * `address` aggregate and a required `kind`).
 *
 * TODO[T1.7]: T1.7 migrates the on-disk format so authors write `address`
 * and `kind` directly. After T1.7 the inference + aggregation in
 * {@link normalizeDiskStep} becomes a no-op and can be removed.
 */
type DiskStepShape = {
  stepId: string;
  c2: string;
  c3: string;
  edition: string;
  adaptation?: string;
  stepKind?: StepKind;
} & Omit<Step, "kind" | "address" | "stepId">;

/**
 * Infer `kind` for a disk step that omits `stepKind`, using `c2` as the cue.
 *
 * TODO[T1.7]: remove this inference once the on-disk format requires `kind`.
 */
function inferKindFromDiskShape(disk: DiskStepShape): StepKind {
  if (disk.stepKind) return disk.stepKind;
  switch (disk.c2 as StepPhase) {
    case STEP_PHASE.INITIAL:
    case STEP_PHASE.CONTINUATION:
      return "work";
    case STEP_PHASE.VERIFICATION:
      return "verification";
    case STEP_PHASE.CLOSURE:
      return "closure";
    default:
      // Non-flow steps (e.g. "section") historically had no kind. Default to
      // "work" so the typed `Step` is uniformly populated; validators reject
      // a structuredGate-bearing step with a mismatched kind separately.
      return "work";
  }
}

/**
 * Normalize a single disk-shape step into the typed `Step` ADT.
 *
 * Constructs the `address: C3LAddress` aggregate from the disk's separate
 * 5-tuple fields and populates the required `kind` discriminator
 * (inferred from `c2` when the disk JSON omits `stepKind`). The disk-only
 * fields (`c2`/`c3`/`edition`/`adaptation`/`stepKind`) are dropped from the
 * resulting in-memory object.
 */
function normalizeDiskStep(c1: string, disk: DiskStepShape): Step {
  const address: C3LAddress = disk.adaptation !== undefined
    ? {
      c1,
      c2: disk.c2,
      c3: disk.c3,
      edition: disk.edition,
      adaptation: disk.adaptation,
    }
    : { c1, c2: disk.c2, c3: disk.c3, edition: disk.edition };

  // Strip disk-only fields. The remaining keys map 1:1 onto Step.
  const {
    stepId,
    c2: _c2,
    c3: _c3,
    edition: _edition,
    adaptation: _adaptation,
    stepKind: _stepKind,
    ...rest
  } = disk;

  return {
    stepId,
    kind: inferKindFromDiskShape(disk),
    address,
    ...rest,
  };
}

/**
 * Normalize a parsed-JSON registry (with disk-shape steps) into a typed
 * {@link StepRegistry}. Useful for test fixtures and other call sites that
 * read JSON outside of {@link loadStepRegistry} (which performs the same
 * normalization plus validation).
 *
 * Identical inputs produce identical outputs as `loadStepRegistry`'s
 * in-memory shape: `Step.kind` is populated (inferred from `c2` when
 * `stepKind` is absent — see TODO[T1.7]) and `Step.address` is the
 * aggregate of the disk's separate 5-tuple fields.
 */
export function normalizeStepRegistry(raw: {
  agentId?: string;
  version?: string;
  c1?: string;
  steps?: Record<string, unknown>;
  [k: string]: unknown;
}): StepRegistry {
  const c1 = typeof raw.c1 === "string" ? raw.c1 : "";
  const steps: Record<string, Step> = {};
  for (const [stepId, diskRaw] of Object.entries(raw.steps ?? {})) {
    const d = (diskRaw ?? {}) as Partial<DiskStepShape>;
    const disk: DiskStepShape = {
      ...(d as DiskStepShape),
      stepId,
      c2: typeof d.c2 === "string" ? d.c2 : "",
      c3: typeof d.c3 === "string" ? d.c3 : "",
      edition: typeof d.edition === "string" ? d.edition : "default",
      uvVariables: Array.isArray(d.uvVariables) ? d.uvVariables : [],
      usesStdin: typeof d.usesStdin === "boolean" ? d.usesStdin : false,
    };
    steps[stepId] = normalizeDiskStep(c1, disk);
  }
  return {
    ...(raw as Omit<StepRegistry, "steps" | "agentId" | "version" | "c1">),
    agentId: typeof raw.agentId === "string" ? raw.agentId : "",
    version: typeof raw.version === "string" ? raw.version : "",
    c1,
    steps,
  };
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
  agentsDir = "agents",
  options: RegistryLoaderOptions = {},
): Promise<StepRegistry> {
  const registryPath = options.registryPath ??
    join(agentsDir, agentId, PATHS.REGISTRY_JSON);

  try {
    const content = await Deno.readTextFile(registryPath);
    // The on-disk JSON uses the disk shape (separate 5-tuple fields,
    // optional `stepKind`). Parse as `unknown` and let `normalizeDiskStep`
    // transform each entry into the typed Step ADT.
    const raw = JSON.parse(content) as {
      agentId?: string;
      version?: string;
      c1?: string;
      steps?: Record<string, DiskStepShape>;
      [k: string]: unknown;
    };

    // Validate basic structure
    if (!raw.agentId || !raw.version || !raw.steps) {
      throw srLoadInvalidFormat();
    }

    // Ensure agentId matches
    if (raw.agentId !== agentId) {
      throw srLoadAgentIdMismatch(agentId, raw.agentId);
    }

    // Transform disk shape → typed Step ADT.
    // Delegate to normalizeStepRegistry so external fixture loaders can
    // share the same disk → typed transform.
    const registry: StepRegistry = normalizeStepRegistry(raw);

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
      throw srLoadNotFound(registryPath);
    }
    throw error;
  }
}
