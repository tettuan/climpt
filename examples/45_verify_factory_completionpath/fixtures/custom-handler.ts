/**
 * Minimal custom verdict handler for factory path verification.
 *
 * Exports a default factory function as expected by loadCustomHandler
 * in agents/verdict/factory.ts.
 */

import type { AgentDefinition } from "../../../../agents/src_common/types.ts";
import type { VerdictHandler } from "../../../../agents/verdict/types.ts";
import type {
  IterationSummary,
  VerdictCriteria,
} from "../../../../agents/verdict/types.ts";

class TestCustomVerdictHandler implements VerdictHandler {
  readonly type = "meta:custom" as const;

  async buildInitialPrompt(): Promise<string> {
    return "Custom handler initial prompt";
  }

  async buildContinuationPrompt(
    _completedIterations: number,
    _previousSummary?: IterationSummary,
  ): Promise<string> {
    return "Custom handler continuation prompt";
  }

  buildVerdictCriteria(): VerdictCriteria {
    return {
      short: "Custom test handler",
      detailed: "Custom handler for factory path verification testing",
    };
  }

  async isFinished(): Promise<boolean> {
    return false;
  }

  async getVerdictDescription(): Promise<string> {
    return "Custom handler - not finished";
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
