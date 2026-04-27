/**
 * Configuration Module - Configuration Layer Entry Point
 *
 * Provides ConfigurationContract implementation
 */

import type {
  AgentDefinition,
  ResolvedAgentDefinition,
  ValidationResult,
} from "../src_common/types.ts";
import type { ConfigurationContract } from "../src_common/contracts.ts";
import { getAgentDir, loadRaw, loadStepsRegistry } from "./loader.ts";
import { validate, validateComplete } from "./validator.ts";
import { applyDefaults, freeze } from "./defaults.ts";
import { join } from "@std/path";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import {
  acValidFailed,
  acValidIncomplete,
} from "../shared/errors/config-errors.ts";
import {
  acceptVoid,
  BootValidationFailed,
  combineDecisions,
  type Decision,
  decisionFromLegacy,
  decisionFromLegacyMapped,
  decisionFromSchema,
  reject as rejectDecision,
  type ValidationError,
  type ValidationErrorCode,
} from "../shared/validation/mod.ts";
import {
  validateAgentSchema,
  validateRegistrySchema,
} from "./schema-validator.ts";
import type { SchemaValidationResult } from "./schema-validator.ts";
import { validateCrossReferences } from "./registry-validator.ts";
import type { CrossRefResult } from "./registry-validator.ts";
import { validatePaths } from "./path-validator.ts";
import { resolvePromptRoot } from "./c3l-path-builder.ts";
import { validateFlowReachability } from "./flow-validator.ts";
import { validatePrompts } from "./prompt-validator.ts";
import { validateUvReachability } from "./uv-reachability-validator.ts";
import { validateTemplateUvConsistency } from "./template-uv-validator.ts";
import { validateFrontmatterRegistry } from "./frontmatter-registry-validator.ts";
import { validateHandoffInputs } from "./handoff-validator.ts";
import { validateConfigRegistryConsistency } from "./config-registry-validator.ts";
import {
  validateIntentSchemaRef,
  validateStepKindIntents,
  validateStepRegistry,
} from "../common/step-registry/validator.ts";
import type { StepRegistry } from "../common/step-registry/types.ts";
import { normalizeStepRegistry } from "../common/step-registry/loader.ts";
import {
  MSG_LABEL,
  MSG_LABEL_CLIENT_UNAVAILABLE,
  validateLabelExistence,
} from "./label-existence-validator.ts";
import { loadWorkflow } from "../orchestrator/workflow-loader.ts";
import type { WorkflowConfig } from "../orchestrator/workflow-types.ts";
import type { GitHubClient } from "../orchestrator/github-client.ts";
import { GhCliClient } from "../orchestrator/github-client.ts";
import { loadAgentBundle } from "./agent-bundle-loader.ts";
import type { AgentBundle } from "../src_common/types/agent-bundle.ts";
import type { AgentDefinition as WorkflowAgentDefinition } from "../orchestrator/workflow-types.ts";

// Re-export for convenience
export { validate, validateComplete } from "./validator.ts";
export { applyDefaults, deepFreeze, freeze } from "./defaults.ts";
export { getAgentDir } from "./loader.ts";
export type { SchemaValidationResult } from "./schema-validator.ts";
export type { CrossRefResult } from "./registry-validator.ts";
export {
  assertUniqueBundleIds,
  loadAgentBundle,
} from "./agent-bundle-loader.ts";
export type { AgentBundle } from "../src_common/types/agent-bundle.ts";

/**
 * Load, validate, and prepare an agent definition.
 *
 * Delegates to {@link loadAgentBundle} (design 13 §B aggregate) and
 * projects back to the legacy {@link ResolvedAgentDefinition} runtime
 * shape consumed by `AgentRunner` and downstream modules. The bundle is
 * the source of truth; this function exists so AgentRunner stays
 * runtime-equivalent during T1.2.
 *
 * TODO[T1.4]: refactor `AgentRunner` to consume `AgentBundle` directly
 * (via the `Decision = Accept(AgentBundle)` shape) and remove this
 * legacy projection.
 *
 * @param agentName - Name of the agent
 * @param baseDir - Base directory containing .agent folder
 * @param workflowAgent - Optional workflow-side agent declaration
 *                       (`workflow.json.agents.{id}`); supplies `role` /
 *                       `closeBinding` to the bundle when invoked from
 *                       `RunnerDispatcher`.
 * @returns Frozen, validated runtime view of the AgentBundle
 * @throws ConfigError (AC-SERVICE-*) if loading fails
 * @throws ConfigError (AC-VALID-*) if validation fails
 */
