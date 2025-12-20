#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys

/**
 * @fileoverview Climpt Agent - Multi-stage workflow sub-agent builder
 * @module climpt-plugins/skills/delegate-climpt-agent/scripts/climpt-agent
 *
 * This script implements a multi-stage workflow:
 * 1. Receives a natural language query describing the task
 * 2. Searches the command registry using shared MCP utilities
 * 3. Gets command details (describe)
 * 4. Executes the command to get the instruction prompt
 * 5. Runs a sub-agent using Claude Agent SDK with the prompt
 */

// Claude Agent SDK (npm package)
import { query } from "npm:@anthropic-ai/claude-agent-sdk";
import type { Options, SDKMessage } from "npm:@anthropic-ai/claude-agent-sdk";

// Shared MCP utilities from climpt package
import {
  type Command,
  describeCommand,
  loadMCPConfig,
  loadRegistryForAgent,
  searchCommands,
  type SearchResult,
} from "jsr:@aidevtool/climpt";

// =============================================================================
// Types
// =============================================================================

/**
 * Command parameters for execution
 */
interface ClimptCommand {
  agent: string;
  c1: string;
  c2: string;
  c3: string;
  options?: string[];
}

/**
 * CLI arguments
 */
interface CliArgs {
  query?: string;
  agent: string;
  options: string[];
}

// =============================================================================
// Command Execution
// =============================================================================

/**
 * Generate sub-agent name following C3L naming convention
 */
function generateSubAgentName(cmd: ClimptCommand): string {
  return `${cmd.agent}-${cmd.c1}-${cmd.c2}-${cmd.c3}`;
}

/**
 * Execute Climpt command via CLI and get the instruction prompt
 */
async function getClimptPrompt(cmd: ClimptCommand): Promise<string> {
  const configParam = cmd.agent === "climpt" ? cmd.c1 : `${cmd.agent}-${cmd.c1}`;

  const commandArgs = [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-run",
    "--allow-net",
    "--no-config",
    "jsr:@aidevtool/climpt",
    `--config=${configParam}`,
    cmd.c2,
    cmd.c3,
  ];

  if (cmd.options?.length) {
    commandArgs.push(...cmd.options);
  }

  const process = new Deno.Command("deno", {
    args: commandArgs,
    stdout: "piped",
    stderr: "piped",
  });

  const { stdout, stderr, code } = await process.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(`Climpt execution failed: ${errorText}`);
  }

  return new TextDecoder().decode(stdout);
}

/**
 * Run Claude Agent SDK with the obtained prompt
 */
async function runSubAgent(
  agentName: string,
  prompt: string,
  cwd: string,
): Promise<void> {
  const options: Options = {
    cwd,
    settingSources: ["project"],
    allowedTools: [
      "Skill",
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Glob",
      "Grep",
      "Task",
    ],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
    },
  };

  console.error(`Starting sub-agent: ${agentName}`);

  const queryResult = query({
    prompt,
    options,
  });

  for await (const message of queryResult) {
    handleMessage(message);
  }
}

/**
 * Handle SDK message types
 */
function handleMessage(message: SDKMessage): void {
  switch (message.type) {
    case "assistant":
      if (message.message.content) {
        for (const block of message.message.content) {
          if (block.type === "text") {
            console.log(block.text);
          }
        }
      }
      break;
    case "result":
      if (message.subtype === "success") {
        console.error(`Completed. Cost: $${message.total_cost_usd.toFixed(4)}`);
      } else {
        console.error(`Error: ${message.subtype}`);
        if ("errors" in message) {
          console.error((message as { errors: string[] }).errors.join("\n"));
        }
      }
      break;
    case "system":
      if (message.subtype === "init") {
        console.error(
          `Session: ${message.session_id}, Model: ${message.model}`,
        );
      }
      break;
  }
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): CliArgs {
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
 * Validate CLI arguments
 */
function validateArgs(args: CliArgs): void {
  if (!args.query) {
    console.error(
      "Usage: climpt-agent.ts --query=\"<natural language query>\" [--agent=<name>] [--options=...]",
    );
    console.error("");
    console.error("Parameters:");
    console.error(
      '  --query   Natural language description of what you want to do (required)',
    );
    console.error('  --agent   Agent name (default: "climpt")');
    console.error("  --options  Comma-separated list of options (optional)");
    console.error("");
    console.error("Example:");
    console.error('  climpt-agent.ts --query="commit my changes"');
    Deno.exit(1);
  }
}

// =============================================================================
// Main Workflow
// =============================================================================

/**
 * Main entry point - Multi-stage workflow
 *
 * Uses shared MCP utilities from climpt package:
 * - searchCommands(): Find matching command using cosine similarity
 * - describeCommand(): Get command details
 */
async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  validateArgs(args);

  console.error(`🔍 Searching for: "${args.query}"`);

  // Step 1: Load configuration and registry
  const mcpConfig = await loadMCPConfig();
  const commands = await loadRegistryForAgent(mcpConfig, args.agent);

  if (commands.length === 0) {
    console.error(`❌ No commands found for agent '${args.agent}'`);
    Deno.exit(1);
  }

  // Step 2: Search for matching commands (using shared utility)
  const searchResults: SearchResult[] = searchCommands(commands, args.query!);

  if (searchResults.length === 0) {
    console.error(`❌ No matching commands found for query: "${args.query}"`);
    Deno.exit(1);
  }

  // Select the best match
  const bestMatch = searchResults[0];
  console.error(
    `✅ Best match: ${bestMatch.c1} ${bestMatch.c2} ${bestMatch.c3} (score: ${bestMatch.score.toFixed(3)})`,
  );
  console.error(`   Description: ${bestMatch.description}`);

  if (searchResults.length > 1) {
    console.error("   Other candidates:");
    for (let i = 1; i < searchResults.length; i++) {
      const r = searchResults[i];
      console.error(
        `   - ${r.c1} ${r.c2} ${r.c3} (score: ${r.score.toFixed(3)})`,
      );
    }
  }

  // Step 3: Describe the command (using shared utility)
  const matchedCommands = describeCommand(
    commands,
    bestMatch.c1,
    bestMatch.c2,
    bestMatch.c3,
  );

  if (matchedCommands.length > 0 && matchedCommands[0].options) {
    console.error("   Available options:", JSON.stringify(matchedCommands[0].options));
  }

  // Step 4: Create command and execute
  const cmd: ClimptCommand = {
    agent: args.agent,
    c1: bestMatch.c1,
    c2: bestMatch.c2,
    c3: bestMatch.c3,
    options: args.options,
  };

  const subAgentName = generateSubAgentName(cmd);
  console.error(`🤖 Generated sub-agent name: ${subAgentName}`);

  // Step 5: Get prompt from Climpt CLI
  console.error(
    `📝 Fetching prompt: climpt --config=${cmd.c1} ${cmd.c2} ${cmd.c3}`,
  );
  const prompt = await getClimptPrompt(cmd);

  // Step 6: Run sub-agent
  const cwd = Deno.cwd();
  await runSubAgent(subAgentName, prompt, cwd);
}

// Execute main
if (import.meta.main) {
  main().catch((error) => {
    console.error("❌ Error:", error.message);
    Deno.exit(1);
  });
}
