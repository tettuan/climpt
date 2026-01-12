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
 * Validation results reported by the agent
 */
interface ValidationReport {
  git_clean: boolean;
  type_check_passed: boolean;
  tests_passed?: boolean;
  lint_passed?: boolean;
  format_check_passed?: boolean;
}

/**
 * Evidence of validation (command outputs)
 */
interface ValidationEvidence {
  git_status_output?: string;
  type_check_output?: string;
  test_summary?: string;
  lint_output?: string;
  format_output?: string;
}

/**
 * Issue action data structure
 */
interface IssueActionData {
  action: "progress" | "close" | "question" | "blocked";
  issue: number;
  body?: string;
  label?: string;
  /** Self-reported validation results (required for close action) */
  validation?: ValidationReport;
  /** Evidence supporting validation claims */
  evidence?: ValidationEvidence;
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
   * Handle close action with structured validation
   */
  private async handleClose(
    action: DetectedAction,
    context: IssueActionContext,
    data: IssueActionData,
  ): Promise<ActionResult> {
    // 1. Check self-reported validation (required for close)
    const selfValidationResult = this.validateSelfReport(data, context);
    if (!selfValidationResult.valid) {
      context.logger.warn(
        "[IssueActionHandler] Self-reported validation failed or missing",
        { errors: selfValidationResult.errors },
      );
      return {
        action,
        success: false,
        error: selfValidationResult.message,
        result: {
          validationFailed: true,
          requiresRetry: true,
          errors: selfValidationResult.errors,
        },
      };
    }

    // 2. Verify evidence matches claims (detect dishonest reports)
    const evidenceResult = this.verifyEvidence(data, context);
    if (!evidenceResult.valid) {
      context.logger.warn(
        "[IssueActionHandler] Evidence verification failed",
        { errors: evidenceResult.errors },
      );
      return {
        action,
        success: false,
        error: evidenceResult.message,
        result: {
          validationFailed: true,
          requiresRetry: true,
          errors: evidenceResult.errors,
        },
      };
    }

    // 3. Run system-side pre-close validation if enabled (double-check)
    const config = context.agentConfig?.behavior?.preCloseValidation;
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

    context.logger.info("[IssueActionHandler] All validations passed");

    // Execute the close action
    return await this.executeGhIssueClose(action, context, data);
  }

  /**
   * Validate self-reported validation results
   */
  private validateSelfReport(
    data: IssueActionData,
    context: IssueActionContext,
  ): { valid: boolean; message: string; errors: string[] } {
    const errors: string[] = [];

    // Check if validation field is present
    if (!data.validation) {
      return {
        valid: false,
        message:
          "Close action requires validation results. Please run validation checks and include the results.",
        errors: ["Missing 'validation' field in close action"],
      };
    }

    const v = data.validation;

    // Check required fields
    if (typeof v.git_clean !== "boolean") {
      errors.push("Missing git_clean validation result");
    } else if (!v.git_clean) {
      errors.push(
        "git_clean is false - please commit or stash changes before closing",
      );
    }

    if (typeof v.type_check_passed !== "boolean") {
      errors.push("Missing type_check_passed validation result");
    } else if (!v.type_check_passed) {
      errors.push("type_check_passed is false - please fix type errors");
    }

    // Optional but if reported as false, block
    if (v.tests_passed === false) {
      errors.push("tests_passed is false - please fix failing tests");
    }
    if (v.lint_passed === false) {
      errors.push("lint_passed is false - please fix lint errors");
    }
    if (v.format_check_passed === false) {
      errors.push("format_check_passed is false - please run formatter");
    }

    if (errors.length > 0) {
      context.logger.debug(
        "[IssueActionHandler] Self-report validation errors",
        {
          errors,
        },
      );
      return {
        valid: false,
        message: `Validation failed:\n${
          errors.map((e) => `- ${e}`).join("\n")
        }`,
        errors,
      };
    }

    return { valid: true, message: "", errors: [] };
  }

  /**
   * Verify evidence matches validation claims
   */
  private verifyEvidence(
    data: IssueActionData,
    context: IssueActionContext,
  ): { valid: boolean; message: string; errors: string[] } {
    const errors: string[] = [];
    const evidence = data.evidence;

    // If no evidence provided, skip verification (trust self-report)
    if (!evidence) {
      context.logger.debug(
        "[IssueActionHandler] No evidence provided, trusting self-report",
      );
      return { valid: true, message: "", errors: [] };
    }

    // Verify git_clean claim
    if (data.validation?.git_clean && evidence.git_status_output) {
      const output = evidence.git_status_output.trim();
      if (output.length > 0) {
        errors.push(
          `Evidence contradicts git_clean=true: git status shows changes:\n${output}`,
        );
      }
    }

    // Verify type_check_passed claim
    if (data.validation?.type_check_passed && evidence.type_check_output) {
      const output = evidence.type_check_output.toLowerCase();
      if (output.includes("error") && !output.includes("0 error")) {
        errors.push(
          `Evidence contradicts type_check_passed=true: output contains errors`,
        );
      }
    }

    // Verify tests_passed claim
    if (data.validation?.tests_passed && evidence.test_summary) {
      const summary = evidence.test_summary.toLowerCase();
      if (
        summary.includes("failed") &&
        !summary.includes("0 failed") &&
        !summary.includes("0 failures")
      ) {
        errors.push(
          `Evidence contradicts tests_passed=true: test summary shows failures`,
        );
      }
    }

    if (errors.length > 0) {
      context.logger.warn("[IssueActionHandler] Evidence verification failed", {
        errors,
      });
      return {
        valid: false,
        message: `Evidence verification failed:\n${
          errors.map((e) => `- ${e}`).join("\n")
        }`,
        errors,
      };
    }

    return { valid: true, message: "", errors: [] };
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
