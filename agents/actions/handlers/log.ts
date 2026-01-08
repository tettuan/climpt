/**
 * Log action handler - logs actions to console and log file
 */

import {
  type ActionContext,
  type ActionResult,
  BaseActionHandler,
  type DetectedAction,
} from "../types.ts";

export class LogActionHandler extends BaseActionHandler {
  constructor(type: string) {
    super(type);
  }

  execute(
    action: DetectedAction,
    context: ActionContext,
  ): Promise<ActionResult> {
    context.logger.info(`[Action: ${action.type}]`, {
      content: action.content,
      metadata: action.metadata,
      iteration: context.iteration,
    });

    return Promise.resolve(this.success(action, { logged: true }));
  }
}
