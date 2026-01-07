/**
 * Review Agent - CLI Argument Parser
 *
 * Parses command-line arguments for the review-agent.
 */

import { parseArgs } from "@std/cli/parse-args";
import type { AgentName, ParsedArgs } from "./types.ts";

/**
 * Default values
 */
const DEFAULT_AGENT_NAME = "reviewer";
const DEFAULT_REQUIREMENTS_LABEL = "docs";
const DEFAULT_REVIEW_LABEL = "review";

/**
 * Parse CLI arguments and return ParsedArgs
 *
 * @param args - Command-line arguments (typically Deno.args)
 * @returns Parsed arguments including flags and options
 * @throws Error if validation fails
 */
export function parseCliArgs(args: string[]): ParsedArgs {
  const parsed = parseArgs(args, {
    string: [
      "project",
      "name",
      "iterate-max",
      "requirements-label",
      "review-label",
      "branch",
      "base-branch",
    ],
    boolean: ["init", "help"],
    default: {
      name: DEFAULT_AGENT_NAME,
      "requirements-label": DEFAULT_REQUIREMENTS_LABEL,
      "review-label": DEFAULT_REVIEW_LABEL,
      init: false,
      help: false,
    },
    alias: {
      p: "project",
      n: "name",
      m: "iterate-max",
      h: "help",
      b: "branch",
    },
  });

  // Check for help flag
  if (parsed.help) {
    return { init: false, help: true };
  }

  // Check for init flag
  if (parsed.init) {
    return { init: true, help: false };
  }

  // Get required parameters
  const projectStr = parsed.project as string | undefined;

  // Validate required parameters
  if (!projectStr) {
    throw new Error(
      "--project is required. Specify the GitHub Project number.",
    );
  }

  // Parse project number
  const project = parseInt(projectStr, 10);
  if (isNaN(project) || project < 1 || !Number.isInteger(project)) {
    throw new Error("--project must be a positive integer");
  }

  // Get agent name
  const agentName = parsed.name as string;

  // Get label options
  const requirementsLabel = parsed["requirements-label"] as string;
  const reviewLabel = parsed["review-label"] as string;

  // Parse iterate-max
  const iterateMax = parsed["iterate-max"]
    ? parseInt(parsed["iterate-max"] as string, 10)
    : Infinity;

  if (
    iterateMax !== Infinity &&
    (isNaN(iterateMax) || iterateMax < 1 || !Number.isInteger(iterateMax))
  ) {
    throw new Error("--iterate-max must be a positive integer");
  }

  // Get worktree options
  const branch = parsed.branch as string | undefined;
  const baseBranch = parsed["base-branch"] as string | undefined;

  return {
    init: false,
    help: false,
    options: {
      project,
      iterateMax,
      agentName: agentName as AgentName,
      requirementsLabel,
      reviewLabel,
      branch,
      baseBranch,
    },
  };
}

/**
 * Display help message
 */
export function displayHelp(): void {
  console.log(`
Review Agent - Autonomous Implementation Reviewer

USAGE:
  deno run -A jsr:@aidevtool/climpt/agents/reviewer --project <number>

REQUIRED:
  --project, -p <number>
      GitHub Project number to review. The agent will:
      1. Fetch issues with 'review' label as review targets
      2. Fetch issues with 'docs' label as requirements/specifications
      3. Verify implementation against requirements
      4. Create gap issues for any missing implementations

LABEL OPTIONS:
  --requirements-label <label>
      Label for requirement/specification issues (default: "${DEFAULT_REQUIREMENTS_LABEL}").
      Issues with this label are treated as the source of truth.

  --review-label <label>
      Label for issues to review (default: "${DEFAULT_REVIEW_LABEL}").
      Issues with this label are the review targets.

OPTIONS:
  --init
      Initialize configuration files in the current directory.
      Creates agents/reviewer/config.json and agents/reviewer/prompts/default.md

  --name, -n <name>
      Agent name (default: "${DEFAULT_AGENT_NAME}").
      Must be defined in agents/reviewer/config.json

  --iterate-max, -m <number>
      Maximum number of iterations. Defaults to unlimited.

  --branch, -b <name>
      Working branch name for worktree mode. Only effective when forceWorktree
      is true in config. If not specified, auto-generated as:
      <currentBranch>-yyyymmdd-hhmmss

  --base-branch <name>
      Base branch (merge target) for worktree mode. If not specified, uses the
      current branch at execution time.

  --help, -h
      Display this help message.

EXAMPLES:
  # First time setup (required)
  deno run -A jsr:@aidevtool/climpt/agents/reviewer --init

  # Review project #25 (uses default labels: docs, review)
  deno run -A jsr:@aidevtool/climpt/agents/reviewer --project 25

  # Review with custom labels
  deno run -A jsr:@aidevtool/climpt/agents/reviewer -p 25 \\
    --requirements-label specs --review-label check

  # Review with iteration limit
  deno run -A jsr:@aidevtool/climpt/agents/reviewer -p 25 -m 5

LABEL SYSTEM:
  - 'docs' label: Issues containing requirements/specifications
  - 'review' label: Issues that need implementation review

OUTPUT:
  - Creates issues for each implementation gap found
  - Labels: "implementation-gap", "from-reviewer"
  - Provides summary of reviewed requirements and gaps

NOTES:
  - Run --init first to create configuration files in your project
  - Requires 'gh' CLI (https://cli.github.com) with authentication
  - This agent is read-only: it does NOT modify implementation code
  - Logs are saved to tmp/logs/agents/reviewer/session-{timestamp}.jsonl
`);
}
