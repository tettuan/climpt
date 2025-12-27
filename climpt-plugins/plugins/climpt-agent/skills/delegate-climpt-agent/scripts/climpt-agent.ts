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
 * Log entry for JSONL format
 */
interface LogEntry {
  timestamp: string;
  level: "info" | "error" | "debug" | "assistant" | "system" | "result";
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Logger that writes JSONL to file and summary to stderr
 */
class Logger {
  private logFile: Deno.FsFile | null = null;
  private logPath: string = "";
  private assistantMessages: string[] = [];
  private resultCost: number = 0;
  private resultStatus: "success" | "error" | "pending" = "pending";

  async init(logDir: string): Promise<void> {
    await ensureDir(logDir);

    // Rotate old logs if needed
    await this.rotateLogs(logDir, 100);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logPath = join(logDir, `climpt-agent-${timestamp}.jsonl`);
    this.logFile = await Deno.open(this.logPath, {
      write: true,
      create: true,
      truncate: true,
    });
    await this.writeLog("info", "Log started", { logPath: this.logPath });
  }

  /**
   * Rotate logs: keep only the most recent N files
   */
  private async rotateLogs(logDir: string, maxFiles: number): Promise<void> {
    const files: Array<{ name: string; mtime: Date }> = [];

    try {
      for await (const entry of Deno.readDir(logDir)) {
        if (entry.isFile && entry.name.endsWith(".jsonl")) {
          const filePath = join(logDir, entry.name);
          const stat = await Deno.stat(filePath);
          files.push({ name: filePath, mtime: stat.mtime || new Date(0) });
        }
      }
    } catch {
      // Directory doesn't exist or can't be read - that's okay
      return;
    }

    // Sort by modification time (newest first)
    files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // Delete files beyond the limit
    for (let i = maxFiles; i < files.length; i++) {
      try {
        await Deno.remove(files[i].name);
      } catch {
        // Ignore deletion errors
      }
    }
  }

  private async writeLog(
    level: LogEntry["level"],
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(metadata && { metadata }),
    };

    if (this.logFile) {
      const line = JSON.stringify(entry) + "\n";
      await this.logFile.write(new TextEncoder().encode(line));
    }
  }

  async write(message: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.writeLog("info", message, metadata);
  }

  async writeAssistant(message: string): Promise<void> {
    this.assistantMessages.push(message);
    await this.writeLog("assistant", message);
  }

  async writeSystem(message: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.writeLog("system", message, metadata);
  }

  async writeResult(status: "success" | "error", cost?: number, metadata?: Record<string, unknown>): Promise<void> {
    this.resultStatus = status;
    if (cost !== undefined) {
      this.resultCost = cost;
    }
    await this.writeLog("result", status === "success" ? "Completed" : "Failed", {
      status,
      ...(cost !== undefined && { cost }),
      ...metadata,
    });
  }

  async writeError(message: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.writeLog("error", message, metadata);
  }

  async writeSection(title: string, content: string): Promise<void> {
    await this.writeLog("info", title, { content });
  }

  async close(): Promise<void> {
    if (this.logFile) {
      await this.writeLog("info", "Log ended");
      this.logFile.close();
      this.logFile = null;
    }
  }

  getLogPath(): string {
    return this.logPath;
  }

