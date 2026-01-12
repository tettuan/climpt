// deno-lint-ignore-file no-await-in-loop
/**
 * Agent Loop - Main Loop Execution
 *
 * Responsibility: Loop control, completion checking, delegation to iteration executor
 * Side effects: SDK calls (via IterationExecutor)
 */

import type { AgentDefinition, IterationSummary } from "../src_common/types.ts";
import type {
  AgentResultV2,
  CheckContext,
  CompletionContract,
} from "../src_common/contracts.ts";
import type { SdkMessage } from "../bridge/sdk-bridge.ts";
import { IterationExecutor } from "./iteration.ts";
import { StepContextImpl } from "./step-context.ts";
import {
  FormatValidator,
  type ResponseFormat,
  type ValidationResult,
} from "./format-validator.ts";

export interface LoopContext {
  definition: Readonly<AgentDefinition>;
  cwd: string;
  args: Record<string, unknown>;
  completionHandler: CompletionContract;
  buildPrompt: (
    iteration: number,
    lastSummary?: IterationSummary,
  ) => Promise<string>;
  buildSystemPrompt: () => Promise<string>;
}

export interface LoopResult extends AgentResultV2 {
  summaries: IterationSummary[];
}

/**
 * Check definition for step validation with retry support.
 */
export interface StepCheckDefinition {
  /** Expected response format */
  responseFormat: ResponseFormat;
  /** Action when check passes */
  onPass: {
    /** Mark as complete */
    complete?: boolean;
    /** Next step ID */
    next?: string;
  };
  /** Action when check fails */
  onFail: {
    /** Retry the step */
    retry?: boolean;
    /** Maximum retry attempts */
    maxRetries?: number;
    /** Prompt configuration for retry request */
    retryPrompt?: {
      c2: string;
      c3: string;
      edition: string;
    };
  };
}

/**
 * Result of step execution with validation.
 */
export interface StepValidationResult {
  /** Whether the step completed successfully */
  success: boolean;
  /** Extracted data from valid response */
  data?: unknown;
  /** Validation result details */
  validation?: ValidationResult;
  /** Number of retries performed */
  retryCount: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Query function type for SDK calls.
 */
export type QueryFunction = (
  prompt: string,
  systemPrompt: string,
  sessionId?: string,
) => AsyncIterable<SdkMessage>;

/**
 * Main agent loop execution.
 */
export class AgentLoop {
  private readonly iterationExecutor = new IterationExecutor();
  private readonly stepContext = new StepContextImpl();
  private readonly formatValidator = new FormatValidator();

  /**
   * Execute the agent loop until completion.
   *
   * @param context - Loop context with dependencies
   * @param queryFn - Function to execute SDK queries
   * @returns Loop result with summaries
   */
  async execute(
    context: LoopContext,
    queryFn: (
      prompt: string,
      systemPrompt: string,
      sessionId?: string,
    ) => AsyncIterable<SdkMessage>,
  ): Promise<LoopResult> {
    const summaries: IterationSummary[] = [];
    let sessionId: string | undefined;
    let iteration = 0;
    const maxIterations = this.getMaxIterations(context.definition);

    while (iteration < maxIterations) {
      iteration++;

      // Build prompts
      const lastSummary = summaries.length > 0
        ? summaries[summaries.length - 1]
        : undefined;
      // Note: Sequential execution required - each iteration depends on the previous
      const prompt = await context.buildPrompt(iteration, lastSummary);
      const systemPrompt = await context.buildSystemPrompt();

      // Execute iteration
      const result = await this.iterationExecutor.execute(
        { iteration, sessionId, prompt, systemPrompt },
        queryFn,
      );

      summaries.push(result.summary);
      sessionId = result.sessionId;

      // Check completion
      const checkContext: CheckContext = {
        iteration,
        stepContext: this.stepContext,
      };

      const completionResult = context.completionHandler.check(checkContext);

      if (completionResult.complete) {
        return {
          success: true,
          reason: completionResult.reason ?? "Completed",
          iterations: iteration,
          summaries,
        };
      }
    }

    // Max iterations reached
    return {
      success: false,
      reason: `Max iterations (${maxIterations}) reached`,
      iterations: iteration,
      summaries,
    };
  }

  /**
   * Get max iterations from definition.
   */
  private getMaxIterations(definition: AgentDefinition): number {
    if (definition.behavior.completionType === "iterate") {
      const config = definition.behavior.completionConfig as {
        maxIterations?: number;
      };
      return config?.maxIterations ?? 100;
    }
    return 100; // Default max
  }

  /**
   * Get the step context for external access.
   */
  getStepContext(): StepContextImpl {
    return this.stepContext;
  }

  /**
   * Execute a step with format validation and retry support.
   *
   * This method executes a prompt, validates the response format,
   * and retries with a re-request prompt if validation fails.
   *
   * @param options - Step execution options
   * @param queryFn - Function to execute SDK queries
   * @returns Step validation result
   */
  async executeStepWithValidation(
    options: {
      /** Current iteration number */
      iteration: number;
      /** Session ID for conversation continuity */
      sessionId?: string;
      /** Initial prompt to send */
      prompt: string;
      /** System prompt */
      systemPrompt: string;
      /** Check definition with format and retry config */
      check: StepCheckDefinition;
      /** Function to build retry prompt */
      buildRetryPrompt: (error: string) => Promise<string>;
    },
    queryFn: QueryFunction,
  ): Promise<
    StepValidationResult & { sessionId?: string; summary: IterationSummary }
  > {
    const { check } = options;
    const maxRetries = check.onFail?.maxRetries ?? 0;

    let retryCount = 0;
    let sessionId = options.sessionId;
    let lastError = "";
    let lastSummary: IterationSummary | undefined;

    while (true) {
      // Determine which prompt to use
      const prompt = retryCount === 0
        ? options.prompt
        : await options.buildRetryPrompt(lastError);

      // Execute iteration
      const result = await this.iterationExecutor.execute(
        {
          iteration: options.iteration + retryCount,
          sessionId,
          prompt,
          systemPrompt: options.systemPrompt,
        },
        queryFn,
      );

      sessionId = result.sessionId;
      lastSummary = result.summary;

      // Validate response format
      const validation = this.formatValidator.validate(
        result.summary,
        check.responseFormat,
      );

      if (validation.valid) {
        // Success - format matches
        return {
          success: true,
          data: validation.extracted,
          validation,
          retryCount,
          sessionId,
          summary: result.summary,
        };
      }

      // Validation failed
      lastError = validation.error ?? "Unknown validation error";

      // Check if we should retry
      if (check.onFail?.retry && retryCount < maxRetries) {
        retryCount++;
        continue;
      }

      // No more retries - return failure
      return {
        success: false,
        validation,
        retryCount,
        error: lastError,
        sessionId,
        summary: lastSummary,
      };
    }
  }

  /**
   * Get the format validator for external access.
   */
  getFormatValidator(): FormatValidator {
    return this.formatValidator;
  }
}
