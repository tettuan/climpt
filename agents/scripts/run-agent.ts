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
 * deno run -A agents/scripts/run-agent.ts --agent reviewer --project 5
 * ```
 */

import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { AgentRunner } from "../runner/runner.ts";
import { listAgents, loadAgentDefinition } from "../runner/loader.ts";

function printHelp(): void {
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
  --project, -p <number> GitHub Project number to review (required)
  --requirements-label   Label for requirement issues (default: docs)
  --review-label         Label for issues to review (default: review)
  --iterate-max <n>      Maximum iterations (default: 50)

Examples:
  # Work on a GitHub Issue
  run-agent.ts --agent iterator --issue 123

  # Work on a GitHub Project
  run-agent.ts --agent iterator --project 5 --label docs

  # Review a project
  run-agent.ts --agent reviewer --project 5
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
    console.log("\nAvailable agents:");
    const agents = await listAgents(Deno.cwd());
    for (const agent of agents) {
      console.log(`  - ${agent}`);
    }
    console.log("");
    Deno.exit(0);
  }

  // Agent name is required
  if (!args.agent) {
    console.error("Error: --agent <name> is required");
    console.error(
      "Use --help for usage information or --list to see available agents",
    );
    Deno.exit(1);
  }

  const agentName = args.agent;

  try {
    // Load agent definition
    console.log(`\nLoading agent: ${agentName}`);
    const definition = await loadAgentDefinition(agentName, Deno.cwd());
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
    console.log(`\nStarting ${definition.displayName}...\n`);

    const result = await runner.run({
      cwd: Deno.cwd(),
      args: runnerArgs,
      plugins: [],
    });

    // Report result
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Agent completed: ${result.success ? "SUCCESS" : "FAILED"}`);
    console.log(`Total iterations: ${result.totalIterations}`);
    console.log(`Reason: ${result.completionReason}`);
    if (result.error) {
      console.error(`Error: ${result.error}`);
    }
    console.log(`${"=".repeat(60)}\n`);

    Deno.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error(
      `\nError: ${error instanceof Error ? error.message : String(error)}`,
    );
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
