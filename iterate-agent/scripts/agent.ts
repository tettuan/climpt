/**
 * Iterate Agent - Main Entry Point
 *
 * Autonomous agent that executes development cycles through iterations.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { displayHelp, parseCliArgs } from "./cli.ts";
import {
  type CompletionHandler,
  createCompletionHandler,
} from "./completion/mod.ts";
import { IterateCompletionHandler } from "./completion/iterate.ts";
import {
  ensureLogDirectory,
  getAgentConfig,
  initializeConfig,
  loadConfig,
  loadSystemPromptTemplate,
} from "./config.ts";
import { createLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";
import {
  captureIterationData,
  isSkillInvocation,
  logSDKMessage,
} from "./message-handler.ts";
import { buildSystemPrompt } from "./prompts.ts";
import type {
  AgentConfig,
  AgentOptions,
  IterateAgentConfig,
  IterationSummary,
} from "./types.ts";

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
      console.log(
        "  1. Review and customize the configuration in iterate-agent/config.json",
      );
      console.log("  2. Set GITHUB_TOKEN environment variable");
      console.log(
        "  3. Run: deno run -A jsr:@aidevtool/climpt/agents/iterator --issue <number>\n",
      );
      Deno.exit(0);
    }

    // Ensure options are available for normal execution
    if (!parsed.options) {
      console.error(
        "Error: No options provided. Use --help for usage information.",
      );
      Deno.exit(1);
    }

    const options = parsed.options;

    // 2. Load configuration
    const config = await loadConfig();
    const agentConfig = getAgentConfig(config, options.agentName);

    // 3. Initialize logger
    const logDir = await ensureLogDirectory(config, options.agentName);
    logger = await createLogger(
      logDir,
      options.agentName,
      config.logging.maxFiles,
    );

    await logger.write("info", "Iterate agent started", {
      agentName: options.agentName,
      issue: options.issue,
      project: options.project,
      iterateMax: options.iterateMax,
      resume: options.resume,
    });

    // 4. Create completion handler
    const completionHandler = createCompletionHandler(options);

    await logger.write("debug", "Completion handler created", {
      type: completionHandler.type,
    });

    // 5. Load and build system prompt
    const templateContent = await loadSystemPromptTemplate(agentConfig);
    const systemPrompt = buildSystemPrompt(
      templateContent,
      completionHandler,
      options.agentName,
    );

    await logger.write("debug", "System prompt built", {
      promptLength: systemPrompt.length,
    });

    // 6. Build initial prompt
    const initialPrompt = await completionHandler.buildInitialPrompt();

    await logger.write("debug", "Initial prompt built", {
      promptLength: initialPrompt.length,
    });

    // 7. Run agent loop
    await runAgentLoop(
      options,
      config,
      agentConfig,
      completionHandler,
      systemPrompt,
      initialPrompt,
      logger,
    );
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
  _config: IterateAgentConfig,
  agentConfig: AgentConfig,
  completionHandler: CompletionHandler,
  systemPrompt: string,
  initialPrompt: string,
  logger: Logger,
): Promise<void> {
  let iterationCount = 0;
  let isComplete = false;
  let currentPrompt = initialPrompt;
  let previousSummary: IterationSummary | undefined = undefined;
  let previousSessionId: string | undefined = undefined;

  // Get initial completion description
  const completionDescription = await completionHandler
    .getCompletionDescription();

  console.log(`\n🤖 Starting Iterate Agent (${options.agentName})\n`);
  console.log(`📋 Completion criteria: ${completionDescription}`);
  console.log(`🔄 Resume mode: ${options.resume ? "enabled" : "disabled"}`);
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

    // Start SDK query session for this iteration
    // Use resume option if enabled and we have a previous session ID
    const shouldResume = options.resume && previousSessionId !== undefined;
    const queryOptions: Record<string, unknown> = {
      cwd: Deno.cwd(),
      allowedTools: agentConfig.allowedTools,
      permissionMode: agentConfig.permissionMode,
      systemPrompt: systemPrompt,
      settingSources: ["user", "project"], // Load Skills from filesystem
    };

    if (shouldResume) {
      queryOptions.resume = previousSessionId;
      await logger.write("debug", "Resuming previous session", {
        sessionId: previousSessionId,
      });
    }

    const queryIterator = query({
      prompt: currentPrompt,
      options: queryOptions,
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

    // Update iteration count for IterateCompletionHandler
    if (completionHandler instanceof IterateCompletionHandler) {
      completionHandler.setCurrentIteration(iterationCount);
    }

    // Check completion criteria using handler
    isComplete = await completionHandler.isComplete();

    await logger.write("debug", "Completion criteria checked", {
      type: completionHandler.type,
      complete: isComplete,
      iteration: iterationCount,
    });

    if (isComplete) {
      console.log(`\n🎉 Completion criteria met!\n`);
      break;
    }

    // Check iteration limit
    if (iterationCount >= options.iterateMax) {
      console.log(`\n⏹️  Maximum iterations (${options.iterateMax}) reached\n`);
      break;
    }

    // Store summary and session ID for next iteration
    previousSummary = summary;
    previousSessionId = summary.sessionId;

    // Prepare prompt for next iteration with previous summary using handler
    currentPrompt = completionHandler.buildContinuationPrompt(
      iterationCount,
      previousSummary,
    );
    await logger.write(
      "debug",
      "Prepared continuation prompt for next iteration",
      {
        previousIteration: previousSummary.iteration,
        sessionId: previousSessionId,
        toolsUsed: previousSummary.toolsUsed,
        responsesCount: previousSummary.assistantResponses.length,
        errorsCount: previousSummary.errors.length,
      },
    );
  }

  // Final summary
  await logger.write("result", "Iterate agent loop completed", {
    totalIterations: iterationCount,
    completionReason: isComplete ? "criteria_met" : "max_iterations",
  });

  console.log(`\n📊 Summary:`);
  console.log(`   Total iterations: ${iterationCount}`);
  console.log(
    `   Completion: ${isComplete ? "✅ Criteria met" : "⏹️  Max iterations"}\n`,
  );

  await logger.close();
}

// Run main
if (import.meta.main) {
  main();
}
