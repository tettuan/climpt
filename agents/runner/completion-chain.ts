/**
 * CompletionChain - Completion validation chain
 *
 * Responsibility: Execute validation checks before allowing task completion.
 * Manages the chain of validators (format, completion, retry).
 *
 * Extracted from runner.ts as part of responsibility separation.
 */

import type { Logger } from "../src_common/logger.ts";
import type { ActionResult, IterationSummary } from "../src_common/types.ts";
import type {
  CompletionStepConfig,
  ExtendedStepsRegistry,
} from "../common/completion-types.ts";
import type { CompletionValidator } from "../validators/completion/validator.ts";
import type { RetryHandler } from "../retry/retry-handler.ts";
import type { FormatValidationResult } from "../loop/format-validator.ts";
import { isRecord } from "../src_common/type-guards.ts";

/**
 * Result of completion validation
 */
export interface CompletionValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Retry prompt if validation failed */
  retryPrompt?: string;
  /** Format validation result (if applicable) */
  formatValidation?: FormatValidationResult;
}

/**
 * Options for CompletionChain creation
 */
export interface CompletionChainOptions {
  /** Working directory */
  workingDir: string;
  /** Logger instance */
  logger: Logger;
  /** Steps registry (extended) */
  stepsRegistry: ExtendedStepsRegistry | null;
  /** Completion validator */
  completionValidator: CompletionValidator | null;
  /** Retry handler */
  retryHandler: RetryHandler | null;
  /** Agent ID */
  agentId: string;
}

/**
 * CompletionChain handles all validation checks before task completion.
 *
 * Responsibilities:
 * - Format validation
 * - Completion condition validation
 * - Retry prompt generation
 * - Close action detection
 */
export class CompletionChain {
  private readonly workingDir: string;
  private readonly logger: Logger;
  private readonly stepsRegistry: ExtendedStepsRegistry | null;
  private readonly completionValidator: CompletionValidator | null;
  private readonly retryHandler: RetryHandler | null;
  private readonly agentId: string;

  constructor(options: CompletionChainOptions) {
    this.workingDir = options.workingDir;
    this.logger = options.logger;
    this.stepsRegistry = options.stepsRegistry;
    this.completionValidator = options.completionValidator;
    this.retryHandler = options.retryHandler;
    this.agentId = options.agentId;
  }

  /**
   * Validate completion conditions for a step.
   *
   * Note: Structured output validation is now handled by Closer at runner level.
   * This method only handles command-based validation fallback.
   *
   * @param stepId - Step identifier
   * @param _summary - Current iteration summary (unused)
   * @param _queryFn - Query function (unused, kept for API compatibility)
   * @returns Validation result
   */
  async validate(
    stepId: string,
    _summary: IterationSummary,
    _queryFn: (
      prompt: string,
      options: { outputSchema?: unknown },
    ) => AsyncIterable<unknown>,
  ): Promise<CompletionValidationResult> {
    const stepConfig = this.getStepConfig(stepId);

    if (!stepConfig) {
      return { valid: true };
    }

    this.logger.info(`Validating completion for step: ${stepId}`);

    // Structured output validation is handled by Closer at runner level
    // CompletionChain only handles command-based validation fallback
    if (stepConfig.outputSchema) {
      this.logger.debug(
        "[CompletionChain] outputSchema defined, validation handled by Closer",
      );
      return { valid: true };
    }

    // Command-based validation
    if (
      !this.completionValidator ||
      !stepConfig.completionConditions?.length
    ) {
      return { valid: true };
    }

    return await this.validateWithConditions(stepConfig);
  }

  /**
   * Check if any action result indicates a close action.
   */
  hasCloseAction(results: ActionResult[]): boolean {
    return results.some((r) => {
      if (r.action?.type !== "issue-action") return false;
      if (!isRecord(r.result)) return false;
      return r.result.action === "close";
    });
  }

  /**
   * Get completion step ID based on completion type.
   *
   * Maps completion type to the appropriate step ID in the registry.
   * Uses dynamic lookup in stepsRegistry if available, otherwise defaults.
   */
  getCompletionStepId(completionType: string): string {
    // Check if registry has a completion step for this type
    if (this.stepsRegistry?.completionSteps) {
      const stepId = `complete.${completionType}`;
      if (this.stepsRegistry.completionSteps[stepId]) {
        return stepId;
      }
    }

    // Type-specific defaults
    switch (completionType) {
      case "issue":
      case "externalState":
        return "complete.issue";
      case "iterate":
      case "iterationBudget":
        return "complete.iterate";
      default:
        return `complete.${completionType}`;
    }
  }

  /**
   * Get step configuration from registry.
   */
  private getStepConfig(stepId: string): CompletionStepConfig | undefined {
    if (!this.stepsRegistry?.completionSteps) {
      return undefined;
    }
    return this.stepsRegistry.completionSteps[stepId];
  }

  /**
   * Validate using completion conditions.
   */
  private async validateWithConditions(
    stepConfig: CompletionStepConfig,
  ): Promise<CompletionValidationResult> {
    if (!this.completionValidator) {
      return { valid: true };
    }

    const result = await this.completionValidator.validate(
      stepConfig.completionConditions,
    );

    if (result.valid) {
      this.logger.info("All completion conditions passed");
      return { valid: true };
    }

    this.logger.warn(`Completion validation failed: pattern=${result.pattern}`);

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
      retryPrompt: `Completion conditions not met: ${
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
