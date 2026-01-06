/**
 * Step Registry - Prompt Externalization Foundation
 *
 * Manages step definitions that map logical steps (e.g., "initial.issue")
 * to external prompt files. This enables:
 * - Customizable prompts via user files in .agent/{agent}/prompts/
 * - Fallback to built-in prompts when user files don't exist
 * - Variable substitution for dynamic content
 */

import { join } from "@std/path";

/**
 * Step definition for external prompt resolution
 *
 * Maps a logical step identifier to a prompt file and its requirements.
 */
export interface StepDefinition {
  /** Unique step identifier (e.g., "initial.issue", "continuation.project.processing") */
  stepId: string;

  /** Human-readable name for logging/debugging */
  name: string;

  /**
   * Relative path to prompt file from .agent/{agent}/prompts/
   * Example: "initial/issue.md" -> .agent/iterator/prompts/initial/issue.md
   */
  promptPath: string;

  /**
   * Key for fallback prompt in embedded prompts
   * Used when user prompt file doesn't exist
   */
  fallbackKey: string;

  /**
   * List of UV (user variable) names required by this prompt
   * Example: ["issue_number", "repository"]
   */
  uvVariables: string[];

  /**
   * Whether this step uses STDIN input
   * If true, {input_text} variable will be available
   */
  usesStdin: boolean;

  /**
   * Optional description of what this step does
   */
  description?: string;
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

  /** All step definitions indexed by stepId */
  steps: Record<string, StepDefinition>;

  /**
   * Default base directory for user prompts
   * Default: ".agent/{agentId}/prompts"
   */
  userPromptsBase?: string;
}

/**
 * Registry loader options
 */
export interface RegistryLoaderOptions {
  /** Custom registry file path (overrides default) */
  registryPath?: string;

  /** Validate schema on load */
  validateSchema?: boolean;
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
  agentsDir: string = "agents",
  options: RegistryLoaderOptions = {},
): Promise<StepRegistry> {
  const registryPath = options.registryPath ??
    join(agentsDir, agentId, "registry.json");

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

    // Optionally validate schema
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

/**
 * Get a step definition by ID
 *
 * @param registry - Step registry
 * @param stepId - Step identifier to find
 * @returns Step definition or undefined
 */
export function getStepDefinition(
  registry: StepRegistry,
  stepId: string,
): StepDefinition | undefined {
  return registry.steps[stepId];
}

/**
 * Get all step IDs in a registry
 *
 * @param registry - Step registry
 * @returns Array of step IDs
 */
export function getStepIds(registry: StepRegistry): string[] {
  return Object.keys(registry.steps);
}

/**
 * Check if a step exists in the registry
 *
 * @param registry - Step registry
 * @param stepId - Step identifier to check
 * @returns true if step exists
 */
export function hasStep(registry: StepRegistry, stepId: string): boolean {
  return stepId in registry.steps;
}

/**
 * Create an empty registry for an agent
 *
 * @param agentId - Agent identifier
 * @param version - Registry version (default: "1.0.0")
 * @returns Empty step registry
 */
export function createEmptyRegistry(
  agentId: string,
  version: string = "1.0.0",
): StepRegistry {
  return {
    agentId,
    version,
    steps: {},
    userPromptsBase: `.agent/${agentId}/prompts`,
  };
}

/**
 * Add a step definition to a registry
 *
 * @param registry - Step registry to modify
 * @param step - Step definition to add
 * @throws Error if step already exists
 */
export function addStepDefinition(
  registry: StepRegistry,
  step: StepDefinition,
): void {
  if (registry.steps[step.stepId]) {
    throw new Error(`Step "${step.stepId}" already exists in registry`);
  }
  registry.steps[step.stepId] = step;
}

/**
 * Validate a step registry structure
 *
 * @param registry - Registry to validate
 * @throws Error if validation fails
 */
export function validateStepRegistry(registry: StepRegistry): void {
  const errors: string[] = [];

  // Validate registry-level fields
  if (typeof registry.agentId !== "string" || !registry.agentId) {
    errors.push("agentId must be a non-empty string");
  }
  if (typeof registry.version !== "string" || !registry.version) {
    errors.push("version must be a non-empty string");
  }
  if (typeof registry.steps !== "object" || registry.steps === null) {
    errors.push("steps must be an object");
  }

  // Validate each step definition
  for (const [stepId, step] of Object.entries(registry.steps)) {
    if (step.stepId !== stepId) {
      errors.push(
        `Step key "${stepId}" does not match stepId "${step.stepId}"`,
      );
    }
    if (typeof step.name !== "string" || !step.name) {
      errors.push(`Step "${stepId}": name must be a non-empty string`);
    }
    if (typeof step.promptPath !== "string" || !step.promptPath) {
      errors.push(`Step "${stepId}": promptPath must be a non-empty string`);
    }
    if (typeof step.fallbackKey !== "string" || !step.fallbackKey) {
      errors.push(`Step "${stepId}": fallbackKey must be a non-empty string`);
    }
    if (!Array.isArray(step.uvVariables)) {
      errors.push(`Step "${stepId}": uvVariables must be an array`);
    }
    if (typeof step.usesStdin !== "boolean") {
      errors.push(`Step "${stepId}": usesStdin must be a boolean`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Registry validation failed:\n- ${errors.join("\n- ")}`);
  }
}

/**
 * Serialize a registry to JSON string
 *
 * @param registry - Registry to serialize
 * @param pretty - Use pretty formatting (default: true)
 * @returns JSON string
 */
export function serializeRegistry(
  registry: StepRegistry,
  pretty: boolean = true,
): string {
  return JSON.stringify(registry, null, pretty ? 2 : 0);
}

/**
 * Save a registry to a file
 *
 * @param registry - Registry to save
 * @param filePath - Destination file path
 */
export async function saveStepRegistry(
  registry: StepRegistry,
  filePath: string,
): Promise<void> {
  const content = serializeRegistry(registry);
  await Deno.writeTextFile(filePath, content + "\n");
}
