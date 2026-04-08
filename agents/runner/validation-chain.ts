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
  FailureAction,
  ResponseFormat,
  ValidationStepConfig,
} from "../common/validation-types.ts";
import type { StepValidator } from "../validators/step/validator.ts";
import type { RetryHandler } from "../retry/retry-handler.ts";
import {
  type FormatValidationResult,
  FormatValidator,
} from "../loop/format-validator.ts";

/** Default maxAttempts when not configured */
const DEFAULT_MAX_ATTEMPTS = 3;

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
  /** Failure action to take (only set when valid is false) */
  action?: FailureAction;
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
  /** Tracks retry attempt count per step ID */
  private readonly retryAttempts: Map<string, number> = new Map();

  constructor(options: ValidationChainOptions) {
    this.workingDir = options.workingDir;
    this.logger = options.logger;
    this.stepsRegistry = options.stepsRegistry;
    this.stepValidator = options.stepValidator;
    this.retryHandler = options.retryHandler;
    this.agentId = options.agentId;
  }

  /**
   * Post-LLM validation for a step (Phase 2).
   *
   * Runs format validation when outputSchema is defined, then
   * falls through to command-based validation conditions.
   * State validation (Phase 1) runs separately via `validateState()`.
   *
   * @param stepId - Step identifier
   * @param summary - Current iteration summary (used for format validation)
   * @returns Validation result
   */
  async validate(
    stepId: string,
    summary: IterationSummary,
  ): Promise<ValidationResult> {
    const stepConfig = this.getStepConfig(stepId);

    if (!stepConfig) {
      return { valid: true };
    }

    this.logger.info(`Validating conditions for step: ${stepId}`);

    // Phase 2: Post-LLM format validation
    if (stepConfig.outputSchema && summary) {
      const formatValidator = new FormatValidator();
      const responseFormat: ResponseFormat = {
        type: "json",
        schema: stepConfig.outputSchema,
      };
      const formatResult = formatValidator.validate(summary, responseFormat);
      if (!formatResult.valid) {
        this.logger.warn(
          `[ValidationChain] Format validation failed: ${formatResult.error}`,
        );
        return {
          valid: false,
          retryPrompt: this.buildFormatRetryPrompt(formatResult),
          formatValidation: formatResult,
        };
      }
      this.logger.debug("[ValidationChain] Format validation passed");
    }

    // Command-based validation conditions
    if (
      !this.stepValidator ||
      !stepConfig.validationConditions?.length
    ) {
      return { valid: true };
    }

    return await this.validateWithConditions(stepConfig);
  }

  /**
   * Pre-flight state validation - runs BEFORE LLM call.
   *
   * Validates state-based conditions (command/file/semantic validators) only.
   * Unlike `validate()`, this does NOT early-return when outputSchema is defined,
   * because state conditions must be checked regardless of output format.
   *
   * @param stepId - Step identifier
   * @returns Validation result
   */
  async validateState(stepId: string): Promise<ValidationResult> {
    const stepConfig = this.getStepConfig(stepId);
    if (!stepConfig) {
      return { valid: true };
    }

    // Run conditions regardless of outputSchema
    if (!this.stepValidator || !stepConfig.validationConditions?.length) {
      return { valid: true };
    }

    this.logger.info(`Pre-flight state validation for step: ${stepId}`);
    return this.validateWithConditions(stepConfig);
  }

  /**
   * Verdict type to closure step ID mapping.
   *
   * Decouples verdict type names from step IDs so renaming verdict types
   * does not break step lookups.
   */
  private static readonly VERDICT_CLOSURE_MAP: Record<string, string> = {
    "poll:state": "closure.polling",
    "count:iteration": "closure.iteration",
    "count:check": "closure.check",
    "detect:keyword": "closure.keyword",
    "detect:structured": "closure.structured",
    "detect:graph": "closure.graph",
    "meta:composite": "closure.composite",
    "meta:custom": "closure.custom",
  };

  /**
   * Get closure step ID based on verdict type.
   *
   * Maps verdict type to the appropriate step ID in the registry
   * using an explicit mapping table.
   */
  getClosureStepId(verdictType: string): string {
    if (this.stepsRegistry?.validationSteps) {
      const closureStepId = ValidationChain.VERDICT_CLOSURE_MAP[verdictType];
      if (
        closureStepId && this.stepsRegistry.validationSteps[closureStepId]
      ) {
        return closureStepId;
      }
    }
    return ValidationChain.VERDICT_CLOSURE_MAP[verdictType] ??
      `closure.${verdictType}`;
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
   *
   * Reads `stepConfig.onFailure.action` and `maxAttempts` to determine
   * the failure action. Unrecoverable failures override to "abort".
   * Exceeding maxAttempts overrides to "abort".
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
      // Reset retry counter on success
      this.retryAttempts.delete(stepConfig.stepId);
      return { valid: true };
    }

    this.logger.warn(`Validation failed: pattern=${result.pattern}`);

    // Determine action from onFailure config (default: "retry")
    let action: FailureAction = stepConfig.onFailure?.action ?? "retry";

    // Override to "abort" when failure is unrecoverable
    if (result.recoverable === false) {
      this.logger.warn(
        `[Validation] Unrecoverable failure detected, aborting: ${
          result.error ?? result.pattern
        }`,
      );
      action = "abort";
    }

    // Track retry attempts and enforce maxAttempts
    if (action === "retry") {
      const currentAttempts = (this.retryAttempts.get(stepConfig.stepId) ?? 0) +
        1;
      this.retryAttempts.set(stepConfig.stepId, currentAttempts);

      const maxAttempts = stepConfig.onFailure?.maxAttempts ??
        DEFAULT_MAX_ATTEMPTS;
      if (currentAttempts >= maxAttempts) {
        this.logger.warn(
          `[Validation] maxAttempts (${maxAttempts}) exceeded for step "${stepConfig.stepId}", aborting`,
        );
        action = "abort";
      }
    }

    // Build retry prompt if RetryHandler is available
    let retryPrompt: string | undefined;
    if (this.retryHandler && result.pattern) {
      retryPrompt = await this.retryHandler.buildRetryPrompt(
        stepConfig,
        result,
      );
    } else {
      retryPrompt = `Validation conditions not met: ${
        result.error ?? result.pattern
      }`;
    }

    return { valid: false, retryPrompt, action };
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
