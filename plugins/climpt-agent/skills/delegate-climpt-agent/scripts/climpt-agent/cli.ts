/**
 * @fileoverview CLI argument parsing for Climpt Agent
 * @module climpt-plugins/skills/delegate-climpt-agent/scripts/cli
 */

import type { CliArgs } from "./types.ts";

/**
 * Parse command line arguments
 */
export function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    agent: "climpt",
    options: [],
  };

  for (const arg of args) {
    if (arg.startsWith("--query=")) {
      result.query = arg.slice(8);
    } else if (arg.startsWith("--query1=")) {
      result.query1 = arg.slice(9);
    } else if (arg.startsWith("--query2=")) {
      result.query2 = arg.slice(9);
    } else if (arg.startsWith("--intent=")) {
      result.intent = arg.slice(9);
    } else if (arg.startsWith("--agent=")) {
      result.agent = arg.slice(8);
    } else if (arg.startsWith("--options=")) {
      result.options = arg.slice(10).split(",");
    }
  }

  return result;
}

/**
 * Check if dual query mode (RRF) is used
 */
export function isDualQueryMode(args: CliArgs): boolean {
  return !!(args.query1 && args.query2);
}

/**
 * Validate CLI arguments and exit if invalid
 *
 * Accepts either:
 * - --query (legacy single query mode)
 * - --query1 and --query2 (new RRF dual query mode)
 */
export function validateArgs(
  args: CliArgs,
): asserts args is CliArgs & ({ query: string } | { query1: string; query2: string }) {
  const hasLegacyQuery = !!args.query;
  const hasDualQuery = !!(args.query1 && args.query2);

  if (!hasLegacyQuery && !hasDualQuery) {
    displayHelp();
    Deno.exit(1);
  }
}

/**
 * Display help message
 */
export function displayHelp(): void {
  console.error(
    "Usage: climpt-agent.ts [query options] [--intent=...] [--agent=...] [--options=...]",
  );
  console.error("");
  console.error("Query Options (choose one):");
  console.error(
    "  --query    Single query for command search (legacy mode)",
  );
  console.error(
    "  --query1   Action-focused query (what to do) - used with --query2",
  );
  console.error(
    "  --query2   Target-focused query (what to act on) - used with --query1",
  );
  console.error("");
  console.error("Other Parameters:");
  console.error(
    "  --intent   Detailed description for option resolution (optional, defaults to query)",
  );
  console.error('  --agent    Agent name (default: "climpt")');
  console.error("  --options  Comma-separated list of options (optional)");
  console.error("");
  console.error("Examples:");
  console.error(
    '  # Legacy single query mode:',
  );
  console.error(
    '  climpt-agent.ts --query="run specific test" --intent="test options-prompt.ts changes"',
  );
  console.error("");
  console.error(
    '  # Dual query mode (RRF):',
  );
  console.error(
    '  climpt-agent.ts --query1="execute test verify" --query2="specific file unit test"',
  );
}
