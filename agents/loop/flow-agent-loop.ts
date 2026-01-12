// deno-lint-ignore-file no-await-in-loop
/**
 * Flow Agent Loop - Flow-based Step Execution
 *
 * Extends the base AgentLoop with flow-based step execution.
 * Uses FlowExecutor to read flow definitions and execute steps in order.
 *
 * Design Philosophy (from tmp/design-validation-philosophy.md):
 * - Instruction over control
 * - Steps define what should be done
 * - Agent decides whether to follow
 * - Graceful degradation when not followed
 *
 * @module
 */

import type { AgentDefinition, IterationSummary } from "../src_common/types.ts";
import type {
  AgentResultV2,
  CheckContext,
  CompletionContract,
} from "../src_common/contracts.ts";
import type { SdkMessage } from "../bridge/sdk-bridge.ts";
import type { StepRegistry } from "../common/step-registry.ts";
import { IterationExecutor } from "./iteration.ts";
import { StepContextImpl } from "./step-context.ts";
import { type ExpandedContext, FlowExecutor } from "./flow-executor.ts";
import { FormatValidator, type ResponseFormat } from "./format-validator.ts";

/**
 * Step prompt builder function type
 */
export type StepPromptBuilder = (
  stepId: string,
  variables: Record<string, string>,
  expandedContext: ExpandedContext | null,
) => Promise<string>;

/**
 * Flow-aware loop context
 */
export interface FlowLoopContext {
  /** Agent definition */
  definition: Readonly<AgentDefinition>;
  /** Current working directory */
  cwd: string;
  /** CLI arguments */
  args: Record<string, unknown>;
  /** Completion handler */
  completionHandler: CompletionContract;
  /** Build system prompt */
  buildSystemPrompt: () => Promise<string>;
  /** Build step-specific prompt */
  buildStepPrompt: StepPromptBuilder;
  /** Pre-loaded step registry (optional) */
  registry?: StepRegistry;
}

/**
 * Flow loop result
 */
export interface FlowLoopResult extends AgentResultV2 {
  /** Iteration summaries */
  summaries: IterationSummary[];
  /** Final step reached */
  finalStep?: string;
  /** Steps executed in order */
  stepsExecuted: string[];
}

/**
 * Flow execution options
 */
export interface FlowExecutionOptions {
  /** Agent ID */
  agentId: string;
  /** Flow mode (e.g., "issue", "project") */
  mode: string;
  /** Custom validator templates */
  validatorTemplates?: Record<string, string>;
}

/**
 * Step check definition for format validation
 */
export interface StepCheckDefinition {
  /** Expected response format */
  responseFormat: ResponseFormat;
  /** Action when check passes */
  onPass: {
    /** Mark as complete */
    complete?: boolean;
    /** Transition to next step */
    next?: string;
  };
  /** Action when check fails */
  onFail: {
    /** Retry the step */
    retry?: boolean;
    /** Maximum retry attempts */
    maxRetries?: number;
    /** Retry prompt path configuration */
    retryPrompt?: {
      c2: string;
      c3: string;
      edition: string;
    };
  };
}

/**
 * Step validation result
 */
export interface StepValidationResult {
  /** Whether step execution was successful */
  success: boolean;
  /** Summary of the execution */
  summary: IterationSummary;
  /** Updated session ID */
  sessionId?: string;
  /** Whether format validation passed */
  formatValid: boolean;
  /** Format validation error if any */
  formatError?: string;
  /** Extracted data from validated response */
  extractedData?: unknown;
}

/**
 * Flow Agent Loop
 *
 * Executes agent iterations following a defined flow of steps.
 * Each step in the flow is sent as a prompt to the agent.
 *
 * Execution order (for issue flow):
 * 1. work step - main task execution
 * 2. validate step - pre-completion validation (git status, etc.)
 * 3. complete step - structured completion signal
 *
 * @example
 * ```typescript
 * const loop = new FlowAgentLoop();
 * const result = await loop.executeWithFlow(
 *   context,
 *   queryFn,
 *   { agentId: "iterator", mode: "issue" }
 * );
 * ```
 */
export class FlowAgentLoop {
  private readonly iterationExecutor = new IterationExecutor();
  private readonly stepContext = new StepContextImpl();
  private readonly formatValidator = new FormatValidator();

