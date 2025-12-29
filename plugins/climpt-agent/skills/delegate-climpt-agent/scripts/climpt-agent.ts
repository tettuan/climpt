#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys

/**
 * @fileoverview Climpt Agent - Multi-stage workflow sub-agent builder
 * @module climpt-plugins/skills/delegate-climpt-agent/scripts/climpt-agent
 *
 * This script implements a multi-stage workflow:
 * 1. Receives a natural language query describing the task
 * 2. Searches the command registry using shared MCP utilities
 * 3. Gets command details (describe)
 * 4. Resolves options using LLM (NEW: based on option-handling design)
 * 5. Executes the command to get the instruction prompt
 * 6. Runs a sub-agent using Claude Agent SDK with the prompt
 */

import { join } from "jsr:@std/path";

// Local modules
import { isDualQueryMode, parseArgs, validateArgs } from "./climpt-agent/cli.ts";
import {
  generateSubAgentName,
  getClimptPrompt,
} from "./climpt-agent/command.ts";
import { Logger } from "./climpt-agent/logger.ts";
import {
  extractStdinFromOptions,
  needsOptionResolution,
  resolveOptions,
  toCLIArgs,
} from "./climpt-agent/options-prompt.ts";
import { runSubAgent } from "./climpt-agent/sub-agent.ts";
import {
  extractAssistantMessages,
  generateSummary,
} from "./climpt-agent/summary.ts";
import type {
  ClimptCommand,
  CommandWithUV,
  PromptContext,
} from "./climpt-agent/types.ts";

// Plugin's shared library
import {
  describeCommand,
  loadMCPConfig,
  loadRegistryForAgent,
  type RRFResult,
  searchCommands,
  type SearchResult,
  searchWithRRF,
} from "../../../lib/mod.ts";

// =============================================================================
// Stdin Reading
// =============================================================================

/**
 * Read all content from stdin if piped (not interactive terminal)
 *
 * @returns stdin content or undefined if stdin is a terminal
 */
