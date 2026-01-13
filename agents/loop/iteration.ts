/**
 * Iteration - Single Iteration Execution
 *
 * @deprecated This module is not used. Iteration execution is handled
 * directly in AgentRunner (runner/runner.ts). Consider removing in future.
 *
 * Responsibility: Prompt resolution -> Query execution -> Response processing
 * Side effects: SDK calls, log output
 */

import type { IterationSummary } from "../src_common/types.ts";
import type { SdkMessage } from "../bridge/sdk-bridge.ts";
import {
  MessageProcessor,
  type ProcessedMessage,
} from "../bridge/message-processor.ts";

export interface IterationOptions {
  iteration: number;
  sessionId?: string;
  prompt: string;
  systemPrompt: string;
}

export interface IterationResult {
  summary: IterationSummary;
  sessionId?: string;
}

/**
 * Execute a single iteration of the agent loop.
 */
export class IterationExecutor {
  private readonly messageProcessor = new MessageProcessor();

  /**
   * Execute one iteration.
   */
  async execute(
    options: IterationOptions,
    queryFn: (
      prompt: string,
      systemPrompt: string,
      sessionId?: string,
    ) => AsyncIterable<SdkMessage>,
  ): Promise<IterationResult> {
    const summary: IterationSummary = {
      iteration: options.iteration,
      sessionId: options.sessionId,
      assistantResponses: [],
      toolsUsed: [],
      detectedActions: [],
      errors: [],
    };

    let resultSessionId: string | undefined = options.sessionId;

    for await (
      const message of queryFn(
        options.prompt,
        options.systemPrompt,
        options.sessionId,
      )
    ) {
      const processed = this.messageProcessor.process(message);
      this.updateSummary(summary, processed);

      if (processed.type === "result" && processed.sessionId) {
        resultSessionId = processed.sessionId;
        summary.sessionId = processed.sessionId;
      }
    }

    return {
      summary,
      sessionId: resultSessionId,
    };
  }

  private updateSummary(
    summary: IterationSummary,
    processed: ProcessedMessage,
  ): void {
    switch (processed.type) {
      case "assistant":
        if (processed.content) {
          summary.assistantResponses.push(processed.content);
        }
        break;
      case "tool_use":
        if (processed.toolName) {
          summary.toolsUsed.push(processed.toolName);
        }
        break;
      case "error":
        if (processed.error) {
          summary.errors.push(processed.error);
        }
        break;
    }
  }
}
