/**
 * Schema Manager - loads and validates JSON schemas for step flow.
 *
 * Handles:
 * - Loading schemas from outputSchemaRef
 * - $ref resolution
 * - Fail-fast tracking (2-strike rule for consecutive failures)
 * - Flow step validation (structuredGate, transitions, outputSchemaRef)
 *
 * Extracted from runner.ts for separation of concerns.
 */

import type { AgentDefinition, RuntimeContext } from "../src_common/types.ts";
import { AgentSchemaResolutionError } from "./errors.ts";
import type { PromptStepDefinition } from "../common/step-registry.ts";
import type {
  ExtendedStepsRegistry,
  OutputSchemaRef,
} from "../common/completion-types.ts";
import {
  SchemaPointerError,
  SchemaResolver,
} from "../common/schema-resolver.ts";
import { join } from "@std/path";
import { AGENT_LIMITS } from "../shared/constants.ts";

export interface SchemaManagerDeps {
  readonly definition: AgentDefinition;
  getContext(): RuntimeContext;
  getStepsRegistry(): ExtendedStepsRegistry | null;
}

export class SchemaManager {
  private readonly deps: SchemaManagerDeps;

  // Schema resolution failure tracking (fail-fast)
  // Maps stepId -> consecutive failure count
  private schemaFailureCount: Map<string, number> = new Map();
  // Flag to skip StepGate when schema resolution failed
  private _schemaResolutionFailed = false;
  // Maximum consecutive schema failures before aborting
  private static readonly MAX_SCHEMA_FAILURES =
    AGENT_LIMITS.MAX_SCHEMA_FAILURES;

  constructor(deps: SchemaManagerDeps) {
    this.deps = deps;
  }

  get schemaResolutionFailed(): boolean {
    return this._schemaResolutionFailed;
  }

  /**
   * Validate that all Flow steps have structuredGate, transitions, and outputSchemaRef.
   *
   * Flow steps are all steps except those prefixed with "section." (template sections).
   */
  validateFlowSteps(
    stepsRegistry: ExtendedStepsRegistry,
    logger: import("../src_common/logger.ts").Logger,
  ): void {
    const missingGate: string[] = [];
    const missingTransitions: string[] = [];
    const missingOutputSchema: string[] = [];

    for (const [stepId, stepDef] of Object.entries(stepsRegistry.steps)) {
      // Skip template sections (section.* prefix)
      if (stepId.startsWith("section.")) {
        continue;
      }

      const step = stepDef as PromptStepDefinition;

      if (!step.structuredGate) {
        missingGate.push(stepId);
      }

      if (!step.transitions) {
        missingTransitions.push(stepId);
      }

      if (!step.outputSchemaRef) {
        missingOutputSchema.push(stepId);
      }
    }

    if (
      missingGate.length > 0 ||
      missingTransitions.length > 0 ||
      missingOutputSchema.length > 0
    ) {
      const errors: string[] = [];

      if (missingGate.length > 0) {
        errors.push(
          `Steps missing structuredGate: ${missingGate.join(", ")}`,
        );
      }

      if (missingTransitions.length > 0) {
        errors.push(
          `Steps missing transitions: ${missingTransitions.join(", ")}`,
        );
      }

      if (missingOutputSchema.length > 0) {
        errors.push(
          `Steps missing outputSchemaRef: ${missingOutputSchema.join(", ")}`,
        );
      }

      throw new Error(
        `[StepFlow] Flow validation failed. All Flow steps must define ` +
          `structuredGate, transitions, and outputSchemaRef.\n${
            errors.join("\n")
          }\n` +
          `See agents/docs/design/08_step_flow_design.md for requirements.`,
      );
    }

    logger.debug(
      `Flow validation passed: ${
        Object.keys(stepsRegistry.steps).length
      } steps validated`,
    );
  }

