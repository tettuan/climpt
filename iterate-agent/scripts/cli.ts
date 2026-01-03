/**
 * Iterate Agent - CLI Argument Parser
 *
 * Parses command-line arguments for the iterate-agent.
 */

import { parseArgs } from "jsr:@std/cli@^1/parse-args";
import type { AgentName, ParsedArgs } from "./types.ts";

/**
 * Valid agent names (defined in .agent/climpt/config/registry_config.json)
 */
const DEFAULT_AGENT_NAME = "climpt";

/**
 * Parse CLI arguments and return ParsedArgs
 *
 * @param args - Command-line arguments (typically Deno.args)
 * @returns Parsed arguments including flags and options
 * @throws Error if validation fails
 */
export function parseCliArgs(args: string[]): ParsedArgs {
  const parsed = parseArgs(args, {
    string: ["name", "issue", "project", "iterate-max", "label"],
    boolean: ["init", "help", "resume", "include-completed"],
    default: {
      "name": DEFAULT_AGENT_NAME,
      "init": false,
      "help": false,
      "resume": false,
      "include-completed": false,
    },
    alias: {
      i: "issue",
      p: "project",
      m: "iterate-max",
      n: "name",
      h: "help",
      r: "resume",
      l: "label",
      c: "include-completed",
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

  // Get agent name
  const agentName = parsed["name"] as string;

  // Parse numbers
  const issue = parsed.issue ? parseInt(parsed.issue as string, 10) : undefined;
  const project = parsed.project
    ? parseInt(parsed.project as string, 10)
    : undefined;
  const iterateMax = parsed["iterate-max"]
    ? parseInt(parsed["iterate-max"] as string, 10)
    : Infinity;

  // Validate mutually exclusive options
  if (issue !== undefined && project !== undefined) {
    throw new Error(
      "Cannot specify both --issue and --project. Choose one completion criterion.",
    );
  }

  // Validate number ranges
  if (
    issue !== undefined &&
    (isNaN(issue) || issue < 1 || !Number.isInteger(issue))
  ) {
    throw new Error("--issue must be a positive integer");
  }

  if (
    project !== undefined &&
    (isNaN(project) || project < 1 || !Number.isInteger(project))
  ) {
    throw new Error("--project must be a positive integer");
  }

  if (
    iterateMax !== Infinity &&
    (isNaN(iterateMax) || iterateMax < 1 || !Number.isInteger(iterateMax))
  ) {
    throw new Error(
      "--iterate-max must be a positive integer or omitted (for unlimited)",
    );
  }

  // Get resume flag
  const resume = parsed.resume as boolean;

  // Get label filter (only valid with --project)
  const label = parsed.label as string | undefined;

  // Get include-completed flag (only valid with --project)
  const includeCompleted = parsed["include-completed"] as boolean;

  // Validate label option
  if (label !== undefined && project === undefined) {
    throw new Error("--label can only be used with --project");
  }

  // Validate include-completed option
  if (includeCompleted && project === undefined) {
    throw new Error("--include-completed can only be used with --project");
  }

  return {
    init: false,
    help: false,
    options: {
      issue,
      project,
      iterateMax,
      agentName: agentName as AgentName,
      resume,
      label,
      includeCompleted,
    },
  };
}

/**
 * Display help message
 */
export function displayHelp(): void {
  console.log(`
Iterate Agent - Autonomous Development Agent

USAGE:
  deno run -A jsr:@aidevtool/climpt/agents/iterator [OPTIONS]

OPTIONS:
  --init
      Initialize configuration files in the current directory.
      Creates iterate-agent/config.json and iterate-agent/prompts/default.md
      Run this once before first use.

  --issue, -i <number>
      GitHub Issue number to work on. The agent will work until the issue is closed.

  --project, -p <number>
      GitHub Project number to work on. The agent will work through each open issue
      in the project one by one until all are closed.

  --label, -l <name>
      Filter project issues by label (e.g., "docs", "bug"). Only issues with this
      label will be processed. Can only be used with --project.

  --include-completed, -c
      Include items marked as "Done" on the project board. By default, only
      open items are processed. Useful for reviewing completed work.
      Can only be used with --project.

  --iterate-max, -m <number>
      Maximum number of Skill invocations. Defaults to unlimited.

  --name, -n <name>
      MCP agent name (e.g., "climpt"). Defaults to "${DEFAULT_AGENT_NAME}".
      Must be defined in iterate-agent/config.json

  --resume, -r
      Resume previous session instead of starting fresh. Defaults to false.
      When enabled, uses SDK session_id to continue from where the last iteration ended.

  --help, -h
      Display this help message.

EXAMPLES:
  # First time setup (required)
  deno run -A jsr:@aidevtool/climpt/agents/iterator --init

  # Work on Issue #123 until closed
  deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123

  # Work on all open issues in Project #5
  deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5

  # Work on only "docs" labeled issues in Project #25
  deno run -A jsr:@aidevtool/climpt/agents/iterator --project 25 --label docs

  # Run with specific agent for 10 iterations
  deno run -A jsr:@aidevtool/climpt/agents/iterator --name climpt --iterate-max 10

NOTES:
  - Run --init first to create configuration files in your project
  - Requires 'gh' CLI (https://cli.github.com) with authentication
  - Logs are saved to tmp/logs/agents/{agent-name}/session-{timestamp}.jsonl
  - Maximum 100 log files per agent (auto-rotated)
`);
}