  /**
   * Execute the agent loop with flow-based step execution.
   *
   * @param context - Flow-aware loop context
   * @param queryFn - SDK query function
   * @param options - Flow execution options
   * @returns Flow loop result
   */
  async executeWithFlow(
    context: FlowLoopContext,
    queryFn: (
      prompt: string,
      systemPrompt: string,
      sessionId?: string,
    ) => AsyncIterable<SdkMessage>,
    options: FlowExecutionOptions,
  ): Promise<FlowLoopResult> {
    const summaries: IterationSummary[] = [];
    const stepsExecuted: string[] = [];
    let sessionId: string | undefined;
    let iteration = 0;
    const maxIterations = this.getMaxIterations(context.definition);

    // Create flow executor
    let flowExecutor: FlowExecutor;
    try {
      if (context.registry) {
        flowExecutor = FlowExecutor.fromRegistry(context.registry, {
          agentId: options.agentId,
          mode: options.mode,
          validatorTemplates: options.validatorTemplates,
        });
      } else {
        flowExecutor = await FlowExecutor.create({
          agentId: options.agentId,
          mode: options.mode,
          validatorTemplates: options.validatorTemplates,
        });
      }
    } catch {
      // No flow defined - fall back to simple execution
      return this.executeWithoutFlow(context, queryFn, maxIterations);
    }

    // Execute each step in the flow
    while (!flowExecutor.isComplete() && iteration < maxIterations) {
      iteration++;

      const currentStepId = flowExecutor.getCurrentStepId();
      if (!currentStepId) break;

      stepsExecuted.push(currentStepId);

      // Build base variables
      const baseVariables = this.buildBaseVariables(context.args);

      // Build step-specific variables with context expansion
      const variables = flowExecutor.buildStepVariables(baseVariables);
      const expandedContext = flowExecutor.expandContext();

      // Get step definition to check for validation
      const stepDef = flowExecutor.getStep(currentStepId);
      const stepCheck = stepDef?.context?.check as
        | StepCheckDefinition
        | undefined;

      // Execute with validation if check is defined
      const validationResult = await this.executeStepWithValidation(
        {
          stepId: currentStepId,
          variables,
          expandedContext,
          check: stepCheck,
          iteration,
          sessionId,
        },
        context,
        queryFn,
      );

      summaries.push(validationResult.summary);
      sessionId = validationResult.sessionId;

      // Store step output in context
      this.stepContext.set(currentStepId, {
        iteration,
        responses: validationResult.summary.assistantResponses,
        tools: validationResult.summary.toolsUsed,
      });

      // Check completion after each step
      const checkContext: CheckContext = {
        iteration,
        stepContext: this.stepContext,
      };

      const completionResult = context.completionHandler.check(checkContext);

      if (completionResult.complete) {
        return {
          success: true,
          reason: completionResult.reason ??
            `Completed at step: ${currentStepId}`,
          iterations: iteration,
          summaries,
          finalStep: currentStepId,
          stepsExecuted,
        };
      }

      // Advance to next step
      flowExecutor.advanceStep();
    }

    // All steps completed or max iterations reached
    const allStepsComplete = flowExecutor.isComplete();
    return {
      success: allStepsComplete,
      reason: allStepsComplete
        ? "All flow steps completed"
        : `Max iterations (${maxIterations}) reached`,
      iterations: iteration,
      summaries,
      finalStep: stepsExecuted[stepsExecuted.length - 1],
      stepsExecuted,
    };
  }

