/**
 * Iterate Agent - CLI Argument Parser
 *
 * Parses command-line arguments for the iterate-agent.
 */

import { parseArgs } from "@std/cli/parse-args";
import type { AgentOptions, AgentName } from "./types.ts";

/**
 * Valid agent names (defined in .agent/climpt/config/registry_config.json)
 */
const DEFAULT_AGENT_NAME = "climpt";

/**
 * Parse CLI arguments and return AgentOptions
 *
 * @param args - Command-line arguments (typically Deno.args)
 * @returns Parsed and validated AgentOptions
 * @throws Error if validation fails
 */
export function parseCliArgs(args: string[]): AgentOptions {
  const parsed = parseArgs(args, {
    string: ["name", "issue", "project", "iterate-max"],
    default: {
      "name": DEFAULT_AGENT_NAME,
    },
    alias: {
      i: "issue",
      p: "project",
      m: "iterate-max",
      n: "name",
    },
  });

  // Get agent name
  const agentName = parsed["name"] as string;

  // Parse numbers
  const issue = parsed.issue ? parseInt(parsed.issue as string, 10) : undefined;
  const project = parsed.project ? parseInt(parsed.project as string, 10) : undefined;
  const iterateMax = parsed["iterate-max"]
    ? parseInt(parsed["iterate-max"] as string, 10)
    : Infinity;

  // Validate mutually exclusive options
  if (issue !== undefined && project !== undefined) {
    throw new Error(
      "Cannot specify both --issue and --project. Choose one completion criterion."
    );
  }

  // Validate number ranges
  if (issue !== undefined && (isNaN(issue) || issue < 1 || !Number.isInteger(issue))) {
    throw new Error("--issue must be a positive integer");
  }

  if (project !== undefined && (isNaN(project) || project < 1 || !Number.isInteger(project))) {
    throw new Error("--project must be a positive integer");
  }

  if (
    iterateMax !== Infinity &&
    (isNaN(iterateMax) || iterateMax < 1 || !Number.isInteger(iterateMax))
  ) {
    throw new Error("--iterate-max must be a positive integer or omitted (for unlimited)");
  }

  return {
    issue,
    project,
    iterateMax,
    agentName: agentName as AgentName,
  };
}

/**
 * Display help message
 */
export function displayHelp(): void {
  console.log(`
Iterate Agent - Autonomous Development Agent

USAGE:
  deno task iterate-agent [OPTIONS]

OPTIONS:
  --issue, -i <number>
      GitHub Issue number to work on. The agent will work until the issue is closed.

  --project, -p <number>
      GitHub Project number to work on. The agent will work until all project items are complete.

  --iterate-max, -m <number>
      Maximum number of Skill invocations. Defaults to unlimited.

  --name, -n <name>
      MCP agent name (e.g., "climpt"). Defaults to "${DEFAULT_AGENT_NAME}".
      Must be defined in .agent/climpt/config/registry_config.json

  --help, -h
      Display this help message.

EXAMPLES:
  # Work on Issue #123 until closed
  deno task iterate-agent --issue 123

  # Work on Project #5 until all items complete
  deno task iterate-agent --project 5

  # Run with specific agent for 10 iterations
  deno task iterate-agent --name climpt --iterate-max 10

  # Work on Issue #456 with climpt agent
  deno task iterate-agent --issue 456 --name climpt

NOTES:
  - Requires GITHUB_TOKEN environment variable with 'repo' and 'project' scopes
  - Agent name must be defined in .agent/climpt/config/registry_config.json
  - Logs are saved to tmp/logs/agents/{agent-name}/session-{timestamp}.jsonl
  - Maximum 100 log files per agent (auto-rotated)
`);
}
