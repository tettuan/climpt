/**
 * Completion Manager - initialization and validation of completion conditions.
 *
 * Handles:
 * - Loading StepRegistry and initializing CompletionChain, StepGateInterpreter, WorkflowRouter
 * - Validating completion conditions for steps
 * - Detecting AI completion declarations in structured output
 * - Determining completion step IDs
 *
 * Extracted from runner.ts for separation of concerns.
 */

import type { AgentDefinition, IterationSummary } from "../src_common/types.ts";
import { isRecord } from "../src_common/type-guards.ts";
import type { CompletionValidator } from "../validators/completion/validator.ts";
import type { RetryHandler } from "../retry/retry-handler.ts";
import {
  type ExtendedStepsRegistry,
  hasCompletionChainSupport,
  hasFlowRoutingSupport,
} from "../common/completion-types.ts";
import { loadStepRegistry } from "../common/step-registry.ts";
import {
  CompletionChain,
  type CompletionValidationResult,
} from "./completion-chain.ts";
import { join } from "@std/path";
import { PATHS } from "../shared/paths.ts";
import type { AgentDependencies } from "./builder.ts";
import { isInitializable } from "./builder.ts";
import { StepGateInterpreter } from "./step-gate-interpreter.ts";
import { WorkflowRouter } from "./workflow-router.ts";
import type { StepRegistry } from "../common/step-registry.ts";
import {
  createFallbackProvider,
  PromptResolver as StepPromptResolver,
} from "../common/prompt-resolver.ts";
import type { SchemaManager } from "./schema-manager.ts";

export interface CompletionManagerDeps {
  readonly definition: AgentDefinition;
  readonly dependencies: AgentDependencies;
}

export interface CompletionManagerState {
  completionValidator: CompletionValidator | null;
  retryHandler: RetryHandler | null;
  stepsRegistry: ExtendedStepsRegistry | null;
  completionChain: CompletionChain | null;
  stepGateInterpreter: StepGateInterpreter | null;
  workflowRouter: WorkflowRouter | null;
  stepPromptResolver: StepPromptResolver | null;
}

export class CompletionManager {
  private readonly deps: CompletionManagerDeps;

  // Completion validation
  completionValidator: CompletionValidator | null = null;
  retryHandler: RetryHandler | null = null;
  stepsRegistry: ExtendedStepsRegistry | null = null;
  completionChain: CompletionChain | null = null;

  // Step flow orchestration
  stepGateInterpreter: StepGateInterpreter | null = null;
  workflowRouter: WorkflowRouter | null = null;

  // Step-level prompt resolver (for closure adaptation)
  stepPromptResolver: StepPromptResolver | null = null;

  constructor(deps: CompletionManagerDeps) {
    this.deps = deps;
  }