export async function loadConfiguration(
  agentName: string,
  baseDir: string,
  workflowAgent?: WorkflowAgentDefinition,
): Promise<Readonly<ResolvedAgentDefinition>> {
  const bundle = await loadAgentBundle(agentName, baseDir, { workflowAgent });
  return projectBundleToLegacyDefinition(bundle, agentName, baseDir);
}

/**
 * Project an {@link AgentBundle} aggregate to the legacy
 * {@link ResolvedAgentDefinition} runtime shape.
 *
 * Preserves the `__stepsRegistry` side-channel that
 * `RunnerDispatcher.dispatch` reads (it walks `definition.steps` to
 * extract `handoffData`). Once T1.4 lifts the runner onto
 * `AgentBundle`, this projection (and the side-channel) collapse.
 */
async function projectBundleToLegacyDefinition(
  bundle: AgentBundle,
  agentName: string,
  baseDir: string,
): Promise<Readonly<ResolvedAgentDefinition>> {
  const projected: ResolvedAgentDefinition & { __stepsRegistry?: unknown } = {
    version: bundle.version,
    name: bundle.id,
    displayName: bundle.displayName,
    description: bundle.description,
    parameters: paramSpecsToParameterMap(bundle),
    runner: bundle.runner,
  };

  // Preserve the legacy `__stepsRegistry` side-channel
  // (RunnerDispatcher.extractHandoffData walks it). T1.4 removes this
  // once dispatcher consumes AgentBundle directly.
  if (bundle.runner.flow.prompts.registry) {
    const agentDir = getAgentDir(agentName, baseDir);
    const registry = await loadStepsRegistry(agentDir);
    if (registry) projected.__stepsRegistry = registry;
  }

  return freeze(projected);
}

/**
 * Project an already-loaded {@link AgentBundle} into the legacy
 * {@link ResolvedAgentDefinition} runtime shape **without disk reads**.
 *
 * Differs from {@link projectBundleToLegacyDefinition} (private, async)
 * by deriving the `__stepsRegistry` side-channel from the bundle's
 * typed `steps` list rather than re-loading `steps_registry.json`. This
 * is the projection used by `RunnerDispatcher.dispatch` after T2.3 — the
 * frozen `AgentRegistry.lookup(id)` returns an `AgentBundle`, and the
 * dispatcher must hand a `ResolvedAgentDefinition` to `AgentRunner`
 * (Option A: keep Runner contract unchanged, runner-side migration is
 * T1.4's concern).
 *
 * The projected `__stepsRegistry.steps` keys are the typed `stepId`s
 * (not the legacy 5-tuple address), and each entry exposes only the
 * two fields `extractHandoffData` reads: `stepKind` (mapped from typed
 * `Step.kind`) and `structuredGate`. This matches the on-disk shape
 * RunnerDispatcher previously walked while staying decoupled from disk.
 *
 * TODO[T1.4]: drop this helper once `AgentRunner` consumes
 * `AgentBundle` directly and the legacy projection is no longer needed.
 *
 * @param bundle Frozen {@link AgentBundle} from {@link AgentRegistry.lookup}.
 * @returns Frozen {@link ResolvedAgentDefinition} runtime view.
 */
