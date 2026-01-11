/**
 * Unified Agent Runner Entry Point
 *
 * Runs agents using the unified AgentRunner architecture.
 *
 * @module
 *
 * @example Run iterator agent
 * ```bash
 * deno run -A agents/scripts/run-agent.ts --agent iterator --issue 123
 * deno run -A agents/scripts/run-agent.ts --agent iterator --project 5
 * ```
 *
 * @example Run reviewer agent
 * ```bash
 * deno run -A agents/scripts/run-agent.ts --agent reviewer --issue 123
 * ```
 */

import { parseArgs } from "@std/cli/parse-args";
import { AgentRunner } from "../runner/runner.ts";
import { listAgents, loadAgentDefinition } from "../runner/loader.ts";

function printHelp(): void {
  // deno-lint-ignore no-console
  console.log(`
Unified Agent Runner

Usage:
  run-agent.ts --agent <name> [options]

Required:
  --agent, -a <name>     Agent name (iterator, reviewer, etc.)

Options:
  --help, -h             Show this help message
  --init                 Initialize agent configuration
  --list                 List available agents

Iterator Options:
  --issue, -i <number>   GitHub Issue number to work on
  --project, -p <number> GitHub Project number to work on
  --project-owner <name> GitHub Project owner (user/org)
  --label <name>         Filter project issues by label
  --iterate-max <n>      Maximum iterations (default: 100)
  --resume               Resume previous session
  --include-completed    Include Done items from project board
  --branch <name>        Working branch for worktree mode
  --base-branch <name>   Base branch for worktree mode

Reviewer Options:
  --issue, -i <number>   GitHub Issue number to review (required)
  --iterate-max <n>      Maximum iterations (default: 300)
  --branch <name>        Working branch for worktree mode
  --base-branch <name>   Base branch for worktree mode

Examples:
  # Work on a GitHub Issue
  run-agent.ts --agent iterator --issue 123

  # Work on a GitHub Project
  run-agent.ts --agent iterator --project 5 --label docs

  # Review an issue
  run-agent.ts --agent reviewer --issue 123
`);
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    string: [
      "agent",
      "project-owner",
      "label",
      "branch",
      "base-branch",
      "requirements-label",
      "review-label",
    ],
    boolean: ["help", "init", "list", "resume", "include-completed"],
    alias: {
      a: "agent",
      h: "help",
      i: "issue",
      p: "project",
      m: "iterate-max",
    },
  });

  // Help
  if (args.help) {
    printHelp();
    Deno.exit(0);
  }

  // List available agents
  if (args.list) {
    // deno-lint-ignore no-console
    console.log("\nAvailable agents:");
    const agents = await listAgents(Deno.cwd());
    for (const agent of agents) {
      // deno-lint-ignore no-console
      console.log(`  - ${agent}`);
    }
    // deno-lint-ignore no-console
    console.log("");
    Deno.exit(0);
  }

  // Agent name is required
  if (!args.agent) {
    // deno-lint-ignore no-console
    console.error("Error: --agent <name> is required");
    // deno-lint-ignore no-console
    console.error(
      "Use --help for usage information or --list to see available agents",
    );
    Deno.exit(1);
  }

  const agentName = args.agent;

  try {
    // Load agent definition
    // deno-lint-ignore no-console
    console.log(`\nLoading agent: ${agentName}`);
    const definition = await loadAgentDefinition(agentName, Deno.cwd());
    // deno-lint-ignore no-console
    console.log(`  ${definition.displayName}: ${definition.description}`);

    // Build args for the runner
    const runnerArgs: Record<string, unknown> = {};

    // Map CLI args to runner args based on definition parameters
    if (definition.parameters) {
      for (const key of Object.keys(definition.parameters)) {
        // Convert camelCase to kebab-case for CLI arg lookup
        const kebabKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        const value = args[kebabKey] ?? args[key];
        if (value !== undefined) {
          runnerArgs[key] = value;
        }
      }
    }

    // Create and run the agent
    const runner = new AgentRunner(definition);
    // deno-lint-ignore no-console
    console.log(`\nStarting ${definition.displayName}...\n`);

    const result = await runner.run({
      cwd: Deno.cwd(),
      args: runnerArgs,
      plugins: [],
    });

    // Report result
    // deno-lint-ignore no-console
    console.log(`\n${"=".repeat(60)}`);
    // deno-lint-ignore no-console
    console.log(`Agent completed: ${result.success ? "SUCCESS" : "FAILED"}`);
    // deno-lint-ignore no-console
    console.log(`Total iterations: ${result.totalIterations}`);
    // deno-lint-ignore no-console
    console.log(`Reason: ${result.completionReason}`);
    if (result.error) {
      // deno-lint-ignore no-console
      console.error(`Error: ${result.error}`);
    }
    // deno-lint-ignore no-console
    console.log(`${"=".repeat(60)}\n`);

    Deno.exit(result.success ? 0 : 1);
  } catch (error) {
    // deno-lint-ignore no-console
    console.error(
      `\nError: ${error instanceof Error ? error.message : String(error)}`,
    );
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
