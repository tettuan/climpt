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

// Standard library
import { ensureDir } from "jsr:@std/fs";
import { join } from "jsr:@std/path";

// Claude Agent SDK (npm package)
import { query } from "npm:@anthropic-ai/claude-agent-sdk";
import type { Options, SDKMessage } from "npm:@anthropic-ai/claude-agent-sdk";

// Plugin's own implementation (self-contained)
// @see docs/internal/registry-specification.md
// @see docs/internal/command-operations.md
import {
  type Command,
  describeCommand,
  loadMCPConfig,
  loadRegistryForAgent,
  searchCommands,
  type SearchResult,
} from "../../../lib/mod.ts";

// =============================================================================
// Logger
// =============================================================================

/**
 * Logger that writes to both stderr and file
 */
class Logger {
  private logFile: Deno.FsFile | null = null;
  private logPath: string = "";

  async init(logDir: string): Promise<void> {
    await ensureDir(logDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logPath = join(logDir, `climpt-agent-${timestamp}.log`);
    this.logFile = await Deno.open(this.logPath, {
      write: true,
      create: true,
      truncate: true,
    });
    await this.write(`[${new Date().toISOString()}] Log started: ${this.logPath}`);
  }

  async write(message: string): Promise<void> {
    const line = `${message}\n`;
    console.error(message);
    if (this.logFile) {
      await this.logFile.write(new TextEncoder().encode(line));
    }
  }

  async writeSection(title: string, content: string): Promise<void> {
    const separator = "=".repeat(60);
    await this.write(`\n${separator}`);
    await this.write(`${title}`);
    await this.write(separator);
    await this.write(content);
  }

  async close(): Promise<void> {
    if (this.logFile) {
      await this.write(`[${new Date().toISOString()}] Log ended`);
      this.logFile.close();
      this.logFile = null;
    }
  }

  getLogPath(): string {
    return this.logPath;
  }
}

const logger = new Logger();

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
  // Disable Statsig telemetry to avoid ~/.claude/statsig/ write permission issues
  // and remove dependency on sandbox allowlist configuration
  Deno.env.set("DISABLE_TELEMETRY", "1");

  // Redirect Claude config/session storage to sandbox-allowed path
  // This avoids EPERM errors when SDK spawns claude process
  // See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/84
  Deno.env.set("CLAUDE_CONFIG_DIR", "/tmp/claude");

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

  await logger.write(`🚀 Starting sub-agent: ${agentName}`);

  const queryResult = query({
    prompt,
    options,
  });

  // Check if SDK JSON errors should be strictly handled
  // Set STRICT_SDK_JSON=1 to throw on JSON parse errors instead of ignoring
  const strictJsonMode = Deno.env.get("STRICT_SDK_JSON") === "1";

