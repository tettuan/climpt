/**
 * Completion Signal Handler
 *
 * Parses action content and returns a completion signal
 * for Runner to update CompletionHandler state.
 */

import type {
  ActionContext,
  ActionHandler,
  ActionResult,
  DetectedAction,
} from "../types.ts";

export class CompletionSignalHandler implements ActionHandler {
  readonly type: string;
  private signalType:
    | "project-plan"
    | "review-result"
    | "phase-advance"
    | "complete";

  constructor(
    signalType: "project-plan" | "review-result" | "phase-advance" | "complete",
  ) {
    this.type = signalType;
    this.signalType = signalType;
  }

  canHandle(action: DetectedAction): boolean {
    return action.type === this.type;
  }

  // Sync implementation returning Promise for interface compliance
  execute(
    action: DetectedAction,
    ctx: ActionContext,
  ): Promise<ActionResult> {
    try {
      // Parse the action content (already validated JSON from ActionDetector)
      const data = JSON.parse(action.raw);

      ctx.logger.info(`[CompletionSignal: ${this.signalType}]`, {
        hasData: !!data,
      });

      return Promise.resolve({
        action,
        success: true,
        completionSignal: {
          type: this.signalType,
          data,
        },
      });
    } catch (error) {
      ctx.logger.error(`[CompletionSignal: ${this.signalType}] Parse error`, {
        error: error instanceof Error ? error.message : String(error),
      });

      return Promise.resolve({
        action,
        success: false,
        error: `Failed to parse completion signal: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
}
