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
 * @returns Formatted requirement text
 * @throws Error if gh command fails
 */
export async function fetchIssueRequirements(
  issueNumber: number,
): Promise<string> {
  const command = new Deno.Command("gh", {
    args: [
      "issue",
      "view",
      issueNumber.toString(),
      "--json",
      "number,title,body,labels,state,comments",
    ],
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
 * @returns true if issue is closed
 * @throws Error if gh command fails
 */
export async function isIssueComplete(issueNumber: number): Promise<boolean> {
  const command = new Deno.Command("gh", {
    args: [
      "issue",
      "view",
      issueNumber.toString(),
      "--json",
      "state",
    ],
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
 * Fetch open issues from a GitHub Project
 *
 * Uses `gh project item-list` to get project items (not `gh project view`
 * which only returns metadata without items).
 *
 * Returns all project items that have an associated issue and are OPEN.
 * Optionally filters by label.
 *
 * @param projectNumber - Project number
 * @param labelFilter - Optional label to filter issues by
 * @returns Array of open issue info objects
 * @throws Error if gh command fails
 */
export async function getOpenIssuesFromProject(
  projectNumber: number,
  labelFilter?: string,
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
  //   "content": { "number": 1, "title": "...", "type": "Issue" },
  //   "status": "Todo",  // Project board status
  //   "labels": ["docs", "feature"],  // Labels already included
  //   ...
  // }

  // Filter to items that are not Done on the project board
  const candidates: ProjectIssueInfo[] = [];
  for (const item of items) {
    // Skip if no issue content or if marked as Done on project board
    if (!item.content?.number || item.status === "Done") {
      continue;
    }

    // Skip if not an Issue (could be a Draft or Pull Request)
    if (item.content?.type && item.content.type !== "Issue") {
      continue;
    }

    // Get labels from item (already included in item-list output)
    const itemLabels: string[] = Array.isArray(item.labels) ? item.labels : [];

    candidates.push({
      issueNumber: item.content.number,
      title: item.content.title || item.title || "Untitled",
      state: "OPEN", // Assume open since not Done on board
      status: item.status,
      labels: itemLabels,
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
  const openIssues = await getOpenIssuesFromProject(projectNumber, labelFilter);
  return openIssues.length === 0;
}

/**
 * Close an issue with a completion comment
 *
 * @param issueNumber - Issue number to close
 * @param comment - Comment to add before closing
 * @throws Error if gh command fails
 */
export async function closeIssueWithComment(
  issueNumber: number,
  comment: string,
): Promise<void> {
  // Add comment
  const commentCommand = new Deno.Command("gh", {
    args: [
      "issue",
      "comment",
      issueNumber.toString(),
      "--body",
      comment,
    ],
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

  // Close issue
  const closeCommand = new Deno.Command("gh", {
    args: [
      "issue",
      "close",
      issueNumber.toString(),
    ],
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
