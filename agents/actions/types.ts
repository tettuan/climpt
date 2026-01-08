/**
 * Action system types and interfaces
 */

import type { Logger } from "../src_common/logger.ts";
import type {
  ActionConfig,
  ActionResult,
  DetectedAction,
} from "../src_common/types.ts";

// Re-export from common types
export type { ActionConfig, ActionResult, DetectedAction };

/**
 * Context passed to action handlers during execution
 */
export interface ActionContext {
  agentName: string;
  iteration: number;
  logger: Logger;
  cwd: string;
  github?: GitHubContext;
}

/**
 * GitHub-specific context
 */
export interface GitHubContext {
  owner?: string;
  repo?: string;
  token?: string;
}

/**
 * Interface for action handlers
 */
export interface ActionHandler {
  /** The action type this handler processes */
  readonly type: string;

  /** Check if this handler can process the action */
  canHandle(action: DetectedAction): boolean;

  /** Execute the action and return result */
  execute(
    action: DetectedAction,
    context: ActionContext,
  ): Promise<ActionResult>;
}

/**
 * Base class with common utilities for action handlers
 */
export abstract class BaseActionHandler implements ActionHandler {
  readonly type: string;

  constructor(type: string) {
    this.type = type;
  }

  canHandle(action: DetectedAction): boolean {
    return action.type === this.type;
  }

  abstract execute(
    action: DetectedAction,
    context: ActionContext,
  ): Promise<ActionResult>;

  /**
   * Create a success result
   */
  protected success(
    action: DetectedAction,
    result?: unknown,
  ): ActionResult {
    return {
      action,
      success: true,
      result,
    };
  }

  /**
   * Create a failure result
   */
  protected failure(action: DetectedAction, error: string): ActionResult {
    return {
      action,
      success: false,
      error,
    };
  }
}
