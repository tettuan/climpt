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
        // deno-lint-ignore no-console
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

    // deno-lint-ignore no-console
    console.log("\n=== Agent Complete ===");
    // deno-lint-ignore no-console
    console.log(`Total iterations: ${result.iterations}`);
    // deno-lint-ignore no-console
    console.log(`Reason: ${result.reason}`);

    if (!result.success) {
      // deno-lint-ignore no-console
      console.error(`Error: ${result.error}`);
      Deno.exit(1);
    }
  } catch (error) {
    if (error instanceof Error) {
      // deno-lint-ignore no-console
      console.error(`Error: ${error.message}`);
    } else {
      // deno-lint-ignore no-console
      console.error(`Error: ${String(error)}`);
    }
    Deno.exit(1);
  }
}

function printHelp(): void {
  // deno-lint-ignore no-console
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
    // deno-lint-ignore no-console
    console.log("No agents found in .agent/ directory");
    // deno-lint-ignore no-console
    console.log("\nCreate a new agent with:");
    // deno-lint-ignore no-console
    console.log("  deno task init --agent my-agent");
    return;
  }

  // deno-lint-ignore no-console
  console.log("Available agents:\n");

  // Load all agent definitions in parallel
  const definitions = await Promise.all(
    agents.map(async (agentName) => {
      try {
        const definition = await loadAgentDefinition(agentName, cwd);
        return { agentName, definition, error: false };
      } catch {
        return { agentName, definition: null, error: true };
      }
    }),
  );

  for (const { agentName, definition, error } of definitions) {
    if (error || !definition) {
      // deno-lint-ignore no-console
      console.log(`  ${agentName} (error loading definition)`);
    } else {
      // deno-lint-ignore no-console
      console.log(`  ${agentName}`);
      // deno-lint-ignore no-console
      console.log(`    ${definition.description}`);
      // deno-lint-ignore no-console
      console.log(`    Type: ${definition.behavior.completionType}`);
      // deno-lint-ignore no-console
      console.log("");
    }
  }

  // deno-lint-ignore no-console
  console.log("Run an agent with:");
  // deno-lint-ignore no-console
  console.log("  deno task agent --agent <name> [options]");
}

// Main entry point
if (import.meta.main) {
  await run();
}
