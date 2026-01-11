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
 * Main agent loop execution.
 */
export class AgentLoop {
  private readonly iterationExecutor = new IterationExecutor();
  private readonly stepContext = new StepContextImpl();

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
}