  /**
   * Execute without flow (fallback for agents without flow definition).
   */
  private async executeWithoutFlow(
    context: FlowLoopContext,
    queryFn: (
      prompt: string,
      systemPrompt: string,
      sessionId?: string,
    ) => AsyncIterable<SdkMessage>,
    maxIterations: number,
  ): Promise<FlowLoopResult> {
    const summaries: IterationSummary[] = [];
    let sessionId: string | undefined;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      // Build prompts using "work" step as default
      const baseVariables = this.buildBaseVariables(context.args);
      const prompt = await context.buildStepPrompt("work", baseVariables, null);
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
          stepsExecuted: ["work"],
        };
      }
    }

    return {
      success: false,
      reason: `Max iterations (${maxIterations}) reached`,
      iterations: iteration,
      summaries,
      stepsExecuted: ["work"],
    };
  }

  /**
   * Execute a step with format validation and retry support.
   *
   * @param stepOptions - Step execution options
   * @param context - Flow loop context
   * @param queryFn - SDK query function
   * @returns Step validation result
   */
  private async executeStepWithValidation(
    stepOptions: {
      stepId: string;
      variables: Record<string, string>;
      expandedContext: ExpandedContext | null;
      check?: StepCheckDefinition;
      iteration: number;
      sessionId?: string;
    },
    context: FlowLoopContext,
    queryFn: (
      prompt: string,
      systemPrompt: string,
      sessionId?: string,
    ) => AsyncIterable<SdkMessage>,
  ): Promise<StepValidationResult> {
    const { stepId, variables, expandedContext, check, iteration } =
      stepOptions;
    let { sessionId } = stepOptions;
    let retryCount = 0;
    const maxRetries = check?.onFail?.maxRetries ?? 0;
    let lastError: string | undefined;

    while (true) {
      // Build prompt - use retry prompt if this is a retry
      let prompt: string;
      if (retryCount === 0) {
        prompt = await context.buildStepPrompt(
          stepId,
          variables,
          expandedContext,
        );
      } else {
        // Build retry prompt with error information
        prompt = await this.buildRetryPrompt(
          context,
          variables,
          lastError ?? "Format validation failed",
          check?.onFail?.retryPrompt,
        );
      }

      const systemPrompt = await context.buildSystemPrompt();

      // Execute iteration
      const result = await this.iterationExecutor.execute(
        { iteration, sessionId, prompt, systemPrompt },
        queryFn,
      );

      sessionId = result.sessionId;

      // If no check is defined, return immediately
      if (!check?.responseFormat) {
        return {
          success: true,
          summary: result.summary,
          sessionId,
          formatValid: true,
        };
      }

      // Validate the response format
      const validation = this.formatValidator.validate(
        result.summary,
        check.responseFormat,
      );

      if (validation.valid) {
        // Success: return with extracted data
        return {
          success: true,
          summary: result.summary,
          sessionId,
          formatValid: true,
          extractedData: validation.extracted,
        };
      }

      // Validation failed
      lastError = validation.error;

      // Check if we should retry
      if (check.onFail?.retry && retryCount < maxRetries) {
        retryCount++;
        continue; // Retry with new prompt
      }

      // No more retries - return with validation failure
      return {
        success: true, // Step executed, but format was invalid
        summary: result.summary,
        sessionId,
        formatValid: false,
        formatError: validation.error,
      };
    }
  }

  /**
   * Build retry prompt for format validation failure.
   *
   * @param context - Flow loop context
   * @param variables - Current variables
   * @param errorMessage - Validation error message
   * @param retryPromptConfig - Optional retry prompt configuration
   * @returns Retry prompt string
   */
  private async buildRetryPrompt(
    context: FlowLoopContext,
    variables: Record<string, string>,
    errorMessage: string,
    retryPromptConfig?: { c2: string; c3: string; edition: string },
  ): Promise<string> {
    // Add error message to variables
    const retryVariables = {
      ...variables,
      "uv-error_message": errorMessage,
    };

    // If retry prompt config is provided, try to resolve it
    if (retryPromptConfig) {
      const retryStepId = `${retryPromptConfig.c2}.${retryPromptConfig.c3}`;
      try {
        return await context.buildStepPrompt(retryStepId, retryVariables, null);
      } catch {
        // Fall through to default
      }
    }

    // Default retry prompt
    return this.buildDefaultRetryPrompt(errorMessage, variables);
  }

  /**
   * Build default retry prompt when no custom retry prompt is configured.
   */
  private buildDefaultRetryPrompt(
    errorMessage: string,
    variables: Record<string, string>,
  ): string {
    const issueNumber = variables["uv-issue_number"] ?? "UNKNOWN";

    return `# Format Error - Please Retry

Your previous response did not match the expected format.

## Error

${errorMessage}

## Expected Format

Please output in the following format:

\`\`\`issue-action
{
  "action": "close",
  "issue": ${issueNumber},
  "body": "## Resolution\\n\\n- Summary of changes\\n- Verification method\\n- Git status: clean"
}
\`\`\`

## Requirements

1. Use the \`issue-action\` code block format above
2. Include all required fields:
   - \`action\`: must be "close"
   - \`issue\`: must be the issue number (${issueNumber})
   - \`body\`: resolution summary

**Important**: Output ONLY the structured signal above. No additional explanation needed.
`;
  }

  /**
   * Build base UV variables from args.
   */
  private buildBaseVariables(
    args: Record<string, unknown>,
  ): Record<string, string> {
    const variables: Record<string, string> = {};

    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined && value !== null) {
        // Map common arg names to UV variables
        const uvKey = `uv-${key.replace(/([A-Z])/g, "_$1").toLowerCase()}`;
        variables[uvKey] = String(value);
      }
    }

    // Map specific common args
    if (args.issue !== undefined) {
      variables["uv-issue_number"] = String(args.issue);
    }
    if (args.project !== undefined) {
      variables["uv-project_number"] = String(args.project);
    }

    return variables;
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
}

/**
 * Create a step prompt builder that uses PromptResolver.
 *
 * Helper factory for creating the buildStepPrompt function.
 *
 * @param resolver - Prompt resolver instance
 * @returns Step prompt builder function
 */
export function createStepPromptBuilder(
  resolver: {
    resolve: (
      stepId: string,
      variables: Record<string, string>,
    ) => Promise<string>;
  },
): StepPromptBuilder {
  return async (
    stepId: string,
    variables: Record<string, string>,
    expandedContext: ExpandedContext | null,
  ): Promise<string> => {
    // Merge expanded context variables
    const mergedVariables = { ...variables };

    if (expandedContext?.validatorInstructions) {
      mergedVariables["uv-validator_instructions"] =
        expandedContext.validatorInstructions;
    }
    if (expandedContext?.format) {
      mergedVariables["uv-output_format"] = expandedContext.format;
    }
    if (expandedContext?.signalType) {
      mergedVariables["uv-signal_type"] = expandedContext.signalType;
    }

    // Resolve prompt using the step ID
    try {
      return await resolver.resolve(stepId, mergedVariables);
    } catch {
      // Fall back to generic prompt if step-specific not found
      return `Execute step: ${stepId}\n\nVariables: ${
        JSON.stringify(variables, null, 2)
      }`;
    }
  };
}
