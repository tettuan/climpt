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
 * Validate CLI arguments and exit if invalid
 */
export function validateArgs(
  args: CliArgs,
): asserts args is CliArgs & { query: string } {
  if (!args.query) {
    displayHelp();
    Deno.exit(1);
  }
}

/**
 * Display help message
 */
export function displayHelp(): void {
  console.error(
    'Usage: climpt-agent.ts --query="<search query>" [--intent="<detailed intent>"] [--agent=<name>] [--options=...]',
  );
  console.error("");
  console.error("Parameters:");
  console.error(
    "  --query   Short query for command search (required)",
  );
  console.error(
    "  --intent  Detailed description for option resolution (optional, defaults to query)",
  );
  console.error('  --agent   Agent name (default: "climpt")');
  console.error("  --options  Comma-separated list of options (optional)");
  console.error("");
  console.error("Example:");
  console.error(
    '  climpt-agent.ts --query="run specific test" --intent="test options-prompt.ts changes"',
  );
}
