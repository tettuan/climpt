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

// Re-export for convenience
export { ConfigurationLoadError } from "./loader.ts";
export { validate, validateComplete } from "./validator.ts";
export { applyDefaults, deepFreeze, freeze } from "./defaults.ts";
export { getAgentDir } from "./loader.ts";

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
