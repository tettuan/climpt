/**
 * Closure Manager - initialization and validation of closure conditions.
 *
 * Handles:
 * - Loading StepRegistry and initializing ValidationChain, StepGateInterpreter, WorkflowRouter
 * - Validating conditions for steps
 * - Detecting AI verdict declarations in structured output
 * - Determining closure step IDs
 *
 * Extracted from runner.ts for separation of concerns.
 */

import type { AgentDefinition, IterationSummary } from "../src_common/types.ts";
import { isRecord } from "../src_common/type-guards.ts";
import type { StepValidator } from "../validators/step/validator.ts";
import type { RetryHandler } from "../retry/retry-handler.ts";
import {
  type ExtendedStepsRegistry,
  hasFlowRoutingSupport,
  hasValidationChainSupport,
} from "../common/validation-types.ts";
import { loadStepRegistry } from "../common/step-registry.ts";
import { ValidationChain, type ValidationResult } from "./validation-chain.ts";
import { join } from "@std/path";
import { PATHS } from "../shared/paths.ts";
import {
  srGateNoStructuredGateSteps,
  srLoadNotFound,
} from "../shared/errors/config-errors.ts";
import type { AgentDependencies } from "./builder.ts";
import { isInitializable } from "./builder.ts";
import { StepGateInterpreter } from "./step-gate-interpreter.ts";
import { WorkflowRouter } from "./workflow-router.ts";
import type { StepRegistry } from "../common/step-registry.ts";
import { inferStepKind } from "../common/step-registry.ts";
import {
  createFallbackProvider,
  type PromptResolutionResult,
  PromptResolver as StepPromptResolver,
} from "../common/prompt-resolver.ts";
import { getDefaultFallbackTemplates } from "../prompts/fallback.ts";
import type { SchemaManager } from "./schema-manager.ts";

export interface ClosureManagerDeps {
  readonly definition: AgentDefinition;
  readonly dependencies: AgentDependencies;
}

export interface ClosureManagerState {
  stepValidator: StepValidator | null;
  retryHandler: RetryHandler | null;
  stepsRegistry: ExtendedStepsRegistry | null;
  validationChain: ValidationChain | null;
  stepGateInterpreter: StepGateInterpreter | null;
  workflowRouter: WorkflowRouter | null;
  stepPromptResolver: StepPromptResolver | null;
}

export class ClosureManager {
  private readonly deps: ClosureManagerDeps;

  // Validation
  stepValidator: StepValidator | null = null;
  retryHandler: RetryHandler | null = null;
  stepsRegistry: ExtendedStepsRegistry | null = null;
  validationChain: ValidationChain | null = null;

  // Step flow orchestration
  stepGateInterpreter: StepGateInterpreter | null = null;
  workflowRouter: WorkflowRouter | null = null;

  // Step-level prompt resolver (for work-step and closure adaptation)
  stepPromptResolver: StepPromptResolver | null = null;

  constructor(deps: ClosureManagerDeps) {
    this.deps = deps;
  }

  /**
   * Initialize validation system.
   *
   * Loads StepRegistry and initializes components based on registry capabilities:
   * - ValidationChain support (failurePatterns/validators)
   * - Flow routing support (structuredGate in steps)
   */
  async initializeValidation(
    agentDir: string,
    cwd: string,
    logger: import("../src_common/logger.ts").Logger,
    schemaManager: SchemaManager,
  ): Promise<void> {
    const registryPath = join(agentDir, PATHS.STEPS_REGISTRY);

    try {
      // Use loadStepRegistry for unified validation (fail-fast per design/08_step_flow_design.md)
      const registry = await loadStepRegistry(
        this.deps.definition.name,
        "", // Not used when registryPath is provided
        {
          registryPath,
          validateIntentEnums: false, // Defer enum validation
        },
      );
      logger.debug(
        "Registry validation passed (stepKind, entryStep, intentSchemaRef format)",
      );

      // Honor registry.schemasBase override per builder/01_quickstart.md
      const schemasBase = registry.schemasBase ??
        `.agent/${this.deps.definition.name}/schemas`;
      const schemasDir = join(cwd, schemasBase);

      // Now validate intent schema enums with the correct schemasDir
      const { validateIntentSchemaEnums } = await import(
        "../common/step-registry.ts"
      );
      await validateIntentSchemaEnums(registry, schemasDir);
      logger.debug("Intent schema enum validation passed");

      // Check for extended registry capabilities
      const hasValidationChain = hasValidationChainSupport(registry);
      const hasFlowRouting = hasFlowRoutingSupport(registry);

      // Fail-fast: stepMachine verdict requires structuredGate on at least one step
      if (
        this.deps.definition.runner.verdict.type === "detect:graph" &&
        !hasFlowRouting
      ) {
        throw srGateNoStructuredGateSteps(this.deps.definition.name);
      }

      // Store registry with proper typing (needed by FlowOrchestrator for entryStepMapping)
      const stepsRegistry: ExtendedStepsRegistry = registry;
      this.stepsRegistry = stepsRegistry;

      // Always create stepPromptResolver when registry has work steps
      // (independent of flow routing / validation chain capabilities)
      const hasWorkSteps = Object.values(stepsRegistry.steps).some(
        (s) => typeof s === "object" && s !== null && "stepKind" in s,
      );
      if (hasWorkSteps) {
        this.stepPromptResolver = new StepPromptResolver(
          stepsRegistry as unknown as StepRegistry,
          createFallbackProvider(getDefaultFallbackTemplates()),
          { workingDir: cwd, configSuffix: stepsRegistry.c1 },
        );
        logger.debug("StepPromptResolver initialized (work steps detected)");
      }

      if (!hasValidationChain && !hasFlowRouting) {
        logger.debug(
          "Registry has no extended capabilities (no failurePatterns, validators, or structuredGate), skipping setup",
        );
        return;
      }

      const capabilities: string[] = [];
      if (hasValidationChain) capabilities.push("ValidationChain");
      if (hasFlowRouting) capabilities.push("FlowRouting");
      logger.info(
        `Loaded steps registry with capabilities: ${capabilities.join(", ")}`,
      );

      // Initialize ValidationChain components if supported
      if (hasValidationChain) {
        // Initialize StepValidator factory
        const validatorFactory = this.deps.dependencies.stepValidatorFactory;
        if (validatorFactory) {
          if (isInitializable(validatorFactory)) {
            await validatorFactory.initialize();
          }
          this.stepValidator = validatorFactory.create({
            registry: stepsRegistry,
            workingDir: cwd,
            logger,
            agentId: this.deps.definition.name,
          });
          logger.debug("StepValidator initialized");
        }

        // Initialize RetryHandler factory
        const retryFactory = this.deps.dependencies.retryHandlerFactory;
        if (retryFactory) {
          if (isInitializable(retryFactory)) {
            await retryFactory.initialize();
          }
          this.retryHandler = retryFactory.create({
            registry: stepsRegistry,
            workingDir: cwd,
            logger,
            agentId: this.deps.definition.name,
          });
          logger.debug("RetryHandler initialized");
        }

        // Initialize ValidationChain
        this.validationChain = new ValidationChain({
          workingDir: cwd,
          logger,
          stepsRegistry: stepsRegistry,
          stepValidator: this.stepValidator,
          retryHandler: this.retryHandler,
          agentId: this.deps.definition.name,
        });
        logger.debug("ValidationChain initialized");
      }

      // Initialize Flow routing components if supported
      if (hasFlowRouting) {
        // Validate that all Flow steps have structuredGate and transitions
        schemaManager.validateFlowSteps(stepsRegistry, logger);

        this.stepGateInterpreter = new StepGateInterpreter();
        this.workflowRouter = new WorkflowRouter(
          stepsRegistry as unknown as StepRegistry,
          logger,
        );
        logger.debug("StepGateInterpreter and WorkflowRouter initialized");

        // stepPromptResolver already created above (hasWorkSteps check)
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw srLoadNotFound(registryPath);
      }
      throw error;
    }
  }

