/**
 * Issue Action Handler
 *
 * Handles issue-action structured outputs with pre-close validation support.
 * Actions: progress, close, question, blocked
 */

import {
  type ActionContext,
  type ActionResult,
  BaseActionHandler,
  type DetectedAction,
} from "../types.ts";
import type { PreCloseValidationConfig } from "../../validators/types.ts";
import { runValidators } from "../../validators/registry.ts";

/**
 * Extended action context with pre-close validation config
 */
export interface IssueActionContext extends ActionContext {
  /** Agent configuration including preCloseValidation */
  agentConfig?: {
    behavior?: {
      preCloseValidation?: PreCloseValidationConfig;
    };
  };
}

/**
 * Issue action data structure
 */
interface IssueActionData {
  action: "progress" | "close" | "question" | "blocked";
  issue: number;
  body?: string;
  label?: string;
}

/**
 * Issue Action Handler - processes issue-action structured outputs
 *
 * Supports pre-close validation when configured in agent.json:
 * - Validates before executing close action
 * - Blocks close if validation fails (when onFailure: "block")
 * - Returns error to agent so it can fix issues
 */
export class IssueActionHandler extends BaseActionHandler {
  constructor() {
    super("issue-action");
  }

  async execute(
    action: DetectedAction,
    context: IssueActionContext,
  ): Promise<ActionResult> {
    let data: IssueActionData;
    try {
      data = JSON.parse(action.raw);
    } catch {
      return this.failure(action, "Failed to parse issue-action JSON");
    }

    // Validate required fields
    if (!data.action || typeof data.issue !== "number") {
      return this.failure(
        action,
        "issue-action requires 'action' and 'issue' fields",
      );
    }

    switch (data.action) {
      case "close":
        return await this.handleClose(action, context, data);
      case "progress":
        return await this.handleProgress(action, context, data);
      case "question":
        return await this.handleQuestion(action, context, data);
      case "blocked":
        return await this.handleBlocked(action, context, data);
      default:
        return this.failure(
          action,
          `Unknown issue-action: ${(data as { action: string }).action}`,
        );
    }
  }

  /**
   * Handle close action with pre-close validation
   */
  private async handleClose(
    action: DetectedAction,
    context: IssueActionContext,
    data: IssueActionData,
  ): Promise<ActionResult> {
    const config = context.agentConfig?.behavior?.preCloseValidation;

    // Run pre-close validation if enabled
    if (config?.enabled && config.validators.length > 0) {
      context.logger.info("[IssueActionHandler] Running pre-close validation", {
        validators: config.validators,
      });

      const validationResult = await runValidators(config.validators, {
        agentId: context.agentName,
        workingDir: context.cwd,
        logger: context.logger,
        issueNumber: data.issue,
      });

      if (!validationResult.valid) {
        const errorMessage = this.buildValidationErrorMessage(validationResult);

        if (config.onFailure === "block") {
          context.logger.error(
            "[IssueActionHandler] Pre-close validation failed, blocking close",
            {
              errors: validationResult.errors,
              details: validationResult.details,
            },
          );

          return {
            action,
            success: false,
            error: errorMessage,
            result: {
              validationFailed: true,
              errors: validationResult.errors,
              details: validationResult.details,
            },
          };
        } else {
          // onFailure: "warn" - log warning but proceed
          context.logger.warn(
            "[IssueActionHandler] Pre-close validation warning",
            {
              errors: validationResult.errors,
            },
          );
        }
      } else {
        context.logger.info("[IssueActionHandler] Pre-close validation passed");
      }
    }

    // Execute the close action
    return await this.executeGhIssueClose(action, context, data);
  }

