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
} from "./config.ts";
import { createLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";
import {
  buildSystemPrompt,
  buildInitialPrompt,
  buildContinuationPrompt,
} from "./prompts.ts";
import { isIssueComplete, isProjectComplete } from "./github.ts";
import type { AgentOptions, CompletionType } from "./types.ts";

/**
 * Main agent loop
 */
async function main(): Promise<void> {
  // Check for help flag
  if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
    displayHelp();
    Deno.exit(0);
  }

  let logger: Logger | null = null;

  try {
    // 1. Parse CLI arguments
    const options = parseCliArgs(Deno.args);

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

  console.log(`\n🤖 Starting Iterate Agent (${options.agentName})\n`);
  console.log(`📋 Completion criteria: ${getCompletionDescription(options)}`);
  console.log(`📝 Logs: ${logger.getLogPath()}\n`);

  // Main iteration loop: each iteration = one complete query() session
  while (!isComplete && iterationCount < options.iterateMax) {
    const iterationNumber = iterationCount + 1;
    console.log(`\n🔄 Starting iteration ${iterationNumber}\n`);
    await logger.write("info", `Starting iteration ${iterationNumber}`);

    // Start new SDK query session for this iteration
    // Using minimal options as per SDK documentation
    const queryIterator = query({
      prompt: currentPrompt,
      options: {
        cwd: Deno.cwd(),
        allowedTools: agentConfig.allowedTools,
        permissionMode: agentConfig.permissionMode,
        systemPrompt: systemPrompt,
      },
    });

    // Process all SDK messages in this session
    try {
      for await (const message of queryIterator) {
        await logSDKMessage(message, logger);

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

    // Prepare prompt for next iteration
    currentPrompt = buildContinuationPrompt(options, iterationCount);
    await logger.write("debug", "Prepared continuation prompt for next iteration");
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