export function agentBundleToResolvedDefinition(
  bundle: AgentBundle,
): Readonly<ResolvedAgentDefinition> {
  const projected: ResolvedAgentDefinition & { __stepsRegistry?: unknown } = {
    version: bundle.version,
    name: bundle.id,
    displayName: bundle.displayName,
    description: bundle.description,
    parameters: paramSpecsToParameterMap(bundle),
    runner: bundle.runner,
  };

  // Synthesize the legacy `__stepsRegistry.steps` shape from the typed
  // Step list so RunnerDispatcher.extractHandoffData can keep reading
  // `step.stepKind` + `step.structuredGate.handoffFields`. Only those
  // two fields are observed; the synthesis is intentionally minimal.
  if (bundle.steps.length > 0) {
    const synthesized: Record<
      string,
      {
        stepKind: string;
        structuredGate?: { handoffFields?: string[] };
      }
    > = {};
    for (const step of bundle.steps) {
      synthesized[step.stepId] = {
        stepKind: step.kind,
        ...(step.structuredGate ? { structuredGate: step.structuredGate } : {}),
      };
    }
    projected.__stepsRegistry = { steps: synthesized };
  }

  return freeze(projected);
}

function paramSpecsToParameterMap(
  bundle: AgentBundle,
): ResolvedAgentDefinition["parameters"] {
  const out: ResolvedAgentDefinition["parameters"] = {};
  for (const param of bundle.parameters) {
    out[param.name] = {
      type: param.type,
      description: param.description ?? "",
      required: param.required,
      default: param.default,
      cli: param.cli,
    };
  }
  return out;
}

/**
 * ConfigurationContract implementation
 */
export class ConfigurationService implements ConfigurationContract {
  constructor(private baseDir: string) {}

  async load(agentName: string): Promise<AgentDefinition> {
    return await loadConfiguration(agentName, this.baseDir);
  }

  validate(definition: AgentDefinition): ValidationResult {
    return validateComplete(definition);
  }
}

// ---------------------------------------------------------------------------
// Full validation (--validate)
// ---------------------------------------------------------------------------

/**
 * Result of a full multi-layer validation run.
 */
export interface FullValidationResult {
  valid: boolean;
  agentSchemaResult: SchemaValidationResult;
  agentConfigResult: ValidationResult;
  registrySchemaResult: SchemaValidationResult | null;
  crossRefResult: CrossRefResult | null;
  pathResult: ValidationResult | null;
  labelExistenceResult: ValidationResult | null;
  flowResult: ValidationResult | null;
  promptResult: ValidationResult | null;
  uvReachabilityResult: ValidationResult | null;
  templateUvResult: ValidationResult | null;
  frontmatterRegistryResult: ValidationResult | null;
  stepRegistryValidation: ValidationResult | null;
  handoffInputsResult: ValidationResult | null;
  configRegistryResult: ValidationResult | null;
}

/**
 * Optional dependencies for {@link validateFull}. Injected for testability —
 * production callers omit this argument and the real `gh` CLI client is
 * constructed automatically.
 */
export interface ValidateFullOptions {
  githubClient?: GitHubClient;
}

/**
 * Run all validation layers against an agent's configuration.
 *
 * 1. Load raw agent.json and validate against JSON Schema
 * 2. Run config-level validation (validate + validateComplete)
 * 3. If steps_registry.json exists, validate schema and cross-references
 *
 * @param agentName - Agent name
 * @param baseDir - Repository root containing .agent/ directory
 * @returns Aggregated validation result
 */