  try {
    for await (const message of queryResult) {
      try {
        await handleMessage(message);
      } catch (error) {
        // SDK may emit malformed JSON during message handling
        // Known issue: https://github.com/anthropics/claude-agent-sdk-typescript/issues
        if (error instanceof SyntaxError && error.message.includes("JSON")) {
          await logger.write(`⚠️ SDK JSON parse warning in handler: ${error.message}`);
          if (strictJsonMode) {
            throw error;
          }
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    // SDK may emit malformed JSON during streaming iteration (typically at stream end)
    // Known issue: stream termination can produce incomplete JSON chunks
    if (error instanceof SyntaxError && error.message.includes("JSON")) {
      await logger.write(`⚠️ SDK JSON parse error in stream (task may have completed): ${error.message}`);
      if (strictJsonMode) {
        throw error;
      }
      // Don't throw - the sub-agent task likely completed despite the parse error
      return;
    }
    throw error;
  }
}

/**
 * Handle SDK message types
 *
 * SDKMessage types per SDK documentation:
 * - assistant: Model response with content blocks
 * - result: Task completion (success/error)
 * - system: Initialization info
 * - user: User message echo (ignored)
 * - stream_event: Partial streaming data (ignored)
 * - compact_boundary: Context compaction marker (ignored)
 */
async function handleMessage(message: SDKMessage): Promise<void> {
  switch (message.type) {
    case "assistant":
      if (message.message.content) {
        for (const block of message.message.content) {
          if (block.type === "text") {
            console.log(block.text);
            await logger.write(`[assistant] ${block.text}`);
          }
        }
      }
      break;

    case "result": {
      if (message.subtype === "success") {
        await logger.write(`✅ Completed. Cost: $${message.total_cost_usd.toFixed(4)}`);
      } else {
        await logger.write(`❌ Error: ${message.subtype}`);
        // Error result messages have 'errors' field
        const errors = (message as { errors?: string[] }).errors ?? [];
        if (errors.length > 0) {
          await logger.write(errors.join("\n"));
        }
      }
      break;
    }

    case "system":
      if (message.subtype === "init") {
        await logger.write(`[system] Session: ${message.session_id}, Model: ${message.model}`);
        // Log additional debugging info
        const msg = message as {
          permissionMode?: string;
          mcp_servers?: Array<{ name: string; status: string }>;
          tools?: string[];
        };
        if (msg.permissionMode) {
          await logger.write(`[system] Permission mode: ${msg.permissionMode}`);
        }
        if (msg.mcp_servers && msg.mcp_servers.length > 0) {
          const serverStatus = msg.mcp_servers
            .map((s) => `${s.name}(${s.status})`)
            .join(", ");
          await logger.write(`[system] MCP servers: ${serverStatus}`);
        }
      }
      break;

    // Intentionally ignored message types
    case "user":
      // User message echo - no action needed
      break;

    default:
      // Handle unknown/new message types gracefully
      // This covers: stream_event, compact_boundary, and future types
      await logger.write(`[debug] Ignored message type: ${(message as { type: string }).type}`);
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

  // Initialize logger
  const cwd = Deno.cwd();
  const logDir = join(cwd, "tmp", "logs");
  await logger.init(logDir);

  try {
    await logger.write(`🔍 Searching for: "${args.query}"`);
    await logger.write(`   Agent: ${args.agent}`);
    await logger.write(`   CWD: ${cwd}`);

    // Step 1: Load configuration and registry
    const mcpConfig = await loadMCPConfig();
    const commands = await loadRegistryForAgent(mcpConfig, args.agent);

    if (commands.length === 0) {
      await logger.write(`❌ No commands found for agent '${args.agent}'`);
      Deno.exit(1);
    }

    await logger.write(`   Found ${commands.length} commands in registry`);

    // Step 2: Search for matching commands (using shared utility)
    const searchResults: SearchResult[] = searchCommands(commands, args.query!);

    if (searchResults.length === 0) {
      await logger.write(`❌ No matching commands found for query: "${args.query}"`);
      Deno.exit(1);
    }

    // Select the best match
    const bestMatch = searchResults[0];
    await logger.write(
      `✅ Best match: ${bestMatch.c1} ${bestMatch.c2} ${bestMatch.c3} (score: ${bestMatch.score.toFixed(3)})`,
    );
    await logger.write(`   Description: ${bestMatch.description}`);

    if (searchResults.length > 1) {
      await logger.write("   Other candidates:");
      for (let i = 1; i < searchResults.length; i++) {
        const r = searchResults[i];
        await logger.write(
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
      await logger.write("   Available options: " + JSON.stringify(matchedCommands[0].options));
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
    await logger.write(`🤖 Generated sub-agent name: ${subAgentName}`);

    // Step 5: Get prompt from Climpt CLI
    await logger.write(
      `📝 Fetching prompt: climpt --config=${cmd.c1} ${cmd.c2} ${cmd.c3}`,
    );
    const prompt = await getClimptPrompt(cmd);

    await logger.writeSection("PROMPT", prompt);

    // Step 6: Run sub-agent
    await runSubAgent(subAgentName, prompt, cwd);

    await logger.write(`\n📄 Log file: ${logger.getLogPath()}`);
  } finally {
    await logger.close();
  }
}

// Execute main
if (import.meta.main) {
  main().catch(async (error) => {
    await logger.write(`❌ Error: ${error.message}`);
    if (error.stack) {
      await logger.write(error.stack);
    }
    await logger.close();
    Deno.exit(1);
  });
}
