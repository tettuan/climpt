/**
 * Step Context - Data Passing Between Steps
 *
 * Responsibility: Store and retrieve step outputs, convert to UV variables
 * Side effects: None (internal Map updates only)
 */

import type {
  InputSpec,
  StepContext as IStepContext,
} from "../src_common/contracts.ts";

/**
 * Implementation of StepContext for managing step outputs.
 */
export class StepContextImpl implements IStepContext {
  outputs: Map<string, Record<string, unknown>> = new Map();

  /**
   * Store output data for a step.
   */
  set(stepId: string, data: Record<string, unknown>): void {
    this.outputs.set(stepId, { ...data });
  }

  /**
   * Get a specific value from a step's output.
   */
  get(stepId: string, key: string): unknown | undefined {
    return this.outputs.get(stepId)?.[key];
  }

  /**
   * Get all outputs for a step.
   */
  getAll(stepId: string): Record<string, unknown> | undefined {
    return this.outputs.get(stepId);
  }

  /**
   * Convert inputs specification to UV variables.
   *
   * @param inputs - Input specification mapping variable names to step.key references
   * @returns Record of UV variable names to values
   */
  toUV(inputs: InputSpec): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [varName, spec] of Object.entries(inputs)) {
      let value: unknown;

      if (spec.from) {
        // Parse "stepId.key" format
        const [stepId, key] = spec.from.split(".");
        value = this.get(stepId, key);
      }

      // Apply default if value is undefined
      if (value === undefined && spec.default !== undefined) {
        value = spec.default;
      }

      // Check required constraint
      if (value === undefined && spec.required) {
        throw new Error(
          `Required input '${varName}' not found from '${spec.from}'`,
        );
      }

      // Convert to string for UV variable
      if (value !== undefined) {
        result[`uv-${varName}`] = String(value);
      }
    }

    return result;
  }

  /**
   * Clear all stored outputs.
   */
  clear(): void {
    this.outputs.clear();
  }
}