export async function validateFull(
  agentName: string,
  baseDir: string,
  opts?: ValidateFullOptions,
): Promise<FullValidationResult> {
  const agentDir = getAgentDir(agentName, baseDir);

  // 1. Load raw agent.json
  const raw = await loadRaw(agentDir);

  // 2. Schema validation on agent.json
  const agentSchemaResult = validateAgentSchema(raw);

  // 3. Config-level validation (validate + validateComplete)
  const rawValidation = validate(raw);
  const definition = applyDefaults(raw);
  const completeValidation = validateComplete(definition);

  // Merge raw + complete validation into a single result
  const agentConfigResult: ValidationResult = {
    valid: rawValidation.valid && completeValidation.valid,
    errors: [...rawValidation.errors, ...completeValidation.errors],
    warnings: [...rawValidation.warnings, ...completeValidation.warnings],
  };

  // 4. Steps registry (optional)
  //    Use the registry path from the definition (runner.flow.prompts.registry)
  //    so that --validate reads the same file the runtime would use.
  let registrySchemaResult: SchemaValidationResult | null = null;
  let crossRefResult: CrossRefResult | null = null;
  let registry: Record<string, unknown> | null = null;

  const definitionRegistryPath = extractRegistryPath(raw);
  const resolvedRegistryPath = definitionRegistryPath
    ? join(agentDir, definitionRegistryPath)
    : undefined;

  try {
    const loaded = await loadStepsRegistry(agentDir, resolvedRegistryPath);
    if (loaded) {
      registry = loaded as Record<string, unknown>;

      // 5. Schema validation on registry
      registrySchemaResult = validateRegistrySchema(loaded);

      // 6. Cross-reference validation
      crossRefResult = validateCrossReferences(registry);
    }
  } catch (error: unknown) {
    if (error instanceof Deno.errors.NotFound) {
      // Registry file doesn't exist - not an error for agents that don't use step flow.
    } else {
      const msg = error instanceof Error ? error.message : String(error);
      registrySchemaResult = {
        valid: false,
        errors: [{
          path: "steps_registry.json",
          message: `Failed to load steps_registry.json: ${msg}`,
        }],
      };
    }
  }

  // 5c. Typed step-registry validation (stepKind/intent, intentSchemaRef, structure)
  let stepRegistryValidation: ValidationResult | null = null;
  if (registry) {
    // Normalize disk-shape JSON (legacy 5-tuple separate fields) into the
    // typed Step ADT before invoking the typed validators. The raw JSON
    // schema validation above already covered shape; here we test the
    // typed contract.
    const typedRegistry = normalizeStepRegistry(registry);
    const errors: string[] = [];

    try {
      validateStepKindIntents(typedRegistry);
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    try {
      validateIntentSchemaRef(typedRegistry);
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    try {
      validateStepRegistry(typedRegistry);
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    stepRegistryValidation = {
      valid: errors.length === 0,
      errors,
      warnings: [],
    };
  }

  // 5b. Resolve prompt root from breakdown config (app.yml + user.yml merged)
  const configDir = join(baseDir, ".agent", "climpt", "config");
  let promptRoot: string | null = null;
  if (registry) {
    const regAgentId = registry.agentId;
    const regC1 = registry.c1;
    if (typeof regAgentId === "string" && typeof regC1 === "string") {
      promptRoot = await resolvePromptRoot(baseDir, regAgentId, regC1);
    }
  }

  // 5c. Path validation (runs after registry loading so schema file paths can be checked)
  const pathResult = await validatePaths(
    definition,
    agentDir,
    registry,
    promptRoot,
  );

  // 6a. Label existence validation — online conformance check between declared
  //     labels (labelMapping + runner.integrations.github.labels) and the
  //     repository's actual label set. Skipped with a warning when the
  //     workflow config is absent or the GitHub client cannot be obtained.
  const labelExistenceResult = await runLabelExistenceValidation(
    definition,
    baseDir,
    opts?.githubClient,
  );

  // 6b. Flow reachability validation (only when registry exists)
  const flowResult = registry ? validateFlowReachability(registry) : null;

  // 6c. Prompt resolution validation (only when registry exists)
  const promptResult = registry
    ? await validatePrompts(registry, agentDir, promptRoot)
    : null;

  // 6d. UV reachability validation (only when registry exists)
  const uvReachabilityResult = registry
    ? validateUvReachability(registry, raw as Record<string, unknown>)
    : null;

  // 6e. Template UV consistency validation (only when registry exists)
  const templateUvResult = registry
    ? await validateTemplateUvConsistency(
      registry,
      agentDir,
      baseDir,
      promptRoot,
    )
    : null;

  // 6f. Frontmatter-registry UV consistency validation (only when registry exists)
  const frontmatterRegistryResult = registry
    ? await validateFrontmatterRegistry(registry, agentDir, baseDir, promptRoot)
    : null;

  // 6g. Handoff-to-inputs compatibility validation (only when registry exists)
  const handoffInputsResult = registry ? validateHandoffInputs(registry) : null;

  // 6h. Config-registry consistency (only when registry exists)
  const configRegistryResult = registry
    ? await validateConfigRegistryConsistency(registry, configDir)
    : null;

  // 7. Aggregate
  const valid = agentSchemaResult.valid &&
    agentConfigResult.valid &&
    (registrySchemaResult?.valid ?? true) &&
    (crossRefResult?.valid ?? true) &&
    pathResult.valid &&
    (labelExistenceResult?.valid ?? true) &&
    (flowResult?.valid ?? true) &&
    (promptResult?.valid ?? true) &&
    (uvReachabilityResult?.valid ?? true) &&
    (templateUvResult?.valid ?? true) &&
    (frontmatterRegistryResult?.valid ?? true) &&
    (stepRegistryValidation?.valid ?? true) &&
    (handoffInputsResult?.valid ?? true) &&
    (configRegistryResult?.valid ?? true);

  return {
    valid,
    agentSchemaResult,
    agentConfigResult,
    registrySchemaResult,
    crossRefResult,
    pathResult,
    labelExistenceResult,
    flowResult,
    promptResult,
    uvReachabilityResult,
    templateUvResult,
    frontmatterRegistryResult,
    stepRegistryValidation,
    handoffInputsResult,
    configRegistryResult,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract `runner.flow.prompts.registry` from a raw (untyped) agent definition.
 *
 * Returns the registry path string when present, or `undefined` when the
 * definition does not specify a custom registry path.  This keeps the caller
 * from having to do defensive property traversal on an `unknown` value.
 */
function extractRegistryPath(raw: unknown): string | undefined {
  if (
    typeof raw !== "object" || raw === null ||
    !("runner" in raw)
  ) {
    return undefined;
  }
  const runner = (raw as Record<string, unknown>).runner;
  if (typeof runner !== "object" || runner === null || !("flow" in runner)) {
    return undefined;
  }
  const flow = (runner as Record<string, unknown>).flow;
  if (typeof flow !== "object" || flow === null || !("prompts" in flow)) {
    return undefined;
  }
  const prompts = (flow as Record<string, unknown>).prompts;
  if (
    typeof prompts !== "object" || prompts === null || !("registry" in prompts)
  ) {
    return undefined;
  }
  const registry = (prompts as Record<string, unknown>).registry;
  return typeof registry === "string" ? registry : undefined;
}

/**
 * Run the label-existence validator with appropriate skip semantics.
 *
 * Skip with a warning when:
 * - workflow.json cannot be located/parsed (the validator needs `labelMapping`
 *   to know which labels participate in phase transitions)
 * - the GitHubClient constructor throws (so offline `--validate` runs stay
 *   useful for the non-network checks)
 *
 * Returning `null` is reserved for "validator not applicable"; all other
 * skips surface as warnings so the author sees they were not checked.
 */
async function runLabelExistenceValidation(
  definition: AgentDefinition,
  baseDir: string,
  injectedClient: GitHubClient | undefined,
): Promise<ValidationResult> {
  let workflowConfig: WorkflowConfig;
  try {
    workflowConfig = await loadWorkflow(baseDir);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      valid: true,
      errors: [],
      warnings: [
        `${MSG_LABEL} ${MSG_LABEL_CLIENT_UNAVAILABLE}: workflow config unavailable: ${msg}`,
      ],
    };
  }

  let client: GitHubClient;
  try {
    client = injectedClient ?? new GhCliClient(baseDir);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      valid: true,
      errors: [],
      warnings: [
        `${MSG_LABEL} ${MSG_LABEL_CLIENT_UNAVAILABLE}: ${msg}`,
      ],
    };
  }

  return await validateLabelExistence(definition, workflowConfig, client);
}

// ---------------------------------------------------------------------------
// Decision-shaped aggregation (T1.4)
// ---------------------------------------------------------------------------

/**
 * Heuristic mapping from a flow-validator error message to its design
 * rule code. The flow-validator covers multiple rules (A3 reachability,
 * A4 disjoint kinds boundary, S2 dangling target, plus stepKind/intent
 * checks). We pick the most specific code per pattern; unmatched
 * messages fall back to `A3` (the dominant rule for this validator).
 *
 * TODO[T2.2]: replace this string-matching with native Decision-shaped
 * sub-validators per rule once `BootKernel.boot` lands.
 */
function mapFlowMessageToCode(
  message: string,
): ValidationErrorCode | undefined {
  // S2 — transition target must exist in steps
  if (message.includes("does not exist in steps")) return "S2";
  // A4 — boundary: kind crossing rules
  if (message.includes("boundary") || message.includes("should target")) {
    return "A4";
  }
  // A3 — reachability: orphan / no closure / cycle / per-entry-point
  if (
    message.includes("not reachable") ||
    message.includes("cannot reach") ||
    message.includes("No closure step") ||
    message.includes("form a cycle")
  ) {
    return "A3";
  }
  // S3 — allowedIntents ↔ transitions consistency
  if (
    message.includes("allowedIntents") ||
    message.includes("not allowed for stepKind") ||
    message.includes("escalate") ||
    message.includes("only valid for verification")
  ) {
    return "S3";
  }
  return undefined;
}

/**
 * Heuristic mapping from a path-validator error message to its design
 * rule code. The path-validator covers A5 (schemaRef.file existence) +
 * S6 (C3L prompt resolution) + S4 (schema name resolution).
 */
function mapPathMessageToCode(
  message: string,
): ValidationErrorCode | undefined {
  // S6 — C3L prompt file resolution
  if (message.includes("C3L prompt file")) return "S6";
  // A5 — outputSchemaRef.file existence
  if (message.includes("outputSchemaRef")) return "A5";
  // S4 — schema name (pointer) resolution
  if (
    message.startsWith("[SCHEMA]") ||
    message.includes("not found in") ||
    message.includes("failed to validate schema name")
  ) {
    return "S4";
  }
  return undefined;
}

/**
 * Per-validator Decision projection of a {@link FullValidationResult}.
 *
 * Each field carries:
 * - `null`            — validator did not run for this agent (e.g.,
 *                       no steps_registry.json present)
 * - `Decision<void>`  — validator ran; Accept on success, Reject with
 *                       file-prefixed `ValidationError[]` on failure
 *
 * The aggregate `decision` field is the `combineDecisions` of all
 * non-null sub-decisions — a single Reject if **any** validator
 * rejected, accumulating every error across the chain.
 */
export interface FullValidationDecision {
  readonly decision: Decision<void>;
  readonly perValidator: {
    readonly agentSchema: Decision<void>;
    readonly agentConfig: Decision<void>;
    readonly registrySchema: Decision<void> | null;
    readonly crossRef: Decision<void> | null;
    readonly path: Decision<void> | null;
    readonly labelExistence: Decision<void> | null;
    readonly flow: Decision<void> | null;
    readonly prompt: Decision<void> | null;
    readonly uvReachability: Decision<void> | null;
    readonly templateUv: Decision<void> | null;
    readonly frontmatterRegistry: Decision<void> | null;
    readonly stepRegistry: Decision<void> | null;
    readonly handoffInputs: Decision<void> | null;
    readonly configRegistry: Decision<void> | null;
  };
}

/**
 * Project a {@link FullValidationResult} into the unified
 * {@link Decision} shape (T1.4 boundary).
 *
 * The projection assigns each validator a design rule code (W / A / S).
 * Validators whose checks span multiple rules (flow, path) use a
 * per-message heuristic; unmatched messages fall back to a closest-fit
 * code with a TODO[T2.2] noted in the mapper.
 */
export function asDecision(
  result: FullValidationResult,
): FullValidationDecision {
  const agentSchema = decisionFromSchema(
    result.agentSchemaResult,
    "A2",
    "agent.json",
  );
  const agentConfig = decisionFromLegacy(
    result.agentConfigResult,
    "A2",
    "agent.json",
  );
  const registrySchema = result.registrySchemaResult
    ? decisionFromSchema(
      result.registrySchemaResult,
      "S4",
      "steps_registry.json",
    )
    : null;
  const crossRef = result.crossRefResult
    ? decisionFromLegacy(
      // CrossRefResult shape matches LegacyValidationLike (no warnings).
      {
        valid: result.crossRefResult.valid,
        errors: result.crossRefResult.errors,
      },
      "S2",
      "steps_registry.json",
    )
    : null;
  const path = result.pathResult
    ? decisionFromLegacyMapped(
      result.pathResult,
      mapPathMessageToCode,
      "A5",
      "agent.json/steps_registry.json",
    )
    : null;
  const labelExistence = result.labelExistenceResult
    ? decisionFromLegacy(
      result.labelExistenceResult,
      "W5",
      "workflow.json",
    )
    : null;
  const flow = result.flowResult
    ? decisionFromLegacyMapped(
      result.flowResult,
      mapFlowMessageToCode,
      "A3",
      "steps_registry.json",
    )
    : null;
  const prompt = result.promptResult
    ? decisionFromLegacy(result.promptResult, "S6", "steps_registry.json")
    : null;
  const uvReachability = result.uvReachabilityResult
    ? decisionFromLegacy(
      result.uvReachabilityResult,
      "S6",
      "steps_registry.json",
    )
    : null;
  const templateUv = result.templateUvResult
    ? decisionFromLegacy(
      result.templateUvResult,
      "S6",
      "steps_registry.json",
    )
    : null;
  const frontmatterRegistry = result.frontmatterRegistryResult
    ? decisionFromLegacy(
      result.frontmatterRegistryResult,
      "S6",
      "steps_registry.json",
    )
    : null;
  const stepRegistry = result.stepRegistryValidation
    ? decisionFromLegacy(
      result.stepRegistryValidation,
      "S3",
      "steps_registry.json",
    )
    : null;
  const handoffInputs = result.handoffInputsResult
    ? decisionFromLegacy(
      result.handoffInputsResult,
      "W9",
      "steps_registry.json",
    )
    : null;
  const configRegistry = result.configRegistryResult
    ? decisionFromLegacy(
      result.configRegistryResult,
      "S6",
      "steps_registry.json/.agent/climpt/config",
    )
    : null;

  const all: Decision<void>[] = [agentSchema, agentConfig];
  for (
    const d of [
      registrySchema,
      crossRef,
      path,
      labelExistence,
      flow,
      prompt,
      uvReachability,
      templateUv,
      frontmatterRegistry,
      stepRegistry,
      handoffInputs,
      configRegistry,
    ]
  ) {
    if (d !== null) all.push(d);
  }

  const combined = combineDecisions(all);
  // `combineDecisions` returns `Decision<readonly void[]>`; collapse to
  // `Decision<void>` for the boundary shape.
  const decision: Decision<void> = combined.kind === "accept"
    ? acceptVoid()
    : rejectDecision(combined.errors);

  return {
    decision,
    perValidator: {
      agentSchema,
      agentConfig,
      registrySchema,
      crossRef,
      path,
      labelExistence,
      flow,
      prompt,
      uvReachability,
      templateUv,
      frontmatterRegistry,
      stepRegistry,
      handoffInputs,
      configRegistry,
    },
  };
}

/**
 * Run {@link validateFull} and return a unified {@link Decision}.
 *
 * Convenience composition for callers that want the Decision shape
 * directly (precursor of `BootKernel.boot` in T2.2).
 */
export async function validateFullAsDecision(
  agentName: string,
  baseDir: string,
  opts?: ValidateFullOptions,
): Promise<FullValidationDecision> {
  const result = await validateFull(agentName, baseDir, opts);
  return asDecision(result);
}

/**
 * Run {@link validateFull} and throw {@link BootValidationFailed} on
 * Reject. The thrown error carries the **complete** aggregated
 * `ValidationError[]` so a single boot reports every rule violation
 * at once.
 *
 * Use this from `BootKernel.boot` (T2.2 entry point) and any caller
 * that already catches generic errors. Validators stay Decision-shaped
 * internally; the throw is confined to the boundary.
 */
export async function validateFullOrThrow(
  agentName: string,
  baseDir: string,
  opts?: ValidateFullOptions,
): Promise<FullValidationResult> {
  const result = await validateFull(agentName, baseDir, opts);
  const { decision } = asDecision(result);
  if (decision.kind === "reject") {
    throw new BootValidationFailed(decision.errors);
  }
  return result;
}

export type { FullValidationDecision as _FullValidationDecisionAlias };