  /**
   * Execute gh issue close command
   */
  private async executeGhIssueClose(
    action: DetectedAction,
    context: ActionContext,
    data: IssueActionData,
  ): Promise<ActionResult> {
    const args = ["issue", "close", String(data.issue)];

    // Add comment body if provided
    if (data.body) {
      args.push("--comment", data.body);
    }

    try {
      const result = await new Deno.Command("gh", {
        args,
        stdout: "piped",
        stderr: "piped",
        cwd: context.cwd,
      }).output();

      if (!result.success) {
        const stderr = new TextDecoder().decode(result.stderr);
        return this.failure(action, `Failed to close issue: ${stderr}`);
      }

      context.logger.info(`[IssueActionHandler] Issue #${data.issue} closed`);

      return this.success(action, {
        action: "close",
        issue: data.issue,
        closed: true,
      });
    } catch (error) {
      return this.failure(
        action,
        `Failed to close issue: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Handle progress action - add comment to issue
   */
  private async handleProgress(
    action: DetectedAction,
    context: ActionContext,
    data: IssueActionData,
  ): Promise<ActionResult> {
    if (!data.body) {
      return this.failure(action, "progress action requires 'body' field");
    }

    const args = ["issue", "comment", String(data.issue), "--body", data.body];

    try {
      const result = await new Deno.Command("gh", {
        args,
        stdout: "piped",
        stderr: "piped",
        cwd: context.cwd,
      }).output();

      if (!result.success) {
        const stderr = new TextDecoder().decode(result.stderr);
        return this.failure(
          action,
          `Failed to add progress comment: ${stderr}`,
        );
      }

      context.logger.info(
        `[IssueActionHandler] Progress reported on issue #${data.issue}`,
      );

      return this.success(action, {
        action: "progress",
        issue: data.issue,
        commented: true,
      });
    } catch (error) {
      return this.failure(
        action,
        `Failed to add progress comment: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Handle question action - add question comment to issue
   */
  private async handleQuestion(
    action: DetectedAction,
    context: ActionContext,
    data: IssueActionData,
  ): Promise<ActionResult> {
    if (!data.body) {
      return this.failure(action, "question action requires 'body' field");
    }

    const args = ["issue", "comment", String(data.issue), "--body", data.body];

    try {
      const result = await new Deno.Command("gh", {
        args,
        stdout: "piped",
        stderr: "piped",
        cwd: context.cwd,
      }).output();

      if (!result.success) {
        const stderr = new TextDecoder().decode(result.stderr);
        return this.failure(
          action,
          `Failed to add question comment: ${stderr}`,
        );
      }

      context.logger.info(
        `[IssueActionHandler] Question posted on issue #${data.issue}`,
      );

      return this.success(action, {
        action: "question",
        issue: data.issue,
        commented: true,
      });
    } catch (error) {
      return this.failure(
        action,
        `Failed to add question comment: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Handle blocked action - add comment and optionally add label
   */
  private async handleBlocked(
    action: DetectedAction,
    context: ActionContext,
    data: IssueActionData,
  ): Promise<ActionResult> {
    if (!data.body) {
      return this.failure(action, "blocked action requires 'body' field");
    }

    // Add comment
    const commentArgs = [
      "issue",
      "comment",
      String(data.issue),
      "--body",
      data.body,
    ];

    try {
      const commentResult = await new Deno.Command("gh", {
        args: commentArgs,
        stdout: "piped",
        stderr: "piped",
        cwd: context.cwd,
      }).output();

      if (!commentResult.success) {
        const stderr = new TextDecoder().decode(commentResult.stderr);
        return this.failure(action, `Failed to add blocked comment: ${stderr}`);
      }

      // Add label if specified
      if (data.label) {
        const labelArgs = [
          "issue",
          "edit",
          String(data.issue),
          "--add-label",
          data.label,
        ];
        const labelResult = await new Deno.Command("gh", {
          args: labelArgs,
          stdout: "piped",
          stderr: "piped",
          cwd: context.cwd,
        }).output();

        if (!labelResult.success) {
          const stderr = new TextDecoder().decode(labelResult.stderr);
          context.logger.warn(
            `[IssueActionHandler] Failed to add label: ${stderr}`,
          );
        }
      }

      context.logger.info(
        `[IssueActionHandler] Blocker reported on issue #${data.issue}`,
      );

      return this.success(action, {
        action: "blocked",
        issue: data.issue,
        commented: true,
        label: data.label,
      });
    } catch (error) {
      return this.failure(
        action,
        `Failed to handle blocked action: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Build a human-readable error message from validation results
   */
  private buildValidationErrorMessage(result: {
    errors: string[];
    details: string[];
  }): string {
    const parts = [
      "Pre-close validation failed. Please fix the following issues before closing:",
      "",
      ...result.errors,
    ];

    if (result.details.length > 0) {
      parts.push("", "Details:");
      // Limit details to first 10 items to avoid overwhelming the agent
      const limitedDetails = result.details.slice(0, 10);
      parts.push(...limitedDetails.map((d) => `  ${d}`));
      if (result.details.length > 10) {
        parts.push(`  ... and ${result.details.length - 10} more`);
      }
    }

    return parts.join("\n");
  }
}
