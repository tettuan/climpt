/**
 * ValidationChain - Validation chain for step closure
 *
 * Responsibility: Execute validation checks before allowing task completion.
 * Manages the chain of validators (format, completion, retry).
 *
 * Extracted from runner.ts as part of responsibility separation.
 */

import type { Logger } from "../src_common/logger.ts";
import type { IterationSummary } from "../src_common/types.ts";
import type {
  ExtendedStepsRegistry,
  ValidationStepConfig,
} from "../common/validation-types.ts";
import type { StepValidator } from "../validators/step/validator.ts";
import type { RetryHandler } from "../retry/retry-handler.ts";
import type { FormatValidationResult } from "../loop/format-validator.ts";

/**
 * Result of validation
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Retry prompt if validation failed */
  retryPrompt?: string;
  /** Format validation result (if applicable) */
  formatValidation?: FormatValidationResult;
}

/**
 * Options for ValidationChain creation
 */
export interface ValidationChainOptions {
  /** Working directory */
  workingDir: string;
  /** Logger instance */
  logger: Logger;
  /** Steps registry (extended) */
  stepsRegistry: ExtendedStepsRegistry | null;
  /** Step validator */
  stepValidator: StepValidator | null;
  /** Retry handler */
  retryHandler: RetryHandler | null;
  /** Agent ID */
  agentId: string;
}

/**
 * ValidationChain handles all validation checks before task completion.
 *
 * Responsibilities:
 * - Format validation
 * - Validation condition checking
 * - Retry prompt generation
 * - Close action detection
 */
export class ValidationChain {
  private readonly workingDir: string;
  private readonly logger: Logger;
  private readonly stepsRegistry: ExtendedStepsRegistry | null;
  private readonly stepValidator: StepValidator | null;
  private readonly retryHandler: RetryHandler | null;
  private readonly agentId: string;

  constructor(options: ValidationChainOptions) {
    this.workingDir = options.workingDir;
    this.logger = options.logger;
    this.stepsRegistry = options.stepsRegistry;
    this.stepValidator = options.stepValidator;
    this.retryHandler = options.retryHandler;
    this.agentId = options.agentId;
  }

  /**
   * Validate conditions for a step.
   *
   * Note: Structured output validation is handled at runner level.
   * This method only handles command-based validation fallback.
   *
   * @param stepId - Step identifier
   * @param _summary - Current iteration summary (unused)
   * @returns Validation result
   */
  async validate(
    stepId: string,
    _summary: IterationSummary,
  ): Promise<ValidationResult> {
    const stepConfig = this.getStepConfig(stepId);

    if (!stepConfig) {
      return { valid: true };
    }

    this.logger.info(`Validating conditions for step: ${stepId}`);

    // Structured output validation is handled at runner level
    // ValidationChain only handles command-based validation fallback
    if (stepConfig.outputSchema) {
      this.logger.debug(
        "[ValidationChain] outputSchema defined, validation handled at runner level",
      );
      return { valid: true };
    }

    // Command-based validation
    if (
      !this.stepValidator ||
      !stepConfig.validationConditions?.length
    ) {
      return { valid: true };
    }

    return await this.validateWithConditions(stepConfig);
  }

  /**
   * Get closure step ID based on verdict type.
   *
   * Maps verdict type to the appropriate step ID in the registry.
   * Uses dynamic lookup in stepsRegistry if available, otherwise defaults.
   */
  getClosureStepId(verdictType: string): string {
    // Check if registry has a validation step for this type
    if (this.stepsRegistry?.validationSteps) {
      const stepId = `closure.${verdictType}`;
      if (this.stepsRegistry.validationSteps[stepId]) {
        return stepId;
      }
    }

    // Type-specific defaults
    switch (verdictType) {
      case "issue":
        return "closure.issue";
      case "iterate":
      case "iterationBudget":
        return "closure.iterate";
      default:
        // externalState and others use closure.${verdictType}
        return `closure.${verdictType}`;
    }
  }

  /**
   * Get step configuration from registry.
   */
  private getStepConfig(stepId: string): ValidationStepConfig | undefined {
    if (!this.stepsRegistry?.validationSteps) {
      return undefined;
    }
    return this.stepsRegistry.validationSteps[stepId];
  }

  /**
   * Validate using validation conditions.
   */
  private async validateWithConditions(
    stepConfig: ValidationStepConfig,
  ): Promise<ValidationResult> {
    if (!this.stepValidator) {
      return { valid: true };
    }

    const result = await this.stepValidator.validate(
      stepConfig.validationConditions,
    );

    if (result.valid) {
      this.logger.info("All validation conditions passed");
      return { valid: true };
    }

    this.logger.warn(`Validation failed: pattern=${result.pattern}`);

    // Build retry prompt if RetryHandler is available
    if (this.retryHandler && result.pattern) {
      const retryPrompt = await this.retryHandler.buildRetryPrompt(
        stepConfig,
        result,
      );
      return { valid: false, retryPrompt };
    }

    // Fallback: return generic failure message
    return {
      valid: false,
      retryPrompt: `Validation conditions not met: ${
        result.error ?? result.pattern
      }`,
    };
  }

  /**
   * Build retry prompt for format validation failure.
   */
  private buildFormatRetryPrompt(
    result: FormatValidationResult,
  ): string {
    const lines = [
      "The previous response did not match the expected format.",
      "",
      `Error: ${result.error}`,
      "",
      "Please provide a response in the correct format.",
    ];
    return lines.join("\n");
  }

  /**
   * Get step ID for a given iteration.
   */
  getStepIdForIteration(iteration: number): string {
    if (!this.stepsRegistry?.steps) {
      return `step.${iteration}`;
    }
    const stepIds = Object.keys(this.stepsRegistry.steps);
    const index = Math.min(iteration - 1, stepIds.length - 1);
    return stepIds[index] ?? `step.${iteration}`;
  }
}
