/**
 * Action executor - executes detected actions using registered handlers
 */

import type { Logger } from "../src_common/logger.ts";
import type {
  ActionConfig,
  ActionContext,
  ActionHandler,
  ActionResult,
  DetectedAction,
} from "./types.ts";
import type { PreCloseValidationConfig } from "../src_common/types.ts";
import { LogActionHandler } from "./handlers/log.ts";
import {
  GitHubCommentHandler,
  GitHubIssueHandler,
} from "./handlers/github-issue.ts";
import { FileActionHandler } from "./handlers/file.ts";
import { CompletionSignalHandler } from "./handlers/completion-signal.ts";
import { IssueActionHandler } from "./handlers/issue-action.ts";

/**
 * Agent behavior configuration for executor
 */
export interface AgentBehaviorConfig {
  preCloseValidation?: PreCloseValidationConfig;
}

export interface ExecutorOptions {
  agentName: string;
  logger: Logger;
  cwd: string;
  /** Agent behavior configuration (optional, for validation support) */
  agentBehavior?: AgentBehaviorConfig;
}

/**
 * Extended action context with agent configuration
 */
interface ExtendedActionContext extends ActionContext {
  agentConfig?: {
    behavior?: AgentBehaviorConfig;
  };
}

export class ActionExecutor {
  private handlers: Map<string, ActionHandler>;
  private context: ExtendedActionContext;

  constructor(config: ActionConfig, options: ExecutorOptions) {
    this.context = {
      agentName: options.agentName,
      iteration: 0,
      logger: options.logger,
      cwd: options.cwd,
      // Include agent config for validation support
      agentConfig: options.agentBehavior
        ? { behavior: options.agentBehavior }
        : undefined,
    };
    this.handlers = this.initializeHandlers(config);
  }

  private initializeHandlers(config: ActionConfig): Map<string, ActionHandler> {
    const handlers = new Map<string, ActionHandler>();

    // Register handlers from config
    for (const [type, handlerSpec] of Object.entries(config.handlers ?? {})) {
      handlers.set(type, this.createHandler(handlerSpec, type));
    }

    // Add default handlers for unspecified types
    for (const type of config.types) {
      if (!handlers.has(type)) {
        // Use IssueActionHandler for issue-action type by default
        if (type === "issue-action") {
          handlers.set(type, new IssueActionHandler());
        } else {
          handlers.set(type, new LogActionHandler(type));
        }
      }
    }

    return handlers;
  }

  private createHandler(spec: string, type: string): ActionHandler {
    if (spec.startsWith("builtin:")) {
      const builtin = spec.replace("builtin:", "");
      switch (builtin) {
        case "log":
          return new LogActionHandler(type);
        case "github-issue":
          return new GitHubIssueHandler(type);
        case "github-comment":
          return new GitHubCommentHandler(type);
        case "file":
          return new FileActionHandler(type);
        case "completion-signal":
          return new CompletionSignalHandler(
            type as "phase-advance" | "complete",
          );
        case "issue-action":
          return new IssueActionHandler();
        default:
          throw new Error(`Unknown builtin handler: ${builtin}`);
      }
    }

    // Custom handler path - would need dynamic import
    // For now, fall back to log handler
    this.context.logger.warn(
      `Custom handler not supported, using log handler for: ${spec}`,
    );
    return new LogActionHandler(type);
  }

  /**
   * Set the current iteration number
   */
  setIteration(iteration: number): void {
    this.context.iteration = iteration;
  }

  /**
   * Execute a list of detected actions
   */
  async execute(actions: DetectedAction[]): Promise<ActionResult[]> {
    const executeAction = async (
      action: DetectedAction,
    ): Promise<ActionResult> => {
      const handler = this.handlers.get(action.type);

      if (!handler) {
        return {
          action,
          success: false,
          error: `No handler for action type: ${action.type}`,
        };
      }

      try {
        const result = await handler.execute(action, this.context);

        this.context.logger.info(`[Action: ${action.type}]`, {
          success: result.success,
          content: action.content.substring(0, 100),
        });

        return result;
      } catch (error) {
        const result: ActionResult = {
          action,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };

        this.context.logger.error(`[Action: ${action.type}] Failed`, {
          error: error instanceof Error ? error.message : String(error),
        });

        return result;
      }
    };

    // Execute all actions in parallel using Promise.all
    return await Promise.all(actions.map(executeAction));
  }

  /**
   * Execute a single action
   */
  async executeOne(action: DetectedAction): Promise<ActionResult> {
    const results = await this.execute([action]);
    return results[0];
  }

  /**
   * Register a custom handler
   */
  registerHandler(type: string, handler: ActionHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Get a registered handler
   */
  getHandler(type: string): ActionHandler | undefined {
    return this.handlers.get(type);
  }

  /**
   * List registered handler types
   */
  listHandlerTypes(): string[] {
    return Array.from(this.handlers.keys());
  }
}
