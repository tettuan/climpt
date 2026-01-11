/**
 * GitHub Issue action handler - creates GitHub Issues
 */

import {
  type ActionContext,
  type ActionResult,
  BaseActionHandler,
  type DetectedAction,
} from "../types.ts";

export class GitHubIssueHandler extends BaseActionHandler {
  constructor(type: string) {
    super(type);
  }

  async execute(
    action: DetectedAction,
    context: ActionContext,
  ): Promise<ActionResult> {
    const { content, metadata } = action;

    const title = (metadata.title as string) ?? content.substring(0, 50);
    const body = this.buildBody(action);
    const labels = (metadata.labels as string[]) ?? [];
    const assignees = metadata.assignee ? [metadata.assignee as string] : [];

    const args = [
      "issue",
      "create",
      "--title",
      title,
      "--body",
      body,
    ];

    if (labels.length > 0) {
      args.push("--label", labels.join(","));
    }
    if (assignees.length > 0) {
      args.push("--assignee", assignees.join(","));
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
        return this.failure(action, `Failed to create issue: ${stderr}`);
      }

      const output = new TextDecoder().decode(result.stdout);
      const issueUrl = output.trim();

      context.logger.info(`[Action: ${action.type}] Issue created`, {
        url: issueUrl,
      });

      return this.success(action, { issueUrl });
    } catch (error) {
      return this.failure(
        action,
        `Failed to create issue: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private buildBody(action: DetectedAction): string {
    const parts = [action.content];

    if (action.metadata.rationale) {
      parts.push(`\n## Rationale\n${action.metadata.rationale}`);
    }
    if (action.metadata.dueDate) {
      parts.push(`\n**Due Date:** ${action.metadata.dueDate}`);
    }
    if (action.metadata.priority) {
      parts.push(`\n**Priority:** ${action.metadata.priority}`);
    }

    return parts.join("\n");
  }
}

/**
 * GitHub Comment action handler - adds comments to Issues
 */
export class GitHubCommentHandler extends BaseActionHandler {
  constructor(type: string) {
    super(type);
  }

  async execute(
    action: DetectedAction,
    context: ActionContext,
  ): Promise<ActionResult> {
    const { content, metadata } = action;
    const issueNumber = metadata.issueNumber as number;

    if (!issueNumber) {
      return this.failure(action, "issueNumber is required for comment action");
    }

    const args = [
      "issue",
      "comment",
      String(issueNumber),
      "--body",
      content,
    ];

    try {
      const result = await new Deno.Command("gh", {
        args,
        stdout: "piped",
        stderr: "piped",
        cwd: context.cwd,
      }).output();

      if (!result.success) {
        const stderr = new TextDecoder().decode(result.stderr);
        return this.failure(action, `Failed to add comment: ${stderr}`);
      }

      context.logger.info(`[Action: ${action.type}] Comment added`, {
        issueNumber,
      });

      return this.success(action, { issueNumber, commented: true });
    } catch (error) {
      return this.failure(
        action,
        `Failed to add comment: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
