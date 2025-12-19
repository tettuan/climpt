#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys

/**
 * @fileoverview Climpt Agent - Dynamic sub-agent builder using Claude Agent SDK
 * @module climpt-plugins/skills/delegate-climpt-agent/scripts/climpt-agent
 *
 * This script:
 * 1. Receives C3L command parameters (agent, c1, c2, c3, options)
 * 2. Calls Climpt CLI to get the instruction prompt
 * 3. Dynamically constructs a sub-agent with the prompt
 * 4. Runs the sub-agent using Claude Agent SDK
 */

// Claude Agent SDK is only available as npm package (no JSR version)
// Deno 2.x uses npm: specifier
import { query } from "npm:@anthropic-ai/claude-agent-sdk";
import type { Options, SDKMessage } from "npm:@anthropic-ai/claude-agent-sdk";

/**
 * Command parameters for Climpt execution
 *
 * C3L (Command 3-Level) Structure:
 * - agent: MCP server identifier (e.g., "climpt", "inspector")
 * - c1: Domain identifier (e.g., "git", "meta", "spec")
 * - c2: Action identifier (e.g., "group-commit", "build")
 * - c3: Target identifier (e.g., "unstaged-changes", "frontmatter")
 *
 * Full command format: <agent> <c1> <c2> <c3>
 * Sub-agent name format: <agent>-<c1>-<c2>-<c3>
 */
interface ClimptCommand {
  /** Agent name - MCP server identifier (e.g., "climpt", "inspector") */
  agent: string;
  /** Domain identifier - e.g., "git", "meta", "spec" */
  c1: string;
  /** Action identifier - e.g., "group-commit", "build" */
  c2: string;
  /** Target identifier - e.g., "unstaged-changes", "frontmatter" */
  c3: string;
  /** Optional command options */
  options?: string[];
}

/**
 * Generate sub-agent name following C3L naming convention
 * Format: <agent>-<c1>-<c2>-<c3>
 *
 * @example
 * // Returns "climpt-git-group-commit-unstaged-changes"
 * generateSubAgentName({ agent: "climpt", c1: "git", c2: "group-commit", c3: "unstaged-changes" })
 */
function generateSubAgentName(cmd: ClimptCommand): string {
  return `${cmd.agent}-${cmd.c1}-${cmd.c2}-${cmd.c3}`;
}

/**
 * Execute Climpt command via CLI and get the instruction prompt
 *
 * Climpt CLI is invoked via jsr:@aidevtool/climpt with the following format:
 * deno run jsr:@aidevtool/climpt --config=<configParam> <c2> <c3> [options]
 *
 * Config parameter construction (C3L v0.5 specification):
 * - If agent is "climpt": configParam = c1 (e.g., "git")
 * - Otherwise: configParam = agent-c1 (e.g., "inspector-git")
 *
 * @param cmd - Command parameters
 * @returns The instruction prompt text
 */
async function getClimptPrompt(cmd: ClimptCommand): Promise<string> {
  // Construct config parameter based on C3L v0.5 specification
  // If agent is "climpt", use c1 directly; otherwise prepend agent
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
 *
 * API Reference (Official documentation):
 * - query({ prompt, options }): Returns AsyncGenerator of SDKMessage
 * - Options.settingSources: Default is [] (loads nothing)
 * - Options.allowedTools: Array of allowed tool names
 *
 * @param agentName - Name for the sub-agent (for logging)
 * @param prompt - The instruction prompt from Climpt
 * @param cwd - Working directory for the sub-agent
 */
async function runSubAgent(
  agentName: string,
  prompt: string,
  cwd: string,
): Promise<void> {
  // Official API: Use Options type (not ClaudeAgentOptions)
  const options: Options = {
    cwd,
    // settingSources: Default is [] (loads nothing from filesystem)
    // Load project settings when needed
    settingSources: ["project"],
    // Allowed tools for the sub-agent
    allowedTools: [
      "Skill", // Can invoke other Skills
      "Read", // File reading
      "Write", // File writing
      "Edit", // File editing
      "Bash", // Shell command execution
      "Glob", // File pattern matching
      "Grep", // Text search
      "Task", // Sub-agent spawning
    ],
    // Use Claude Code's system prompt
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
    },
  };

  console.error(`Starting sub-agent: ${agentName}`);

  // Official API: query({ prompt, options }) format
  const queryResult = query({
    prompt,
    options,
  });

  // Stream messages from AsyncGenerator
  for await (const message of queryResult) {
    handleMessage(message);
  }
}

/**
 * Handle SDK message types
 *
 * Message types:
 * - assistant: Claude's response content
 * - result: Final result (success or error)
 * - system: System messages (init, etc.)
 */
function handleMessage(message: SDKMessage): void {
  switch (message.type) {
    case "assistant":
      // Assistant response
      if (message.message.content) {
        for (const block of message.message.content) {
          if (block.type === "text") {
            console.log(block.text);
          }
        }
      }
      break;
    case "result":
      // Final result
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
      // System message (init, etc.)
      if (message.subtype === "init") {
        console.error(
          `Session: ${message.session_id}, Model: ${message.model}`,
        );
      }
      break;
  }
}

/**
 * Parse command line arguments
 *
 * Expected format:
 * --agent=<agent> --c1=<c1> --c2=<c2> --c3=<c3> [--options=<opt1,opt2,...>]
 */
function parseArgs(args: string[]): ClimptCommand {
  const cmd: ClimptCommand = {
    agent: "",
    c1: "",
    c2: "",
    c3: "",
    options: [],
  };

  for (const arg of args) {
    if (arg.startsWith("--agent=")) {
      cmd.agent = arg.slice(8);
    } else if (arg.startsWith("--c1=")) {
      cmd.c1 = arg.slice(5);
    } else if (arg.startsWith("--c2=")) {
      cmd.c2 = arg.slice(5);
    } else if (arg.startsWith("--c3=")) {
      cmd.c3 = arg.slice(5);
    } else if (arg.startsWith("--options=")) {
      cmd.options = arg.slice(10).split(",");
    }
  }

  return cmd;
}

/**
 * Validate required parameters
 */
function validateCommand(cmd: ClimptCommand): void {
  if (!cmd.agent || !cmd.c1 || !cmd.c2 || !cmd.c3) {
    console.error(
      "Usage: climpt-agent.ts --agent=<name> --c1=<c1> --c2=<c2> --c3=<c3> [--options=...]",
    );
    console.error("");
    console.error("Parameters:");
    console.error('  --agent  Agent name (always "climpt")');
    console.error("  --c1     Domain identifier (e.g., climpt-git, climpt-meta)");
    console.error("  --c2     Action identifier (e.g., group-commit, build)");
    console.error("  --c3     Target identifier (e.g., unstaged-changes, frontmatter)");
    console.error("  --options  Comma-separated list of options (optional)");
    Deno.exit(1);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Parse command line arguments
  const cmd = parseArgs(Deno.args);

  // Validate required parameters
  validateCommand(cmd);

  // Generate sub-agent name using C3L naming
  const subAgentName = generateSubAgentName(cmd);
  console.error(`Generated sub-agent name: ${subAgentName}`);

  // Get prompt from Climpt
  console.error(`Fetching prompt for: ${cmd.c1} ${cmd.c2} ${cmd.c3}`);
  const prompt = await getClimptPrompt(cmd);

  // Run sub-agent with the prompt
  const cwd = Deno.cwd();
  await runSubAgent(subAgentName, prompt, cwd);
}

// Execute main
if (import.meta.main) {
  main().catch((error) => {
    console.error("Error:", error.message);
    Deno.exit(1);
  });
}