async function readStdinIfPiped(): Promise<string | undefined> {
  // If stdin is a terminal (interactive), don't read
  if (Deno.stdin.isTerminal()) {
    return undefined;
  }

  // Read all content from piped stdin using getReader() for TypeScript compatibility
  const chunks: Uint8Array[] = [];
  const reader = Deno.stdin.readable.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(combined);
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
 *
 * New: Uses LLM to resolve options based on user intent
 */
async function main(): Promise<void> {
  // Read stdin early (before any other async operations)
  const pipedStdinContent = await readStdinIfPiped();

  const args = parseArgs(Deno.args);
  validateArgs(args);

  // Initialize logger (JSONL format in tmp/logs/climpt-agents/)
  const cwd = Deno.cwd();
  const logDir = join(cwd, "tmp", "logs", "climpt-agents");
  const logger = new Logger();
  await logger.init(logDir);

  try {
    // Determine search mode and log parameters
    const useDualQuery = isDualQueryMode(args);
    if (useDualQuery) {
      await logger.write(`Search mode: RRF dual query`);
      await logger.write(`Query1 (action): "${args.query1}"`);
      await logger.write(`Query2 (target): "${args.query2}"`);
    } else {
      await logger.write(`Search mode: legacy single query`);
      await logger.write(`Searching for: "${args.query}"`);
    }
    await logger.write(`Intent: "${args.intent || args.query1 || args.query}"`);
    await logger.write(`Agent: ${args.agent}`);
    await logger.write(`CWD: ${cwd}`);
    await logger.write(`Piped stdin: ${pipedStdinContent ? `${pipedStdinContent.length} bytes` : "none"}`);

    // Step 1: Load configuration and registry
    const mcpConfig = await loadMCPConfig();
    const commands = await loadRegistryForAgent(mcpConfig, args.agent);

    if (commands.length === 0) {
      await logger.writeError(`No commands found for agent '${args.agent}'`);
      console.log(`No commands found for agent '${args.agent}'`);
      Deno.exit(1);
    }

    await logger.write(`Found ${commands.length} commands in registry`);

    // Step 2: Search for matching commands
    let bestMatch: SearchResult | RRFResult;
    let searchResults: (SearchResult | RRFResult)[];

    if (useDualQuery) {
      // RRF dual query mode
      const rrfResults = searchWithRRF(commands, [args.query1!, args.query2!]);
      if (rrfResults.length === 0) {
        await logger.writeError(
          `No matching commands found for queries: "${args.query1}", "${args.query2}"`,
        );
        console.log(`No matching commands found for queries: "${args.query1}", "${args.query2}"`);
        Deno.exit(1);
      }
      searchResults = rrfResults;
      bestMatch = rrfResults[0];

      await logger.write(
        `Best match: ${bestMatch.c1} ${bestMatch.c2} ${bestMatch.c3} (RRF score: ${
          bestMatch.score.toFixed(6)
        }, ranks: [${(bestMatch as RRFResult).ranks.join(", ")}])`,
        { description: bestMatch.description },
      );
    } else {
      // Legacy single query mode
      const singleResults = searchCommands(commands, args.query!);
      if (singleResults.length === 0) {
        await logger.writeError(
          `No matching commands found for query: "${args.query}"`,
        );
        console.log(`No matching commands found for query: "${args.query}"`);
        Deno.exit(1);
      }
      searchResults = singleResults;
      bestMatch = singleResults[0];

      await logger.write(
        `Best match: ${bestMatch.c1} ${bestMatch.c2} ${bestMatch.c3} (score: ${
          bestMatch.score.toFixed(3)
        })`,
        { description: bestMatch.description },
      );
    }

    if (searchResults.length > 1) {
      const otherCandidates = searchResults.slice(1).map((r) => ({
        command: `${r.c1} ${r.c2} ${r.c3}`,
        score: r.score,
        ...("ranks" in r ? { ranks: r.ranks } : {}),
      }));
      await logger.write("Other candidates", { candidates: otherCandidates });
    }

    // Step 3: Describe the command
    const matchedCommands = describeCommand(
      commands,
      bestMatch.c1,
      bestMatch.c2,
      bestMatch.c3,
    );

    if (matchedCommands.length === 0) {
      await logger.writeError("Command not found after describe");
      console.log("Command not found");
      Deno.exit(1);
    }

    const matchedCommand = matchedCommands[0] as CommandWithUV;

    if (matchedCommand.options) {
      await logger.write("Available options", {
        options: matchedCommand.options,
        uv: matchedCommand.uv,
      });
    }

    // Step 3.5: Resolve options using LLM (NEW)
    let resolvedCLIArgs: string[] = [];
    let llmGeneratedStdin: string | undefined;

    if (needsOptionResolution(matchedCommand)) {
      await logger.write("Command needs option resolution via LLM");

      const context: PromptContext = {
        workingDir: cwd,
        // files could be extracted from args or cwd in the future
      };

      // Use intent for option resolution, fallback to query (or query1 for dual mode)
      // At this point, validateArgs ensures we have at least query or query1+query2
      const intent = args.intent || args.query1 || args.query!;

      const resolvedOptions = await resolveOptions(
        matchedCommand,
        intent,
        context,
        logger,
      );

      // toCLIArgs excludes stdin (it must be piped, not passed as CLI arg)
      resolvedCLIArgs = toCLIArgs(resolvedOptions);
      llmGeneratedStdin = extractStdinFromOptions(resolvedOptions);

      await logger.write("Resolved CLI args", { args: resolvedCLIArgs });
      if (llmGeneratedStdin) {
        await logger.write("LLM generated stdin content", {
          length: llmGeneratedStdin.length,
        });
      }
    }

    // Step 4: Create command and execute
    // Determine stdin content:
    // 1. Priority: piped stdin (if command expects stdin and piped content exists)
    // 2. Fallback: LLM-generated stdin (if command expects stdin and no piped content)
    let stdinContent: string | undefined;
    if (matchedCommand.options?.stdin) {
      if (pipedStdinContent) {
        stdinContent = pipedStdinContent;
        await logger.write("Using piped stdin content");
      } else if (llmGeneratedStdin) {
        stdinContent = llmGeneratedStdin;
        await logger.write("Using LLM-generated stdin content");
      }
    }

    // CLI args from user override LLM-resolved args
    const cmd: ClimptCommand = {
      agent: args.agent,
      c1: bestMatch.c1,
      c2: bestMatch.c2,
      c3: bestMatch.c3,
      options: [...resolvedCLIArgs, ...args.options],
    };

    const subAgentName = generateSubAgentName(cmd);
    await logger.write(`Sub-agent name: ${subAgentName}`);

    await logger.write(
      `Fetching prompt: climpt --config=${cmd.c1} ${cmd.c2} ${cmd.c3}`,
      { options: cmd.options, hasStdin: !!stdinContent },
    );
    const prompt = await getClimptPrompt(cmd, stdinContent);

    await logger.writeSection("PROMPT", prompt);

    // Step 6: Run sub-agent
    await runSubAgent(subAgentName, prompt, cwd, logger);

    // Step 7: Generate and print summary
    const summary = logger.getSummary();

    if (summary.status === "success") {
      const assistantMessages = await extractAssistantMessages(
        logger.getLogPath(),
      );
      const summaryText = await generateSummary(
        assistantMessages,
        subAgentName,
      );

      console.log(`${subAgentName}`);
      console.log(summaryText);
    } else {
      console.log(`${subAgentName}: ${summary.status}`);
    }

    await logger.write(`Summary printed to stdout`);
  } finally {
    await logger.close();
  }
}

// Execute main
if (import.meta.main) {
  const logger = new Logger();
  main().catch(async (error) => {
    await logger.writeError(error.message, { stack: error.stack });
    console.log(`Error: ${error.message}`);
    console.log(`Log: ${logger.getLogPath()}`);
    await logger.close();
    Deno.exit(1);
  });
}