  /**
   * Load JSON Schema for a step from outputSchemaRef.
   *
   * Implements fail-fast behavior: tracks consecutive schema resolution failures
   * per step and throws AgentSchemaResolutionError after 2 consecutive failures.
   *
   * @throws AgentSchemaResolutionError after 2 consecutive failures on the same step
   */
  async loadSchemaForStep(
    stepId: string,
    iteration: number,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<Record<string, unknown> | undefined> {
    const stepsRegistry = this.deps.getStepsRegistry();

    // Reset schema failure flag at the start of each load attempt
    this._schemaResolutionFailed = false;

    if (!stepsRegistry) {
      logger.warn(
        `[SchemaResolution] Steps registry not available, cannot load schema for step "${stepId}"`,
      );
      return undefined;
    }

    const stepDef = stepsRegistry.steps[stepId] as
      | PromptStepDefinition
      | undefined;
    if (!stepDef?.outputSchemaRef) {
      logger.warn(
        `[SchemaResolution] No outputSchemaRef for step "${stepId}" - structured output will not be enforced`,
      );
      return undefined;
    }

    // Validate outputSchemaRef format - must be object with file and schema properties
    const ref = stepDef.outputSchemaRef;
    if (
      typeof ref !== "object" ||
      ref === null ||
      typeof ref.file !== "string" ||
      typeof ref.schema !== "string"
    ) {
      const actualValue = JSON.stringify(ref);
      const errorMsg = `Invalid outputSchemaRef format for step "${stepId}": ` +
        `expected object with "file" and "schema" properties, got ${actualValue}. ` +
        `See agents/docs/builder/05_troubleshooting.md for correct format.`;
      logger.error(`[SchemaResolution] ${errorMsg}`);
      throw new AgentSchemaResolutionError(errorMsg, {
        stepId,
        schemaRef: actualValue,
        consecutiveFailures: 1,
        iteration,
      });
    }

    try {
      const schema = await this.loadSchemaFromRef(ref, logger);
      // Success - reset failure counter for this step
      this.schemaFailureCount.set(stepId, 0);
      return schema;
    } catch (error) {
      if (error instanceof SchemaPointerError) {
        // Increment failure counter for this step
        const currentCount = this.schemaFailureCount.get(stepId) ?? 0;
        const newCount = currentCount + 1;
        this.schemaFailureCount.set(stepId, newCount);

        const schemaRef =
          `${stepDef.outputSchemaRef.file}#${stepDef.outputSchemaRef.schema}`;

        logger.error(
          `[SchemaResolution] Failed to resolve schema pointer ` +
            `(failure ${newCount}/${SchemaManager.MAX_SCHEMA_FAILURES})`,
          {
            stepId,
            schemaRef,
            pointer: error.pointer,
            file: error.file,
          },
        );

        // Check if we've hit the consecutive failure limit
        if (newCount >= SchemaManager.MAX_SCHEMA_FAILURES) {
          throw new AgentSchemaResolutionError(
            `Schema resolution failed ${newCount} consecutive times for step "${stepId}". ` +
              `Cannot resolve pointer "${error.pointer}" in ${error.file}. ` +
              `Flow halted to prevent infinite loop.`,
            {
              stepId,
              schemaRef,
              consecutiveFailures: newCount,
              cause: error,
              iteration,
            },
          );
        }

        // Set flag to skip StepGate for this iteration (StructuredOutputUnavailable)
        this._schemaResolutionFailed = true;
        logger.warn(
          `[SchemaResolution] Marking iteration as StructuredOutputUnavailable. ` +
            `StepGate will be skipped. Fix schema reference before next iteration.`,
        );
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Load schema from outputSchemaRef with full $ref resolution.
   *
   * @throws SchemaPointerError if the schema pointer cannot be resolved
   */
  private async loadSchemaFromRef(
    ref: OutputSchemaRef,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<Record<string, unknown> | undefined> {
    const ctx = this.deps.getContext();
    const stepsRegistry = this.deps.getStepsRegistry();
    const schemasBase = stepsRegistry?.schemasBase ??
      `.agent/${this.deps.definition.name}/schemas`;
    const schemasDir = join(ctx.cwd, schemasBase);

    try {
      const resolver = new SchemaResolver(schemasDir);
      const schema = await resolver.resolve(ref.file, ref.schema);

      logger.debug(`Loaded and resolved schema: ${ref.file}#${ref.schema}`);
      return schema;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        logger.warn(
          `[SchemaResolution] Schema file not found: ${
            join(schemasDir, ref.file)
          } - structured output will not be enforced`,
        );
        return undefined;
      }
      // Re-throw SchemaPointerError to trigger fail-fast behavior
      if (error instanceof SchemaPointerError) {
        throw error;
      }
      logger.warn(`Failed to load schema from ${ref.file}#${ref.schema}`, {
        error: String(error),
      });
      return undefined;
    }
  }
}
