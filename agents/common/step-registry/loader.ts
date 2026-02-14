/**
 * Step Registry Loader
 *
 * Functions for loading step registries from files.
 */

import { join } from "@std/path";
import type { RegistryLoaderOptions, StepRegistry } from "./types.ts";
import {
  validateEntryStepMapping,
  validateIntentSchemaEnums,
  validateIntentSchemaRef,
  validateStepKindIntents,
  validateStepRegistry,
} from "./validator.ts";
import { PATHS } from "../../shared/paths.ts";

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
    const registry = JSON.parse(content) as StepRegistry;

    // Validate basic structure
    if (!registry.agentId || !registry.version || !registry.steps) {
      throw new Error(
        `Invalid registry format: missing required fields (agentId, version, steps)`,
      );
    }

    // Ensure agentId matches
    if (registry.agentId !== agentId) {
      throw new Error(
        `Registry agentId mismatch: expected "${agentId}", got "${registry.agentId}"`,
      );
    }

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
      throw new Error(`Step registry not found at ${registryPath}`);
    }
    throw error;
  }
}
