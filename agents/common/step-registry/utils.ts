/**
 * Step Registry Utilities
 *
 * Helper functions for working with step registries.
 */

import type { PromptStepDefinition, StepKind, StepRegistry } from "./types.ts";
import { STEP_PHASE } from "../../shared/step-phases.ts";
import type { StepPhase } from "../../shared/step-phases.ts";

/**
 * Get a step definition by ID.
 *
 * Retrieves a PromptStepDefinition from the registry by its stepId.
 * Returns undefined if no step with the given ID exists.
 *
 * @param registry - The StepRegistry to search in
 * @param stepId - The unique step identifier to find (e.g., "initial.issue", "continuation.project")
 * @returns The PromptStepDefinition if found, or undefined if the step does not exist
 *
 * @example
 * ```typescript
 * const step = getStepDefinition(registry, "initial.issue");
 * if (step) {
 *   console.log(`Found step: ${step.name}`);
 * }
 * ```
 */
export function getStepDefinition(
  registry: StepRegistry,
  stepId: string,
): PromptStepDefinition | undefined {
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
 * Create an empty registry for an agent.
 *
 * Creates a new StepRegistry with default configuration. The registry
 * is initialized with an empty steps collection and a default user
 * prompts base path of `.agent/{agentId}/prompts`.
 *
 * @param agentId - Unique identifier for the agent (e.g., "iterator", "reviewer")
 * @param c1 - C3L path component c1, typically "steps" for step definitions
 * @param version - Semantic version string for the registry (default: "1.0.0")
 * @returns A new StepRegistry object with the specified configuration and empty steps
 *
 * @example
 * ```typescript
 * const registry = createEmptyRegistry("my-agent");
 * // registry.agentId === "my-agent"
 * // registry.steps === {}
 * // registry.userPromptsBase === ".agent/my-agent/prompts"
 * ```
 */
export function createEmptyRegistry(
  agentId: string,
  c1 = "steps",
  version = "1.0.0",
): StepRegistry {
  return {
    agentId,
    version,
    c1,
    steps: {},
    userPromptsBase: `.agent/${agentId}/prompts`,
  };
}

/**
 * Add a step definition to a registry.
 *
 * Adds a new PromptStepDefinition to the registry's steps collection,
 * indexed by its stepId. This function mutates the registry in place.
 *
 * @param registry - The StepRegistry object to modify
 * @param step - The PromptStepDefinition to add to the registry
 * @returns void - The function modifies the registry in place
 * @throws {Error} If a step with the same stepId already exists in the registry
 *
 * @example
 * ```typescript
 * const registry = createEmptyRegistry("my-agent");
 * addStepDefinition(registry, {
 *   stepId: "initial.issue",
 *   name: "Issue Analysis",
 *   c2: "initial",
 *   c3: "issue",
 *   edition: "default",
 *   fallbackKey: "initial_issue",
 *   uvVariables: ["issue_number"],
 *   usesStdin: false
 * });
 * ```
 */
export function addStepDefinition(
  registry: StepRegistry,
  step: PromptStepDefinition,
): void {
  if (registry.steps[step.stepId]) {
    throw new Error(`Step "${step.stepId}" already exists in registry`);
  }
  registry.steps[step.stepId] = step;
}

/**
 * Infer stepKind from step definition.
 *
 * Priority:
 * 1. Explicit stepKind if defined
 * 2. Infer from c2 value
 *
 * @param step - Step definition
 * @returns Inferred step kind or undefined
 */
export function inferStepKind(
  step: PromptStepDefinition,
): StepKind | undefined {
  // Use explicit stepKind if defined
  if (step.stepKind) {
    return step.stepKind;
  }

  // Infer from c2
  switch (step.c2 as StepPhase) {
    case STEP_PHASE.INITIAL:
    case STEP_PHASE.CONTINUATION:
      return "work";
    case STEP_PHASE.VERIFICATION:
      return "verification";
    case STEP_PHASE.CLOSURE:
      return "closure";
    default:
      // section and other non-flow steps don't have a kind
      return undefined;
  }
}
