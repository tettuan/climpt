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

      // Build prompts
      const prompt = await context.buildStepPrompt(
        currentStepId,
        variables,
        expandedContext,
      );
      const systemPrompt = await context.buildSystemPrompt();

      // Execute iteration for this step
      const result = await this.iterationExecutor.execute(
        { iteration, sessionId, prompt, systemPrompt },
        queryFn,
      );

      summaries.push(result.summary);
      sessionId = result.sessionId;

      // Store step output in context
      this.stepContext.set(currentStepId, {
        iteration,
        responses: result.summary.assistantResponses,
        tools: result.summary.toolsUsed,
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