  /**
   * Initialize Completion validation system.
   *
   * Loads StepRegistry and initializes components based on registry capabilities:
   * - CompletionChain support (completionPatterns/validators)
   * - Flow routing support (structuredGate in steps)
   */
  async initializeCompletionValidation(
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
      const hasCompletionChain = hasCompletionChainSupport(registry);
      const hasFlowRouting = hasFlowRoutingSupport(registry);

      // Fail-fast: stepMachine completion requires structuredGate on at least one step
      if (
        this.deps.definition.behavior.completionType === "stepMachine" &&
        !hasFlowRouting
      ) {
        throw new Error(
          `[StepFlow][ConfigError] Agent "${this.deps.definition.name}" uses completionType "stepMachine" ` +
            `but registry has no steps with structuredGate. Add structuredGate to at least one step ` +
            `or change completionType. See design/08_step_flow_design.md.`,
        );
      }

      if (!hasCompletionChain && !hasFlowRouting) {
        logger.debug(
          "Registry has no extended capabilities (no completionPatterns, validators, or structuredGate), skipping setup",
        );
        return;
      }

      // Store registry with proper typing
      const stepsRegistry: ExtendedStepsRegistry = registry;
      this.stepsRegistry = stepsRegistry;

      const capabilities: string[] = [];
      if (hasCompletionChain) capabilities.push("CompletionChain");
      if (hasFlowRouting) capabilities.push("FlowRouting");
      logger.info(
        `Loaded steps registry with capabilities: ${capabilities.join(", ")}`,
      );

      // Initialize CompletionChain components if supported
      if (hasCompletionChain) {
        // Initialize CompletionValidator factory
        const validatorFactory =
          this.deps.dependencies.completionValidatorFactory;
        if (validatorFactory) {
          if (isInitializable(validatorFactory)) {
            await validatorFactory.initialize();
          }
          this.completionValidator = validatorFactory.create({
            registry: stepsRegistry,
            workingDir: cwd,
            logger,
            agentId: this.deps.definition.name,
          });
          logger.debug("CompletionValidator initialized");
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

        // Initialize CompletionChain
        this.completionChain = new CompletionChain({
          workingDir: cwd,
          logger,
          stepsRegistry: stepsRegistry,
          completionValidator: this.completionValidator,
          retryHandler: this.retryHandler,
          agentId: this.deps.definition.name,
        });
        logger.debug("CompletionChain initialized");
      }

      // Initialize Flow routing components if supported
      if (hasFlowRouting) {
        // Validate that all Flow steps have structuredGate and transitions
        schemaManager.validateFlowSteps(stepsRegistry, logger);

        this.stepGateInterpreter = new StepGateInterpreter();
        this.workflowRouter = new WorkflowRouter(
          stepsRegistry as unknown as StepRegistry,
        );
        logger.debug("StepGateInterpreter and WorkflowRouter initialized");

        // Initialize step prompt resolver for closure adaptation
        this.stepPromptResolver = new StepPromptResolver(
          stepsRegistry as unknown as StepRegistry,
          createFallbackProvider({}),
          { workingDir: cwd, configSuffix: "steps" },
        );
        logger.debug("StepPromptResolver initialized for closure adaptation");
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        logger.debug(
          `Steps registry not found at ${registryPath}, using default completion`,
        );
      } else {
        logger.warn(`Failed to load steps registry: ${error}`);
      }
    }
  }

  /**
   * Validate completion conditions for a step.
   */
  async validateCompletionConditions(
    stepId: string,
    _summary: IterationSummary,
    logger: import("../src_common/logger.ts").Logger,
  ): Promise<CompletionValidationResult> {
    if (!this.stepsRegistry) {
      return { valid: true };
    }

    const stepConfig = this.stepsRegistry.completionSteps?.[stepId];
    if (!stepConfig) {
      return { valid: true };
    }

    // Use CompletionChain for validation (logs internally)
    if (this.completionChain) {
      return await this.completionChain.validate(stepId, _summary);
    }

    // Fallback path - log here since CompletionChain is not used
    logger.info(`Validating completion for step: ${stepId}`);

    // Fallback to command-based validation
    if (
      !this.completionValidator ||
      !stepConfig.completionConditions?.length
    ) {
      return { valid: true };
    }

    const result = await this.completionValidator.validate(
      stepConfig.completionConditions,
    );

    if (result.valid) {
      logger.info("All completion conditions passed");
      return { valid: true };
    }

    logger.warn(`Completion validation failed: pattern=${result.pattern}`);

    if (this.retryHandler && result.pattern) {
      const retryPrompt = await this.retryHandler.buildRetryPrompt(
        stepConfig,
        result,
      );
      return { valid: false, retryPrompt };
    }

    return {
      valid: false,
      retryPrompt: `Completion conditions not met: ${
        result.error ?? result.pattern
      }`,
    };
  }

  /**
   * Check if AI declared completion via structured output.
   *
   * Only "closing" intent from Closure Step triggers completion.
   * Note: "complete" is accepted for backward compatibility.
   * Note: status: "completed" is NOT a completion signal.
   */
  hasAICompletionDeclaration(summary: IterationSummary): boolean {
    if (!summary.structuredOutput) {
      return false;
    }

    const so = summary.structuredOutput;

    if (isRecord(so.next_action)) {
      const nextAction = so.next_action as Record<string, unknown>;
      if (nextAction.action === "closing" || nextAction.action === "complete") {
        return true;
      }
    }

    return false;
  }

  /**
   * Get completion step ID based on completion type.
   */
  getCompletionStepId(): string {
    if (this.completionChain) {
      return this.completionChain.getCompletionStepId(
        this.deps.definition.behavior.completionType,
      );
    }
    return "closure.issue";
  }

  /**
   * Check if flow routing is enabled.
   */
  hasFlowRoutingEnabled(): boolean {
    return this.stepGateInterpreter !== null && this.workflowRouter !== null;
  }
}
