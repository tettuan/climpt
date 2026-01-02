/**
 * Iterate Agent - GitHub Integration
 *
 * Fetches requirements and checks completion status using gh CLI.
 */

import type { GitHubIssue, GitHubProject } from "./types.ts";

/**
 * Sanitize error message to remove sensitive information
 *
 * Removes API keys, tokens, and other sensitive patterns from error messages.
 *
 * @param message - Error message to sanitize
 * @returns Sanitized error message
 */
function sanitizeErrorMessage(message: string): string {
  // Pattern for GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_ prefixes)
  const githubTokenPattern = /gh[pousr]_[A-Za-z0-9_]{36,}/g;

  // Pattern for generic API keys/tokens (long alphanumeric strings)
  const genericTokenPattern =
    /\b[A-Za-z0-9_-]{40,}\b(?=.*(?:token|key|secret|auth))?/gi;

  // Pattern for Bearer tokens
  const bearerPattern = /Bearer\s+[A-Za-z0-9_.-]+/gi;

  // Pattern for Authorization headers
  const authHeaderPattern = /Authorization:\s*[^\s]+/gi;

  return message
    .replace(githubTokenPattern, "[REDACTED_TOKEN]")
    .replace(bearerPattern, "Bearer [REDACTED]")
    .replace(authHeaderPattern, "Authorization: [REDACTED]")
    .replace(genericTokenPattern, (match) => {
      // Only redact if it looks like a token (40+ chars, mixed case/numbers)
      if (match.length >= 40 && /[A-Z]/.test(match) && /[0-9]/.test(match)) {
        return "[REDACTED_TOKEN]";
      }
      return match;
    });
}

/**
 * Owner information with login and type
 */
interface OwnerInfo {
  login: string;
  type: "User" | "Organization";
}

/**
 * Get the owner of the current repository with type information
 *
 * @returns Repository owner info (login and type)
 * @throws Error if gh command fails or not in a git repository
 */
