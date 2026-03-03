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
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import {
  validateAgentSchema,
  validateRegistrySchema,
} from "./schema-validator.ts";
import type { SchemaValidationResult } from "./schema-validator.ts";
import { validateCrossReferences } from "./registry-validator.ts";
import type { CrossRefResult } from "./registry-validator.ts";

// Re-export for convenience
export { ConfigurationLoadError } from "./loader.ts";
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
 * @throws ConfigurationLoadError if loading fails
 * @throws Error if validation fails
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
    throw new Error(
      `Configuration validation failed: ${rawValidation.errors.join(", ")}`,
    );
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
    throw new Error(
      `Configuration incomplete: ${completeValidation.errors.join(", ")}`,
    );
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
  const agentSchemaResult = await validateAgentSchema(raw);

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
  let registrySchemaResult: SchemaValidationResult | null = null;
  let crossRefResult: CrossRefResult | null = null;

  try {
    const registry = await loadStepsRegistry(agentDir);
    if (registry) {
      // 5. Schema validation on registry
      registrySchemaResult = await validateRegistrySchema(registry);

      // 6. Cross-reference validation
      crossRefResult = validateCrossReferences(
        registry as Record<string, unknown>,
      );
    }
  } catch {
    // Registry file doesn't exist or can't be parsed - not an error for
    // agents that don't use step flow.
  }

  // 7. Aggregate
  const valid = agentSchemaResult.valid &&
    agentConfigResult.valid &&
    (registrySchemaResult?.valid ?? true) &&
    (crossRefResult?.valid ?? true);

  return {
    valid,
    agentSchemaResult,
    agentConfigResult,
    registrySchemaResult,
    crossRefResult,
  };
}
