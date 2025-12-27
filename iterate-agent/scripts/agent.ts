/**
 * Iterate Agent - Main Entry Point
 *
 * Autonomous agent that executes development cycles through iterations.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { parseCliArgs, displayHelp } from "./cli.ts";
import {
  loadConfig,
  getAgentConfig,
  loadSystemPromptTemplate,
  ensureLogDirectory,
  initializeConfig,
} from "./config.ts";
import { createLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";
import {
  buildSystemPrompt,
  buildInitialPrompt,
  buildContinuationPrompt,
} from "./prompts.ts";
import { isIssueComplete, isProjectComplete } from "./github.ts";
import type { AgentOptions, CompletionType, IterationSummary } from "./types.ts";

/**
 * Main agent loop
 */
async function main(): Promise<void> {
  let logger: Logger | null = null;

  try {
    // 1. Parse CLI arguments
    const parsed = parseCliArgs(Deno.args);

    // Handle --help flag
    if (parsed.help) {
      displayHelp();
      Deno.exit(0);
    }

    // Handle --init flag
    if (parsed.init) {
      console.log("\n📦 Initializing iterate-agent configuration...\n");
      const { configPath, promptPath } = await initializeConfig();
      console.log(`✅ Created: ${configPath}`);
      console.log(`✅ Created: ${promptPath}`);
      console.log("\n🎉 Initialization complete!\n");
      console.log("Next steps:");
      console.log("  1. Review and customize the configuration in iterate-agent/config.json");
      console.log("  2. Set GITHUB_TOKEN environment variable");
      console.log("  3. Run: deno run -A jsr:@aidevtool/climpt/agents/iterator --issue <number>\n");
      Deno.exit(0);
    }

    // Ensure options are available for normal execution
    if (!parsed.options) {
      console.error("Error: No options provided. Use --help for usage information.");
      Deno.exit(1);
    }

    const options = parsed.options;

    // 2. Load configuration
    const config = await loadConfig();
    const agentConfig = getAgentConfig(config, options.agentName);

    // 3. Initialize logger
    const logDir = await ensureLogDirectory(config, options.agentName);
    logger = await createLogger(logDir, options.agentName, config.logging.maxFiles);

    await logger.write("info", "Iterate agent started", {
      agentName: options.agentName,
      issue: options.issue,
      project: options.project,
      iterateMax: options.iterateMax,
    });

    // 4. Load and build system prompt
    const templateContent = await loadSystemPromptTemplate(agentConfig);
    const systemPrompt = buildSystemPrompt(templateContent, options);

    await logger.write("debug", "System prompt built", {
      promptLength: systemPrompt.length,
    });

    // 5. Build initial prompt
    const initialPrompt = await buildInitialPrompt(options);

    await logger.write("debug", "Initial prompt built", {
      promptLength: initialPrompt.length,
    });

    // 6. Run agent loop
    await runAgentLoop(options, config, agentConfig, systemPrompt, initialPrompt, logger);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Error: ${errorMessage}\n`);

    if (logger) {
      await logger.write("error", "Fatal error", {
        error: {
          name: error instanceof Error ? error.name : "Unknown",
          message: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
      await logger.close();
    }

    Deno.exit(1);
  }
}

/**
 * Run the autonomous agent loop
 *
 * Each iteration = one complete query() session.
 * The loop creates new SDK sessions until completion criteria are met.
 */
async function runAgentLoop(
  options: AgentOptions,
  config: any,
  agentConfig: any,
  systemPrompt: string,
  initialPrompt: string,
  logger: Logger
): Promise<void> {
  let iterationCount = 0;
  let isComplete = false;
  let currentPrompt = initialPrompt;
  let previousSummary: IterationSummary | undefined = undefined;

  console.log(`\n🤖 Starting Iterate Agent (${options.agentName})\n`);
  console.log(`📋 Completion criteria: ${getCompletionDescription(options)}`);
  console.log(`📝 Logs: ${logger.getLogPath()}\n`);

  // Main iteration loop: each iteration = one complete query() session
  while (!isComplete && iterationCount < options.iterateMax) {
    const iterationNumber = iterationCount + 1;
    console.log(`\n🔄 Starting iteration ${iterationNumber}\n`);
    await logger.write("info", `Starting iteration ${iterationNumber}`);

    // Initialize iteration summary to capture results
    const summary: IterationSummary = {
      iteration: iterationNumber,
      assistantResponses: [],
      toolsUsed: [],
      errors: [],
    };

    // Start new SDK query session for this iteration
    // Using minimal options as per SDK documentation
    const queryIterator = query({
      prompt: currentPrompt,
      options: {
        cwd: Deno.cwd(),
        allowedTools: agentConfig.allowedTools,
        permissionMode: agentConfig.permissionMode,
        systemPrompt: systemPrompt,
        settingSources: ["user", "project"], // Load Skills from filesystem
      },
    });

    // Process all SDK messages in this session
    try {
      for await (const message of queryIterator) {
        await logSDKMessage(message, logger);

        // Capture iteration data for handoff to next iteration
        captureIterationData(message, summary);

        // Log Skill invocations but don't count them as iterations
        if (isSkillInvocation(message)) {
          await logger.write("debug", "Skill invoked within iteration");
        }
      }
    } catch (error) {
      await logger.write("error", "Error processing SDK messages", {
        errorName: error instanceof Error ? error.name : "Unknown",
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }

    // Session completed = iteration completed
    iterationCount++;
    console.log(`\n✅ Iteration ${iterationCount} completed\n`);
    await logger.write("info", `Iteration ${iterationCount} completed`);

    // Check completion criteria
    isComplete = await checkCompletionCriteria(options, iterationCount, logger);

    if (isComplete) {
      console.log(`\n🎉 Completion criteria met!\n`);
      break;
    }

    // Check iteration limit
    if (iterationCount >= options.iterateMax) {
      console.log(`\n⏹️  Maximum iterations (${options.iterateMax}) reached\n`);
      break;
    }

    // Store summary for next iteration
    previousSummary = summary;

    // Prepare prompt for next iteration with previous summary
    currentPrompt = buildContinuationPrompt(options, iterationCount, previousSummary);
    await logger.write("debug", "Prepared continuation prompt for next iteration", {
      previousIteration: previousSummary.iteration,
      toolsUsed: previousSummary.toolsUsed,
      responsesCount: previousSummary.assistantResponses.length,
      errorsCount: previousSummary.errors.length,
    });
  }

  // Final summary
  await logger.write("result", "Iterate agent loop completed", {
    totalIterations: iterationCount,
    completionReason: isComplete ? "criteria_met" : "max_iterations",
  });

  console.log(`\n📊 Summary:`);
  console.log(`   Total iterations: ${iterationCount}`);
  console.log(`   Completion: ${isComplete ? "✅ Criteria met" : "⏹️  Max iterations"}\n`);

  await logger.close();
}

/**
 * Check if message contains Skill invocation
 */
function isSkillInvocation(message: any): boolean {
  if (!message.message?.content) return false;

  const content = Array.isArray(message.message.content)
    ? message.message.content
    : [message.message.content];

  return content.some(
    (block: any) =>
      block.type === "tool_use" &&
      block.name === "Skill" &&
      block.input?.skill === "climpt-agent:delegate-climpt-agent"
  );
}

/**
 * Extract meaningful data from SDK message for iteration summary
 */
function captureIterationData(message: any, summary: IterationSummary): void {
  // Capture assistant text responses and tool uses
  if (message.message?.role === "assistant") {
    const content = message.message.content;
    const blocks = Array.isArray(content) ? content : [];

    // Extract text blocks
    const textBlocks = blocks.filter((b: any) => b.type === "text");
    const text = textBlocks.map((b: any) => b.text).join("\n").trim();
    if (text && text.length > 0) {
      summary.assistantResponses.push(text);
    }

    // Extract tool uses (unique tool names only)
    const toolUses = blocks.filter((b: any) => b.type === "tool_use");
    for (const tool of toolUses) {
      if (tool.name && !summary.toolsUsed.includes(tool.name)) {
        summary.toolsUsed.push(tool.name);
      }
    }
  }

  // Capture final result
  if (message.type === "result") {
    summary.finalResult = message.result || undefined;
  }

  // Capture errors from tool results
  if (message.message?.role === "user") {
    const content = message.message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_result" && block.is_error) {
          summary.errors.push(String(block.content || "Unknown error"));
        }
      }
    }
  }
}

/**
 * Log SDK message
 */
async function logSDKMessage(message: any, logger: Logger): Promise<void> {
  // Remove apiKeySource from message before logging
  const sanitizedMessage = { ...message };
  if (sanitizedMessage.apiKeySource !== undefined) {
    delete sanitizedMessage.apiKeySource;
  }

  // Log raw message for debugging
  await logger.write("debug", "Raw SDK message", {
    rawMessage: JSON.stringify(sanitizedMessage, null, 2),
    messageType: message.type,
    messageRole: message.message?.role,
  });

  // Determine message type and extract content
  if (message.type === "result") {
    await logger.write("result", message.result || "(empty result)");
  } else if (message.message?.role === "assistant") {
    // Extract text content from assistant message
    const content = message.message.content;
    const textBlocks = Array.isArray(content)
      ? content.filter((b: any) => b.type === "text")
      : [];
    const text = textBlocks.map((b: any) => b.text).join("\n");

    if (text) {
      await logger.write("assistant", text);
    }
  } else if (message.message?.role === "user") {
    const content = typeof message.message.content === "string"
      ? message.message.content
      : JSON.stringify(message.message.content);
    await logger.write("user", content);
  } else {
    // Generic system message (with apiKeySource removed)
    await logger.write("system", JSON.stringify(sanitizedMessage));
  }
}

/**
 * Check completion criteria
 */
async function checkCompletionCriteria(
  options: AgentOptions,
  iterationCount: number,
  logger: Logger
): Promise<boolean> {
  const { issue, project, iterateMax } = options;

  let type: CompletionType;
  let complete = false;
  let current = iterationCount;
  let target = iterateMax;

  if (issue !== undefined) {
    type = "issue";
    target = issue;
    complete = await isIssueComplete(issue);
  } else if (project !== undefined) {
    type = "project";
    target = project;
    complete = await isProjectComplete(project);
  } else {
    type = "iterate";
    complete = iterationCount >= iterateMax;
  }

  await logger.write("debug", "Completion criteria checked", {
    completionCheck: {
      type,
      current,
      target,
      complete,
    },
  });

  return complete;
}

/**
 * Get human-readable completion description
 */
function getCompletionDescription(options: AgentOptions): string {
  if (options.issue !== undefined) {
    return `Close Issue #${options.issue}`;
  } else if (options.project !== undefined) {
    return `Complete Project #${options.project}`;
  } else {
    const max = options.iterateMax === Infinity ? "unlimited" : options.iterateMax;
    return `Execute ${max} iterations`;
  }
}

// Run main
if (import.meta.main) {
  main();
}
