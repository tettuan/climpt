/**
 * Minimal custom verdict handler for factory path verification.
 *
 * Exports a default factory function as expected by loadCustomHandler
 * in agents/verdict/factory.ts.
 */

import type { AgentDefinition } from "../../../agents/src_common/types.ts";
import type { VerdictHandler } from "../../../agents/verdict/types.ts";
import type {
  IterationSummary,
  VerdictCriteria,
} from "../../../agents/verdict/types.ts";

const NOT_FINISHED = false;

class TestCustomVerdictHandler implements VerdictHandler {
  readonly type = "meta:custom" as const;

  buildInitialPrompt(): Promise<string> {
    return Promise.resolve("Custom handler initial prompt");
  }

  buildContinuationPrompt(
    _completedIterations: number,
    _previousSummary?: IterationSummary,
  ): Promise<string> {
    return Promise.resolve("Custom handler continuation prompt");
  }

  buildVerdictCriteria(): VerdictCriteria {
    return {
      short: "Custom test handler",
      detailed: "Custom handler for factory path verification testing",
    };
  }

  isFinished(): Promise<boolean> {
    return Promise.resolve(NOT_FINISHED);
  }

  getVerdictDescription(): Promise<string> {
    return Promise.resolve("Custom handler - not finished");
  }

  getLastVerdict(): string | undefined {
    return undefined;
  }
}

/**
 * Factory function - default export as required by loadCustomHandler.
 */
export default function createHandler(
  _definition: AgentDefinition,
  _args: Record<string, unknown>,
): VerdictHandler {
  return new TestCustomVerdictHandler();
}
