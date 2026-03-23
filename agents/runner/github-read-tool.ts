/**
 * GitHubRead MCP Tool — Read-only GitHub access for agents.
 *
 * Agents must not access GitHub directly (blocked by sandbox).
 * This MCP tool runs in the host process (outside sandbox) and
 * provides structured, read-only access via Deno.Command("gh").
 *
 * Write operations (edit, close, comment, create) are not exposed.
 * Those are handled exclusively by the Boundary Hook.
 */

import { z } from "zod";

// --- Types ---

/** CallToolResult compatible with MCP protocol (index signature required by SDK) */
interface CallToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

// --- Zod Schemas ---

const IssueViewSchema = {
  operation: z.literal("issue_view"),
  number: z.number().describe("Issue number"),
};

const IssueListSchema = {
  operation: z.literal("issue_list"),
  state: z.enum(["open", "closed", "all"]).optional().describe(
    "Filter by state",
  ),
  label: z.string().optional().describe("Filter by label"),
  limit: z.number().optional().describe("Max results (default: 30)"),
};

const PrViewSchema = {
  operation: z.literal("pr_view"),
  number: z.number().describe("PR number"),
};

const PrListSchema = {
  operation: z.literal("pr_list"),
  state: z.enum(["open", "closed", "merged", "all"]).optional().describe(
    "Filter by state",
  ),
  limit: z.number().optional().describe("Max results (default: 30)"),
};

const PrDiffSchema = {
  operation: z.literal("pr_diff"),
  number: z.number().describe("PR number"),
};

const PrChecksSchema = {
  operation: z.literal("pr_checks"),
  number: z.number().describe("PR number"),
};

// --- gh command executor ---

async function runGh(args: string[], cwd: string): Promise<CallToolResult> {
  const cmd = new Deno.Command("gh", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });

  const output = await cmd.output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  const stderr = new TextDecoder().decode(output.stderr).trim();

  if (!output.success) {
    return {
      content: [{
        type: "text",
        text: `Error: ${stderr || "gh command failed"}`,
      }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: stdout || "(empty output)" }],
  };
}

// --- Operation handlers ---

function handleIssueView(
  args: { number: number },
  cwd: string,
): Promise<CallToolResult> {
  return runGh(
    [
      "issue",
      "view",
      String(args.number),
      "--json",
      "number,title,body,labels,state,assignees,milestone,comments",
    ],
    cwd,
  );
}

function handleIssueList(
  args: { state?: string; label?: string; limit?: number },
  cwd: string,
): Promise<CallToolResult> {
  const ghArgs = ["issue", "list", "--json", "number,title,labels,state"];
  if (args.state) ghArgs.push("--state", args.state);
  if (args.label) ghArgs.push("--label", args.label);
  if (args.limit) ghArgs.push("--limit", String(args.limit));
  return runGh(ghArgs, cwd);
}

function handlePrView(
  args: { number: number },
  cwd: string,
): Promise<CallToolResult> {
  return runGh(
    [
      "pr",
      "view",
      String(args.number),
      "--json",
      "number,title,body,labels,state,mergeable,reviewDecision,checks",
    ],
    cwd,
  );
}

function handlePrList(
  args: { state?: string; limit?: number },
  cwd: string,
): Promise<CallToolResult> {
  const ghArgs = [
    "pr",
    "list",
    "--json",
    "number,title,labels,state,headRefName",
  ];
  if (args.state) ghArgs.push("--state", args.state);
  if (args.limit) ghArgs.push("--limit", String(args.limit));
  return runGh(ghArgs, cwd);
}

function handlePrDiff(
  args: { number: number },
  cwd: string,
): Promise<CallToolResult> {
  return runGh(["pr", "diff", String(args.number)], cwd);
}

function handlePrChecks(
  args: { number: number },
  cwd: string,
): Promise<CallToolResult> {
  return runGh(["pr", "checks", String(args.number)], cwd);
}

// --- MCP tool definitions ---

/** Input schema for the unified github_read tool */
export const GitHubReadInputSchema = {
  operation: z.enum([
    "issue_view",
    "issue_list",
    "pr_view",
    "pr_list",
    "pr_diff",
    "pr_checks",
  ]).describe("GitHub read operation to perform"),
  number: z.number().optional().describe(
    "Issue or PR number (required for view/diff/checks)",
  ),
  state: z.string().optional().describe(
    "Filter by state (open/closed/all/merged)",
  ),
  label: z.string().optional().describe("Filter by label"),
  limit: z.number().optional().describe("Max results for list operations"),
};

/**
 * Create the GitHubRead MCP tool handler.
 *
 * @param cwd - Working directory for gh commands
 */
export function createGitHubReadHandler(cwd: string): (args: {
  operation: string;
  number?: number;
  state?: string;
  label?: string;
  limit?: number;
}) => Promise<CallToolResult> {
  return async (args: {
    operation: string;
    number?: number;
    state?: string;
    label?: string;
    limit?: number;
  }): Promise<CallToolResult> => {
    switch (args.operation) {
      case "issue_view": {
        if (args.number === undefined) {
          return {
            content: [{
              type: "text",
              text: "Error: number is required for issue_view",
            }],
            isError: true,
          };
        }
        return await handleIssueView({ number: args.number }, cwd);
      }
      case "issue_list":
        return await handleIssueList({
          state: args.state,
          label: args.label,
          limit: args.limit,
        }, cwd);
      case "pr_view": {
        if (args.number === undefined) {
          return {
            content: [{
              type: "text",
              text: "Error: number is required for pr_view",
            }],
            isError: true,
          };
        }
        return await handlePrView({ number: args.number }, cwd);
      }
      case "pr_list":
        return await handlePrList(
          { state: args.state, limit: args.limit },
          cwd,
        );
      case "pr_diff": {
        if (args.number === undefined) {
          return {
            content: [{
              type: "text",
              text: "Error: number is required for pr_diff",
            }],
            isError: true,
          };
        }
        return await handlePrDiff({ number: args.number }, cwd);
      }
      case "pr_checks": {
        if (args.number === undefined) {
          return {
            content: [{
              type: "text",
              text: "Error: number is required for pr_checks",
            }],
            isError: true,
          };
        }
        return await handlePrChecks({ number: args.number }, cwd);
      }
      default:
        return {
          content: [{
            type: "text",
            text: `Error: unknown operation "${args.operation}"`,
          }],
          isError: true,
        };
    }
  };
}

/** MCP server name constant */
export const GITHUB_READ_SERVER_NAME = "github";

/** Tool name constant for allowedTools */
export const GITHUB_READ_TOOL_NAME =
  `mcp__${GITHUB_READ_SERVER_NAME}__github_read`;

// Suppress unused variable warnings for operation-specific schemas.
// These schemas document the per-operation contract and may be used
// for future per-operation validation or code generation.
void IssueViewSchema;
void IssueListSchema;
void PrViewSchema;
void PrListSchema;
void PrDiffSchema;
void PrChecksSchema;