  /**
   * Validate conditions for a step.
   */
  async validateConditions(
    stepId: string,
    _summary: IterationSummary,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<ValidationResult> {
    if (!this.stepsRegistry) {
      return { valid: true };
    }

    const stepConfig = this.stepsRegistry.validationSteps?.[stepId];
    if (!stepConfig) {
      return { valid: true };
    }

    // Use ValidationChain for validation (logs internally)
    if (this.validationChain) {
      return await this.validationChain.validate(stepId, _summary);
    }

    // Fallback path - log here since ValidationChain is not used
    logger.info(`Validating conditions for step: ${stepId}`);

    // Fallback to command-based validation
    if (
      !this.stepValidator ||
      !stepConfig.validationConditions?.length
    ) {
      return { valid: true };
    }

    const result = await this.stepValidator.validate(
      stepConfig.validationConditions,
    );

    if (result.valid) {
      logger.info("All validation conditions passed");
      return { valid: true };
    }

    logger.warn(`Validation failed: pattern=${result.pattern}`);

    if (this.retryHandler && result.pattern) {
      const retryPrompt = await this.retryHandler.buildRetryPrompt(
        stepConfig,
        result,
      );
      return { valid: false, retryPrompt };
    }

    return {
      valid: false,
      retryPrompt: `Validation conditions not met: ${
        result.error ?? result.pattern
      }`,
    };
  }

  /**
   * Check if AI declared verdict via structured output.
   *
   * Only "closing" intent from Closure Step triggers completion.
   * Note: status: "completed" is NOT a completion signal.
   */
  hasAIVerdictDeclaration(summary: IterationSummary): boolean {
    if (!summary.structuredOutput) {
      return false;
    }

    const so = summary.structuredOutput;

    if (isRecord(so.next_action)) {
      const nextAction = so.next_action as Record<string, unknown>;
      if (nextAction.action === "closing") {
        return true;
      }
    }

    return false;
  }

  /**
   * Get closure step ID based on verdict type.
   */
  getClosureStepId(): string {
    if (this.validationChain) {
      return this.validationChain.getClosureStepId(
        this.deps.definition.runner.verdict.type,
      );
    }
    return "closure.issue";
  }

  /**
   * Resolve a Flow Loop step prompt via stepPromptResolver (C3L).
   *
   * Handles both work and verification steps (all Flow Loop steps).
   * Returns null when resolver is unavailable, step is not found,
   * or the step is a closure step (handled by Completion Loop).
   */
  async resolveFlowStepPrompt(
    stepId: string,
    variables: Record<string, string>,
  ): Promise<PromptResolutionResult | null> {
    if (!this.stepPromptResolver || !this.stepsRegistry) {
      return null;
    }

    const stepDef = (this.stepsRegistry as unknown as StepRegistry)
      .steps?.[stepId];
    if (!stepDef) {
      return null;
    }

    const stepKind = inferStepKind(stepDef);
    if (stepKind === "closure") {
      return null;
    }

    try {
      return await this.stepPromptResolver.resolve(stepId, { uv: variables });
    } catch {
      return null;
    }
  }

  /**
   * Check if flow routing is enabled.
   */
  hasFlowRoutingEnabled(): boolean {
    return this.stepGateInterpreter !== null && this.workflowRouter !== null;
  }
}
