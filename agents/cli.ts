/**
 * CLI entry point for climpt-agents
 */

import { parseCliArgs } from "./runner/cli.ts";
import { listAgents, loadAgentDefinition } from "./runner/loader.ts";
import { AgentRunner } from "./runner/runner.ts";
import { initAgent } from "./init.ts";

export async function run(): Promise<void> {
  try {
    const parsed = await parseCliArgs(Deno.args);

    if (parsed.help) {
      printHelp();
      return;
    }

    if (parsed.list) {
      await printAgentList(parsed.cwd);
      return;
    }

    if (parsed.init) {
      if (!parsed.agentName) {
        console.error("Error: --agent <name> is required for init");
        Deno.exit(1);
      }
      await initAgent(parsed.agentName, parsed.cwd);
      return;
    }

    // Load and run agent
    const cwd = parsed.cwd ?? Deno.cwd();
    const definition = await loadAgentDefinition(parsed.agentName, cwd);
    const runner = new AgentRunner(definition);

    const result = await runner.run({
      cwd,
      args: parsed.args,
    });

    console.log("\n=== Agent Complete ===");
    console.log(`Total iterations: ${result.totalIterations}`);
    console.log(`Reason: ${result.completionReason}`);

    if (!result.success) {
      console.error(`Error: ${result.error}`);
      Deno.exit(1);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error(`Error: ${String(error)}`);
    }
    Deno.exit(1);
  }
}

function printHelp(): void {
  console.log(`
climpt-agents - Generic Agent Runner

Usage:
  deno run -A src/cli.ts --agent <name> [options]
  deno run -A src/cli.ts --init --agent <name>
  deno run -A src/cli.ts --list

  Or with tasks:
  deno task agent --agent <name> [options]

Global Options:
  --agent <name>    Agent name (required for run/init)
  --init            Initialize new agent template
  --list            List available agents
  --cwd <path>      Working directory
  --help, -h        Show this help

Examples:
  # List available agents
  deno task agent --list

  # Initialize new agent
  deno task init --agent my-agent

  # Run an agent
  deno task agent --agent facilitator --topic "Q1 Planning"

Agent-specific options are defined in the agent's agent.json file.
`);
}

async function printAgentList(cwd?: string): Promise<void> {
  const agents = await listAgents(cwd);

  if (agents.length === 0) {
    console.log("No agents found in .agent/ directory");
    console.log("\nCreate a new agent with:");
    console.log("  deno task init --agent my-agent");
    return;
  }

  console.log("Available agents:\n");

  for (const agentName of agents) {
    try {
      const definition = await loadAgentDefinition(agentName, cwd);
      console.log(`  ${agentName}`);
      console.log(`    ${definition.description}`);
      console.log(`    Type: ${definition.behavior.completionType}`);
      console.log("");
    } catch {
      console.log(`  ${agentName} (error loading definition)`);
    }
  }

  console.log("Run an agent with:");
  console.log("  deno task agent --agent <name> [options]");
}

// Main entry point
if (import.meta.main) {
  await run();
}
