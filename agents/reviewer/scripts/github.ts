/**
 * Review Agent - GitHub Integration
 *
 * Handles GitHub API interactions for fetching issues and creating gap issues.
 * Uses gh CLI for all GitHub operations.
 */

import type { GitHubIssue, ReviewAction, TraceabilityId } from "./types.ts";

/**
 * Project issue item from gh project item-list
 *
 * Note: labels are at the item level as string[], not under content
 */
export interface ProjectItem {
  content?: {
    number?: number;
    title?: string;
    state?: "OPEN" | "CLOSED";
    body?: string;
    repository?: string;
  };
  /** Labels as string array at item level */
  labels?: string[];
  status?: string;
}

/**
 * Sanitize error messages to remove sensitive information
 */
function sanitizeError(error: Error): string {
  let message = error.message;

  // Remove potential tokens from error messages
  message = message.replace(/ghp_[a-zA-Z0-9]+/g, "[REDACTED]");
  message = message.replace(/gho_[a-zA-Z0-9]+/g, "[REDACTED]");
  message = message.replace(/github_pat_[a-zA-Z0-9_]+/g, "[REDACTED]");

  return message;
}

/**
 * Execute gh CLI command and return output
 *
 * @param args - Command arguments
 * @returns Command output as string
 * @throws Error if command fails
 */
async function execGhCommand(args: string[]): Promise<string> {
  const command = new Deno.Command("gh", {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorOutput = new TextDecoder().decode(stderr);
    throw new Error(
      `gh command failed: ${sanitizeError(new Error(errorOutput))}`,
    );
  }

  return new TextDecoder().decode(stdout);
}

/**
 * Fetch issue from GitHub repository
 *
 * @param repo - Repository in "owner/repo" format
 * @param issueNumber - Issue number
 * @returns Issue data
 */
export async function fetchIssue(
  repo: string,
  issueNumber: number,
): Promise<GitHubIssue> {
  const output = await execGhCommand([
    "issue",
    "view",
    String(issueNumber),
    "-R",
    repo,
    "--json",
    "number,title,body,state,labels,comments",
  ]);

  const issue = JSON.parse(output) as GitHubIssue;
  return issue;
}

/**
 * Parse traceability IDs from issue body
 *
 * Traceability ID format: req:<category>:<name>#<date>
 * Example: req:stock:data-mgmt-abc123#20251229
 *
 * @param body - Issue body text
 * @returns Array of parsed traceability IDs
 */
export function parseTraceabilityIds(body: string | null): TraceabilityId[] {
  if (!body) return [];

  const ids: TraceabilityId[] = [];

  // Match pattern: req:<category>:<name>#<date> or req:<category>:<name>
  const regex = /req:([a-z0-9-]+):([a-z0-9-]+)(?:#(\d{8}))?/gi;

  let match;
  while ((match = regex.exec(body)) !== null) {
    ids.push({
      fullId: match[0],
      category: match[1],
      name: match[2],
      date: match[3],
    });
  }

  return ids;
}

/**
 * Fetch requirement document from docs repository
 *
 * @param project - Project name
 * @param traceabilityId - Traceability ID to look up
 * @returns Requirement document content or null if not found
 */
export async function fetchRequirementDoc(
  project: string,
  traceabilityId: TraceabilityId,
): Promise<string | null> {
  const docsRepo = `tettuan/${project}-docs`;
  const docPath =
    `requirements/${traceabilityId.category}/${traceabilityId.name}.md`;

  try {
    const output = await execGhCommand([
      "api",
      `repos/${docsRepo}/contents/${docPath}`,
      "--jq",
      ".content",
    ]);

    // Decode base64 content
    const content = atob(output.trim());
    return content;
  } catch {
    // Document not found, return null
    return null;
  }
}

/**
 * Create a gap issue in the repository
 *
 * @param repo - Repository in "owner/repo" format
 * @param action - Review action with issue details
 * @returns Created issue number
 */
export async function createGapIssue(
  repo: string,
  action: ReviewAction,
): Promise<number> {
  if (!action.title || !action.body) {
    throw new Error("create-issue action requires title and body");
  }

  const args = [
    "issue",
    "create",
    "-R",
    repo,
    "--title",
    action.title,
    "--body",
    action.body,
  ];

  // Add labels if specified
  if (action.labels && action.labels.length > 0) {
    for (const label of action.labels) {
      args.push("--label", label);
    }
  }

  const output = await execGhCommand(args);

  // Extract issue number from URL output
  // Output format: https://github.com/owner/repo/issues/123
  const match = output.match(/\/issues\/(\d+)/);
  if (!match) {
    throw new Error(`Failed to parse created issue number from: ${output}`);
  }

  return parseInt(match[1], 10);
}

/**
 * Add comment to an issue
 *
 * @param repo - Repository in "owner/repo" format
 * @param issueNumber - Issue number
 * @param body - Comment body
 */
export async function addIssueComment(
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await execGhCommand([
    "issue",
    "comment",
    String(issueNumber),
    "-R",
    repo,
    "--body",
    body,
  ]);
}

/**
 * Check if issue is closed
 *
 * @param repo - Repository in "owner/repo" format
 * @param issueNumber - Issue number
 * @returns True if issue is closed
 */
export async function isIssueClosed(
  repo: string,
  issueNumber: number,
): Promise<boolean> {
  const output = await execGhCommand([
    "issue",
    "view",
    String(issueNumber),
    "-R",
    repo,
    "--json",
    "state",
  ]);

  const { state } = JSON.parse(output);
  return state === "CLOSED";
}

/**
 * Get current repository name
 *
 * @returns Repository in "owner/repo" format
 */
export async function getCurrentRepo(): Promise<string> {
  const output = await execGhCommand([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]);

  return output.trim();
}

/**
 * Parse review-action blocks from LLM output
 *
 * @param text - Text containing review-action blocks
 * @returns Parsed review actions
 */
export function parseReviewActions(text: string): ReviewAction[] {
  const actions: ReviewAction[] = [];

  // Match ```review-action blocks
  const regex = /```review-action\s*\n([\s\S]*?)\n```/g;

  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const actionJson = match[1].trim();
      const action = JSON.parse(actionJson) as ReviewAction;
      actions.push(action);
    } catch {
      // Invalid JSON, skip this block
      console.warn("Failed to parse review-action block:", match[1]);
    }
  }

  return actions;
}