async function getRepoOwnerInfo(): Promise<OwnerInfo> {
  const command = new Deno.Command("gh", {
    args: ["repo", "view", "--json", "owner", "-q", ".owner.login,.owner.type"],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(
      `Failed to get repo owner: ${sanitizeErrorMessage(errorText)}`,
    );
  }

  const output = new TextDecoder().decode(stdout).trim();
  const lines = output.split("\n");

  return {
    login: lines[0] || "",
    type: (lines[1] as "User" | "Organization") || "User",
  };
}

/**
 * Get the project owner for gh project commands
 *
 * For user-owned repos, uses "@me" for project access.
 * For organization-owned repos, uses the org name.
 *
 * @returns Owner string suitable for gh project commands
 */
async function getProjectOwner(): Promise<string> {
  const ownerInfo = await getRepoOwnerInfo();

  // For user-owned repos, use @me for project access
  // This ensures we access the user's personal projects
  if (ownerInfo.type === "User") {
    return "@me";
  }

  // For organization-owned repos, use the org name
  return ownerInfo.login;
}

/**
 * Fetch GitHub Issue requirements
 *
 * @param issueNumber - Issue number
 * @param repository - Optional repository in "owner/repo" format (for cross-repo projects)
 * @returns Formatted requirement text
 * @throws Error if gh command fails
 */
export async function fetchIssueRequirements(
  issueNumber: number,
  repository?: string,
): Promise<string> {
  const args = [
    "issue",
    "view",
    issueNumber.toString(),
    "--json",
    "number,title,body,labels,state,comments",
  ];

  // Add -R option for cross-repo access
  if (repository) {
    args.push("-R", repository);
  }

  const command = new Deno.Command("gh", {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(`gh issue view failed: ${sanitizeErrorMessage(errorText)}`);
  }

  const issue = JSON.parse(new TextDecoder().decode(stdout)) as GitHubIssue;

  const labels = issue.labels?.map((l) => l.name).join(", ") || "(None)";
  const commentCount = issue.comments?.length || 0;

  return `
# Issue #${issue.number}: ${issue.title}

## Description
${issue.body || "(No description)"}

## Labels
${labels}

## Current State
State: ${issue.state}
Comments: ${commentCount}
  `.trim();
}

/**
 * Fetch GitHub Project requirements
 *
 * @param projectNumber - Project number
 * @returns Formatted requirement text
 * @throws Error if gh command fails
 */
export async function fetchProjectRequirements(
  projectNumber: number,
): Promise<string> {
  const owner = await getProjectOwner();
  const command = new Deno.Command("gh", {
    args: [
      "project",
      "view",
      projectNumber.toString(),
      "--owner",
      owner,
      "--format",
      "json",
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(
      `gh project view failed: ${sanitizeErrorMessage(errorText)}`,
    );
  }

  const rawProject = JSON.parse(new TextDecoder().decode(stdout));

  // Handle case where items might not be an array
  // gh project view --format json can return items as null, undefined, or non-array
  const rawItems = rawProject.items;
  const items: GitHubProject["items"] = Array.isArray(rawItems) ? rawItems : [];

  const project: GitHubProject = {
    number: rawProject.number ?? projectNumber,
    title: rawProject.title ?? "Untitled",
    description: rawProject.shortDescription ?? rawProject.description ?? null,
    items,
  };

  const itemsList = items
    .map(
      (item) =>
        `- [${item.status || "No status"}] #${item.content?.number || "N/A"}: ${
          item.content?.title || "Untitled"
        }`,
    )
    .join("\n");

  return `
# Project #${projectNumber}: ${project.title || "Untitled"}

## Description
${project.description || "(No description)"}

## Items
${itemsList || "(No items)"}

## Status
Total items: ${items.length}
  `.trim();
}

/**
 * Check if Issue is complete (closed)
 *
 * @param issueNumber - Issue number
 * @param repository - Optional repository in "owner/repo" format (for cross-repo projects)
 * @returns true if issue is closed
 * @throws Error if gh command fails
 */
export async function isIssueComplete(
  issueNumber: number,
  repository?: string,
): Promise<boolean> {
  const args = [
    "issue",
    "view",
    issueNumber.toString(),
    "--json",
    "state",
  ];

  // Add -R option for cross-repo access
  if (repository) {
    args.push("-R", repository);
  }

  const command = new Deno.Command("gh", {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(`gh issue view failed: ${sanitizeErrorMessage(errorText)}`);
  }

  const issue = JSON.parse(new TextDecoder().decode(stdout)) as Pick<
    GitHubIssue,
    "state"
  >;
  return issue.state === "CLOSED";
}

/**
 * Project item info with issue number and state
 */
export interface ProjectIssueInfo {
  issueNumber: number;
  title: string;
  state: "OPEN" | "CLOSED";
  status?: string;
  labels?: string[];
  /** Repository in "owner/repo" format (for cross-repo projects) */
  repository?: string;
}

/**
 * Get labels for a GitHub issue
 *
 * @param issueNumber - Issue number
 * @returns Array of label names
 * @throws Error if gh command fails
 */
async function getIssueLabels(issueNumber: number): Promise<string[]> {
  const command = new Deno.Command("gh", {
    args: [
      "issue",
      "view",
      issueNumber.toString(),
      "--json",
      "labels",
      "-q",
      ".labels[].name",
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(`gh issue view failed: ${sanitizeErrorMessage(errorText)}`);
  }

  const output = new TextDecoder().decode(stdout).trim();
  if (!output) {
    return [];
  }
  return output.split("\n").filter((label) => label.length > 0);
}

/**
 * Options for fetching issues from a GitHub Project
 */
export interface GetProjectIssuesOptions {
  /** Label to filter issues by */
  labelFilter?: string;
  /** Include items with "Done" status on project board (default: false) */
  includeCompleted?: boolean;
}

/**
 * Fetch issues from a GitHub Project
 *
 * Uses `gh project item-list` to get project items (not `gh project view`
 * which only returns metadata without items).
 *
 * By default, returns items that are NOT marked as "Done" on the project board.
 * Set `includeCompleted: true` to include all items regardless of status.
 * Optionally filters by label.
 *
 * @param projectNumber - Project number
 * @param options - Options for filtering (label, include completed)
 * @returns Array of issue info objects
 * @throws Error if gh command fails
 */
export async function getProjectIssues(
  projectNumber: number,
  options?: GetProjectIssuesOptions,
): Promise<ProjectIssueInfo[]> {
  const owner = await getProjectOwner();
  const command = new Deno.Command("gh", {
    args: [
      "project",
      "item-list",
      projectNumber.toString(),
      "--owner",
      owner,
      "--format",
      "json",
      "--limit",
      "100",
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(
      `gh project item-list failed: ${sanitizeErrorMessage(errorText)}`,
    );
  }

  const rawOutput = JSON.parse(new TextDecoder().decode(stdout));

  // gh project item-list returns { items: [...], totalCount: N }
  const rawItems = rawOutput.items;
  const items = Array.isArray(rawItems) ? rawItems : [];

  // gh project item-list output format:
  // {
  //   "content": { "number": 1, "title": "...", "type": "Issue", "state": "OPEN" },
  //   "status": "Todo",  // Project board status (Todo, In Progress, Done, etc.)
  //   "labels": ["docs", "feature"],  // Labels already included
  //   ...
  // }

  const includeCompleted = options?.includeCompleted ?? false;
  const labelFilter = options?.labelFilter;

  // Filter items based on project board status and content
  const candidates: ProjectIssueInfo[] = [];
  for (const item of items) {
    // Skip if no issue content
    if (!item.content?.number) {
      continue;
    }

    // Skip Done items unless includeCompleted is true
    if (!includeCompleted && item.status === "Done") {
      continue;
    }

    // Skip if not an Issue (could be a Draft or Pull Request)
    if (item.content?.type && item.content.type !== "Issue") {
      continue;
    }

    // Get labels from item (already included in item-list output)
    const itemLabels: string[] = Array.isArray(item.labels) ? item.labels : [];

    // Extract repository from content.repository (format: "owner/repo")
    const repository = item.content.repository as string | undefined;

    // Determine issue state from content if available, otherwise infer from project status
    const issueState: "OPEN" | "CLOSED" =
      item.content.state === "CLOSED" ? "CLOSED" : "OPEN";

    candidates.push({
      issueNumber: item.content.number,
      title: item.content.title || item.title || "Untitled",
      state: issueState,
      status: item.status,
      labels: itemLabels,
      repository,
    });
  }

  // If no label filter, return all candidates
  if (!labelFilter) {
    return candidates;
  }

  // Filter by label (labels already available, no API call needed)
  return candidates.filter((c) => c.labels?.includes(labelFilter));
}

/**
 * Check if Project is complete (all items done)
 *
 * @param projectNumber - Project number
 * @param labelFilter - Optional label to filter issues by
 * @returns true if all project items are complete
 * @throws Error if gh command fails
 */
export async function isProjectComplete(
  projectNumber: number,
  labelFilter?: string,
): Promise<boolean> {
  const openIssues = await getProjectIssues(projectNumber, {
    labelFilter,
    includeCompleted: false,
  });
  return openIssues.length === 0;
}

/**
 * Close an issue with a completion comment
 *
 * @param issueNumber - Issue number to close
 * @param comment - Comment to add before closing
 * @param repository - Optional repository in "owner/repo" format (for cross-repo projects)
 * @throws Error if gh command fails
 */
export async function closeIssueWithComment(
  issueNumber: number,
  comment: string,
  repository?: string,
): Promise<void> {
  // Build comment command args
  const commentArgs = [
    "issue",
    "comment",
    issueNumber.toString(),
    "--body",
    comment,
  ];
  if (repository) {
    commentArgs.push("-R", repository);
  }

  // Add comment
  const commentCommand = new Deno.Command("gh", {
    args: commentArgs,
    stdout: "piped",
    stderr: "piped",
  });

  const commentResult = await commentCommand.output();
  if (commentResult.code !== 0) {
    const errorText = new TextDecoder().decode(commentResult.stderr);
    throw new Error(
      `gh issue comment failed: ${sanitizeErrorMessage(errorText)}`,
    );
  }

  // Build close command args
  const closeArgs = [
    "issue",
    "close",
    issueNumber.toString(),
  ];
  if (repository) {
    closeArgs.push("-R", repository);
  }

  // Close issue
  const closeCommand = new Deno.Command("gh", {
    args: closeArgs,
    stdout: "piped",
    stderr: "piped",
  });

  const closeResult = await closeCommand.output();
  if (closeResult.code !== 0) {
    const errorText = new TextDecoder().decode(closeResult.stderr);
    throw new Error(
      `gh issue close failed: ${sanitizeErrorMessage(errorText)}`,
    );
  }
}

/**
 * Add a comment to an issue
 *
 * @param issueNumber - Issue number to comment on
 * @param comment - Comment body
 * @param repository - Optional repository (owner/repo format) for cross-repo
 * @throws Error if gh command fails
 */
export async function addIssueComment(
  issueNumber: number,
  comment: string,
  repository?: string,
): Promise<void> {
  const args = [
    "issue",
    "comment",
    issueNumber.toString(),
    "--body",
    comment,
  ];
  if (repository) {
    args.push("-R", repository);
  }

  const command = new Deno.Command("gh", {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const result = await command.output();
  if (result.code !== 0) {
    const errorText = new TextDecoder().decode(result.stderr);
    throw new Error(
      `gh issue comment failed: ${sanitizeErrorMessage(errorText)}`,
    );
  }
}

/**
 * Add a label to an issue
 *
 * @param issueNumber - Issue number to label
 * @param label - Label name to add
 * @param repository - Optional repository (owner/repo format) for cross-repo
 * @throws Error if gh command fails
 */
export async function addLabelToIssue(
  issueNumber: number,
  label: string,
  repository?: string,
): Promise<void> {
  const args = [
    "issue",
    "edit",
    issueNumber.toString(),
    "--add-label",
    label,
  ];
  if (repository) {
    args.push("-R", repository);
  }

  const command = new Deno.Command("gh", {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const result = await command.output();
  if (result.code !== 0) {
    const errorText = new TextDecoder().decode(result.stderr);
    throw new Error(
      `gh issue edit (add label) failed: ${sanitizeErrorMessage(errorText)}`,
    );
  }
}

/**
 * Issue action execution result
 */
export interface IssueActionResult {
  /** Whether the action was executed successfully */
  success: boolean;

  /** Action type that was executed */
  action: string;

  /** Issue number */
  issue: number;

  /** Error message if failed */
  error?: string;

  /** Whether this action should stop iteration (close, blocked) */
  shouldStop: boolean;

  /** Whether the issue was closed */
  isClosed: boolean;
}

/**
 * Execute an issue action
 *
 * Dispatches to the appropriate gh command based on action type.
 *
 * @param action - Issue action to execute
 * @param repository - Optional repository for cross-repo operations
 * @returns Execution result
 */
export async function executeIssueAction(
  action: { action: string; issue: number; body: string; label?: string },
  repository?: string,
): Promise<IssueActionResult> {
  const baseResult = {
    action: action.action,
    issue: action.issue,
    shouldStop: false,
    isClosed: false,
  };

  try {
    switch (action.action) {
      case "progress": {
        // Add progress comment with header
        const comment = `## Progress Update\n\n${action.body}\n\n---\n*Posted by iterate-agent*`;
        await addIssueComment(action.issue, comment, repository);
        return { ...baseResult, success: true };
      }

      case "question": {
        // Add question comment with header
        const comment = `## Question\n\n${action.body}\n\n---\n*Posted by iterate-agent*`;
        await addIssueComment(action.issue, comment, repository);
        return { ...baseResult, success: true };
      }

      case "blocked": {
        // Add blocked comment with header
        const comment = `## Blocked\n\n${action.body}\n\n---\n*Posted by iterate-agent - awaiting human intervention*`;
        await addIssueComment(action.issue, comment, repository);

        // Add label if specified
        if (action.label) {
          try {
            await addLabelToIssue(action.issue, action.label, repository);
          } catch (labelError) {
            // Log but don't fail - label might not exist
            console.warn(
              `Warning: Could not add label "${action.label}": ${labelError}`,
            );
          }
        }

        return { ...baseResult, success: true, shouldStop: true };
      }

      case "close": {
        // Close issue with completion comment
        const comment = `## Issue Completed\n\n${action.body}\n\n---\n*Closed by iterate-agent*`;
        await closeIssueWithComment(action.issue, comment, repository);
        return { ...baseResult, success: true, shouldStop: true, isClosed: true };
      }

      default:
        return {
          ...baseResult,
          success: false,
          error: `Unknown action type: ${action.action}`,
        };
    }
  } catch (error) {
    return {
      ...baseResult,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
