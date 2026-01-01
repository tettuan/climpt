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
 * Get the owner of the current repository
 *
 * @returns Repository owner (user or organization name)
 * @throws Error if gh command fails or not in a git repository
 */
async function getRepoOwner(): Promise<string> {
  const command = new Deno.Command("gh", {
    args: ["repo", "view", "--json", "owner", "-q", ".owner.login"],
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

  return new TextDecoder().decode(stdout).trim();
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
  const owner = await getRepoOwner();
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
 * Check if Project is complete (all items done)
 *
 * @param projectNumber - Project number
 * @returns true if all project items are complete
 * @throws Error if gh command fails
 */
export async function isProjectComplete(
  projectNumber: number,
): Promise<boolean> {
  const owner = await getRepoOwner();
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
  const rawItems = rawProject.items;
  const items: GitHubProject["items"] = Array.isArray(rawItems) ? rawItems : [];

  // Empty project is considered complete
  if (items.length === 0) {
    return true;
  }

  // All items must be closed or marked as done
  return items.every(
    (item) => item.content?.state === "CLOSED" || item.status === "Done",
  );
}