/**
 * Execute a review action
 *
 * @param repo - Repository in "owner/repo" format
 * @param action - Review action to execute
 * @returns Result of the action (e.g., created issue number)
 */
export async function executeReviewAction(
  repo: string,
  action: ReviewAction,
): Promise<{ type: string; result: unknown }> {
  switch (action.action) {
    case "create-issue": {
      const issueNumber = await createGapIssue(repo, action);
      return { type: "create-issue", result: { issueNumber } };
    }

    case "progress": {
      // Progress is informational, no action needed
      return { type: "progress", result: { body: action.body } };
    }

    case "complete": {
      // Complete is the final summary, no action needed
      return {
        type: "complete",
        result: { summary: action.summary || action.body },
      };
    }

    default:
      throw new Error(
        `Unknown review action type: ${(action as ReviewAction).action}`,
      );
  }
}

/**
 * Fetch all issues from a GitHub Project
 *
 * @param projectNumber - GitHub Project number
 * @returns Array of project items
 */
export async function fetchProjectIssues(
  projectNumber: number,
): Promise<ProjectItem[]> {
  const output = await execGhCommand([
    "project",
    "item-list",
    String(projectNumber),
    "--owner",
    "@me",
    "--format",
    "json",
  ]);

  const data = JSON.parse(output);
  return data.items || [];
}

/**
 * Fetch issues from a project filtered by label
 *
 * @param projectNumber - GitHub Project number
 * @param label - Label to filter by
 * @returns Array of issues with the specified label
 */
export async function fetchProjectIssuesByLabel(
  projectNumber: number,
  label: string,
): Promise<GitHubIssue[]> {
  const items = await fetchProjectIssues(projectNumber);

  // Filter items by label (labels are at item level as string[])
  const filtered = items.filter((item) => {
    if (!item.labels) return false;
    return item.labels.includes(label);
  });

  // Convert to GitHubIssue format
  const issues: GitHubIssue[] = [];
  for (const item of filtered) {
    if (item.content?.number) {
      // Fetch full issue details
      const repo = item.content.repository || await getCurrentRepo();
      const issue = await fetchIssue(repo, item.content.number);
      issues.push(issue);
    }
  }

  return issues;
}

/**
 * Fetch requirements issues (with docs label) from project
 *
 * @param projectNumber - GitHub Project number
 * @param requirementsLabel - Label for requirements (default: "docs")
 * @returns Array of requirement issues
 */
export async function fetchRequirementsIssues(
  projectNumber: number,
  requirementsLabel: string = "docs",
): Promise<GitHubIssue[]> {
  return fetchProjectIssuesByLabel(projectNumber, requirementsLabel);
}

/**
 * Fetch review target issues (with review label) from project
 *
 * @param projectNumber - GitHub Project number
 * @param reviewLabel - Label for review targets (default: "review")
 * @returns Array of review target issues
 */
export async function fetchReviewTargetIssues(
  projectNumber: number,
  reviewLabel: string = "review",
): Promise<GitHubIssue[]> {
  return fetchProjectIssuesByLabel(projectNumber, reviewLabel);
}