  getSummary(): { status: string; cost: number; messageCount: number } {
    return {
      status: this.resultStatus,
      cost: this.resultCost,
      messageCount: this.assistantMessages.length,
    };
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
 * Read JSONL log and extract assistant messages
 */
async function extractAssistantMessages(logPath: string): Promise<string[]> {
  const messages: string[] = [];
  const logContent = await Deno.readTextFile(logPath);

  for (const line of logContent.split('\n')) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);
      if (entry.level === 'assistant') {
        messages.push(entry.message);
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  return messages;
}

/**
 * Generate summary of sub-agent execution
 */
async function generateSummary(messages: string[], subAgentName: string): Promise<string> {
  const prompt = `Based on the following messages from a sub-agent task (${subAgentName}), provide a concise summary:

1. What was accomplished?
2. What are the key results or next steps?

Keep the summary brief and actionable.

Messages:
${messages.join('\n\n')}`;

  const queryResult = query({
    prompt,
    options: {
      model: "claude-sonnet-4-5-20250929",
      allowedTools: [], // No tools needed for summary
      systemPrompt: "You are a helpful assistant that summarizes task execution results concisely.",
    },
  });

  let summaryText = "";
  for await (const message of queryResult) {
    if (message.type === "assistant" && message.message.content) {
      for (const block of message.message.content) {
        if (block.type === "text") {
          summaryText += block.text;
        }
      }
    }
  }

  return summaryText;
}

/**
 * Run Claude Agent SDK with the obtained prompt
 */
async function runSubAgent(
  agentName: string,
  prompt: string,
  cwd: string,
): Promise<void> {
  // Note: When running from Claude Code's sandbox, the parent sandbox restrictions
  // are inherited. The SDK's sandbox option only controls the child's command execution,
  // not the parent sandbox. To run this script from Claude Code, you must use:
  //   Bash tool with dangerouslyDisableSandbox: true

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
          await logger.writeError(`SDK JSON parse warning in handler: ${error.message}`);
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
      await logger.writeError(`SDK JSON parse error in stream (task may have completed): ${error.message}`);
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
            // Only log to file, not to stdout (summary will be printed later)
            await logger.writeAssistant(block.text);
          }
        }
      }
      break;

    case "result": {
      if (message.subtype === "success") {
        await logger.writeResult("success", message.total_cost_usd);
      } else {
        const errors = (message as { errors?: string[] }).errors ?? [];
        await logger.writeResult("error", undefined, { errors });
      }
      break;
    }

    case "system":
      if (message.subtype === "init") {
        const msg = message as {
          session_id: string;
          model: string;
          permissionMode?: string;
          mcp_servers?: Array<{ name: string; status: string }>;
          tools?: string[];
        };
        await logger.writeSystem(`Session: ${msg.session_id}, Model: ${msg.model}`, {
          permissionMode: msg.permissionMode,
          mcp_servers: msg.mcp_servers,
        });
      }
      break;

    // Intentionally ignored message types
    case "user":
      // User message echo - no action needed
      break;

    default:
      // Handle unknown/new message types gracefully
      // This covers: stream_event, compact_boundary, and future types
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

  // Initialize logger (JSONL format in tmp/logs/climpt-agents/)
  const cwd = Deno.cwd();
  const logDir = join(cwd, "tmp", "logs", "climpt-agents");
  await logger.init(logDir);

  try {
    await logger.write(`Searching for: "${args.query}"`);
    await logger.write(`Agent: ${args.agent}`);
    await logger.write(`CWD: ${cwd}`);

    // Step 1: Load configuration and registry
    const mcpConfig = await loadMCPConfig();
    const commands = await loadRegistryForAgent(mcpConfig, args.agent);

    if (commands.length === 0) {
      await logger.writeError(`No commands found for agent '${args.agent}'`);
      console.log(`❌ No commands found for agent '${args.agent}'`);
      Deno.exit(1);
    }

    await logger.write(`Found ${commands.length} commands in registry`);

    // Step 2: Search for matching commands (using shared utility)
    const searchResults: SearchResult[] = searchCommands(commands, args.query!);

    if (searchResults.length === 0) {
      await logger.writeError(`No matching commands found for query: "${args.query}"`);
      console.log(`❌ No matching commands found for query: "${args.query}"`);
      Deno.exit(1);
    }

    // Select the best match
    const bestMatch = searchResults[0];
    await logger.write(
      `Best match: ${bestMatch.c1} ${bestMatch.c2} ${bestMatch.c3} (score: ${bestMatch.score.toFixed(3)})`,
      { description: bestMatch.description }
    );

    if (searchResults.length > 1) {
      const otherCandidates = searchResults.slice(1).map((r) => ({
        command: `${r.c1} ${r.c2} ${r.c3}`,
        score: r.score,
      }));
      await logger.write("Other candidates", { candidates: otherCandidates });
    }

    // Step 3: Describe the command (using shared utility)
    const matchedCommands = describeCommand(
      commands,
      bestMatch.c1,
      bestMatch.c2,
      bestMatch.c3,
    );

    if (matchedCommands.length > 0 && matchedCommands[0].options) {
      await logger.write("Available options", { options: matchedCommands[0].options });
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
    await logger.write(`Sub-agent name: ${subAgentName}`);

    // Step 5: Get prompt from Climpt CLI
    await logger.write(
      `Fetching prompt: climpt --config=${cmd.c1} ${cmd.c2} ${cmd.c3}`,
    );
    const prompt = await getClimptPrompt(cmd);

    await logger.writeSection("PROMPT", prompt);

    // Step 6: Run sub-agent
    await runSubAgent(subAgentName, prompt, cwd);

    // Step 7: Generate and print summary
    const summary = logger.getSummary();

    if (summary.status === "success") {
      const assistantMessages = await extractAssistantMessages(logger.getLogPath());
      const summaryText = await generateSummary(assistantMessages, subAgentName);

      console.log(`✅ ${subAgentName}`);
      console.log(summaryText);
    } else {
      console.log(`❌ ${subAgentName}: ${summary.status}`);
    }

    await logger.write(`Summary printed to stdout`);
  } finally {
    await logger.close();
  }
}

// Execute main
if (import.meta.main) {
  main().catch(async (error) => {
    await logger.writeError(error.message, { stack: error.stack });
    console.log(`❌ Error: ${error.message}`);
    console.log(`📄 Log: ${logger.getLogPath()}`);
    await logger.close();
    Deno.exit(1);
  });
}
