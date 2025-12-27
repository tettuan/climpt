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
export function validateArgs(args: CliArgs): asserts args is CliArgs & { query: string } {
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
    'Usage: climpt-agent.ts --query="<natural language query>" [--agent=<name>] [--options=...]',
  );
  console.error("");
  console.error("Parameters:");
  console.error(
    "  --query   Natural language description of what you want to do (required)",
  );
  console.error('  --agent   Agent name (default: "climpt")');
  console.error("  --options  Comma-separated list of options (optional)");
  console.error("");
  console.error("Example:");
  console.error('  climpt-agent.ts --query="commit my changes"');
}
