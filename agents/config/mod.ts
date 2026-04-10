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
  validateAgentSchema,
  validateRegistrySchema,
} from "./schema-validator.ts";
import type { SchemaValidationResult } from "./schema-validator.ts";
import { validateCrossReferences } from "./registry-validator.ts";
import type { CrossRefResult } from "./registry-validator.ts";
import { validatePaths } from "./path-validator.ts";
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

// Re-export for convenience
export { validate, validateComplete } from "./validator.ts";
export { applyDefaults, deepFreeze, freeze } from "./defaults.ts";
export { getAgentDir } from "./loader.ts";
export type { SchemaValidationResult } from "./schema-validator.ts";
export type { CrossRefResult } from "./registry-validator.ts";

/**
 * Load, validate, and prepare an agent definition.
 * This is the main entry point for configuration loading.
 *
 * @param agentName - Name of the agent
 * @param baseDir - Base directory containing .agent folder
 * @returns Frozen, validated AgentDefinition
 * @throws ConfigError (AC-SERVICE-*) if loading fails
 * @throws ConfigError (AC-VALID-*) if validation fails
 */
export async function loadConfiguration(
  agentName: string,
  baseDir: string,
): Promise<Readonly<ResolvedAgentDefinition>> {
  const agentDir = getAgentDir(agentName, baseDir);

  // Load raw configuration
  const raw = await loadRaw(agentDir);

  // Validate raw
  const rawValidation = validate(raw);
  if (!rawValidation.valid) {
    throw acValidFailed(rawValidation.errors.join(", "));
  }

  // Log warnings
  if (rawValidation.warnings.length > 0) {
    const logger = new BreakdownLogger("config");
    for (const warning of rawValidation.warnings) {
      logger.warn(warning);
    }
  }

  // Apply defaults
  const definition = applyDefaults(raw);

  // Validate complete definition
  const completeValidation = validateComplete(definition);
  if (!completeValidation.valid) {
    throw acValidIncomplete(completeValidation.errors.join(", "));
  }

  // Load steps registry if referenced
  if (definition.runner.flow.prompts.registry) {
    const registry = await loadStepsRegistry(agentDir);
    if (registry) {
      // Attach registry to definition (if needed by other components)
      // Using Object.assign to add a non-typed property
      Object.assign(definition, { __stepsRegistry: registry });
    }
  }

  return freeze(definition);
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
    const typedRegistry = registry as unknown as StepRegistry;
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

  // 5b. Path validation (runs after registry loading so schema file paths can be checked)
  const pathResult = await validatePaths(definition, agentDir, registry);

  // 6b. Flow reachability validation (only when registry exists)
  const flowResult = registry ? validateFlowReachability(registry) : null;

  // 6c. Prompt resolution validation (only when registry exists)
  const promptResult = registry
    ? await validatePrompts(registry, agentDir)
    : null;

  // 6d. UV reachability validation (only when registry exists)
  const uvReachabilityResult = registry
    ? validateUvReachability(registry, raw as Record<string, unknown>)
    : null;

  // 6e. Template UV consistency validation (only when registry exists)
  const templateUvResult = registry
    ? await validateTemplateUvConsistency(registry, agentDir, baseDir)
    : null;

  // 6f. Frontmatter-registry UV consistency validation (only when registry exists)
  const frontmatterRegistryResult = registry
    ? await validateFrontmatterRegistry(registry, agentDir, baseDir)
    : null;

  // 6g. Handoff-to-inputs compatibility validation (only when registry exists)
  const handoffInputsResult = registry ? validateHandoffInputs(registry) : null;

  // 6h. Config-registry consistency (only when registry exists)
  const configDir = join(baseDir, ".agent", "climpt", "config");
  const configRegistryResult = registry
    ? await validateConfigRegistryConsistency(registry, configDir)
    : null;

  // 7. Aggregate
  const valid = agentSchemaResult.valid &&
    agentConfigResult.valid &&
    (registrySchemaResult?.valid ?? true) &&
    (crossRefResult?.valid ?? true) &&
    pathResult.valid &&
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
