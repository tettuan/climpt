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
   * Validates using:
   * 1. Structured output query (if outputSchema is defined) - SDK-level validation
   * 2. Command execution (if conditions are defined) - Run validation commands
   *
   * @param stepId - Step identifier
   * @param _summary - Current iteration summary (unused for now)
   * @param queryFn - Function to execute SDK queries
   * @returns Validation result
   */
  async validate(
    stepId: string,
    _summary: IterationSummary,
    queryFn: (
      prompt: string,
      options: { outputSchema?: unknown },
    ) => AsyncIterable<unknown>,
  ): Promise<CompletionValidationResult> {
    const stepConfig = this.getStepConfig(stepId);

    if (!stepConfig) {
      return { valid: true };
    }

    this.logger.info(`Validating completion for step: ${stepId}`);

    // Try structured output validation if schema is available
    if (stepConfig.outputSchema) {
      return await this.validateWithStructuredOutput(stepConfig, queryFn);
    }

    // Fallback to command-based validation
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
   */
  getCompletionStepId(completionType: string): string {
    if (completionType === "issue") {
      return "complete.issue";
    }
    return "complete.issue";
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
   * Validate using structured output query.
   */
  private async validateWithStructuredOutput(
    stepConfig: CompletionStepConfig,
    queryFn: (
      prompt: string,
      options: { outputSchema?: unknown },
    ) => AsyncIterable<unknown>,
  ): Promise<CompletionValidationResult> {
    this.logger.info(
      "[CompletionChain] Using structured output for validation",
    );

    try {
      const prompt = this.buildValidationPrompt();
      const queryOptions = {
        outputSchema: {
          type: "json_schema",
          schema: stepConfig.outputSchema,
        },
      };

      let structuredOutput: Record<string, unknown> | undefined;
      let queryError: string | undefined;

      const queryIterator = queryFn(prompt, queryOptions);

      for await (const message of queryIterator) {
        if (!isRecord(message)) continue;

        if (message.type === "result") {
          if (
            message.subtype === "success" &&
            isRecord(message.structured_output)
          ) {
            structuredOutput = message.structured_output;
            this.logger.info("[CompletionChain] Got validation result");
          } else if (
            message.subtype === "error_max_structured_output_retries"
          ) {
            queryError = "Could not produce valid validation output";
            this.logger.error(
              "[CompletionChain] Failed to produce valid output",
            );
          }
        }
      }

      if (!structuredOutput) {
        return {
          valid: false,
          retryPrompt: queryError ?? "Validation query failed",
        };
      }

      return this.checkValidationResults(structuredOutput);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error("[CompletionChain] Query failed", {
        error: errorMessage,
      });
      return {
        valid: false,
        retryPrompt: `Validation query failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Validate using completion conditions (fallback).
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
   * Build the prompt for validation query.
   */
  private buildValidationPrompt(): string {
    return `Run the following validation checks and report the results:

1. **Git status**: Run \`git status --porcelain\` to check for uncommitted changes
   - Set git_clean to true only if the output is empty
   - Include the actual output in evidence.git_status_output

2. **Type check**: Run \`deno task check\` or \`deno check\`
   - Set type_check_passed to true only if exit code is 0
   - Include the actual output in evidence.type_check_output

Report results as structured JSON with:
- validation.git_clean: boolean
- validation.type_check_passed: boolean
- evidence: actual command outputs`;
  }

  /**
   * Check validation results from structured output.
   */
  private checkValidationResults(
    output: Record<string, unknown>,
  ): CompletionValidationResult {
    if (!isRecord(output.validation)) {
      return {
        valid: false,
        retryPrompt: "Missing validation field in response",
      };
    }

    const validation = output.validation;
    const errors: string[] = [];

    if (validation.git_clean !== true) {
      errors.push(
        "git_clean is false - please commit or stash changes before closing",
      );
    }

    if (validation.type_check_passed !== true) {
      errors.push("type_check_passed is false - please fix type errors");
    }

    if (validation.tests_passed === false) {
      errors.push("tests_passed is false - please fix failing tests");
    }

    if (validation.lint_passed === false) {
      errors.push("lint_passed is false - please fix lint errors");
    }

    if (validation.format_check_passed === false) {
      errors.push("format_check_passed is false - please run formatter");
    }

    if (errors.length > 0) {
      this.logger.warn("[CompletionChain] Validation failed", { errors });
      return {
        valid: false,
        retryPrompt: `Completion validation failed:\n${
          errors.map((e) => `- ${e}`).join("\n")
        }`,
      };
    }

    this.logger.info("[CompletionChain] All validation checks passed");
    return { valid: true };
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
