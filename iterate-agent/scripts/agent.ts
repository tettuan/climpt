/**
 * Iterate Agent - Autonomous Development Agent Entry Point
 *
 * @module
 *
 * This module provides the main executable entry point for the Iterate Agent,
 * an autonomous agent that executes development cycles through iterations
 * using the Claude Agent SDK.
 *
 * ## Features
 *
 * - GitHub Issue-based development cycles
 * - GitHub Project-based task management
 * - Configurable iteration limits
 * - Session resume capability
 * - Comprehensive logging with JSONL format
 *
 * ## Installation
 *
 * Run directly via JSR:
 *
 * ```bash
 * deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123
 * ```
 *
 * Or use the deno task:
 *
 * ```bash
 * deno task iterate-agent --issue 123
 * ```
 *
 * ## Usage
 *
 * ### Initialize Configuration
 *
 * ```bash
 * deno run -A jsr:@aidevtool/climpt/agents/iterator --init
 * ```
 *
 * ### Run with GitHub Issue
 *
 * ```bash
 * deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123
 * ```
 *
 * ### Run with GitHub Project
 *
 * ```bash
 * deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5
 * ```
 *
 * ### Run with Iteration Limit
 *
 * ```bash
 * deno run -A jsr:@aidevtool/climpt/agents/iterator --iterate-max 10
 * ```
 *
 * ## Options
 *
 * - `--init` - Initialize configuration files in current directory
 * - `--issue, -i <number>` - GitHub Issue number to work on
 * - `--project, -p <number>` - GitHub Project number to work on
 * - `--iterate-max, -m <number>` - Maximum iterations (default: unlimited)
 * - `--name, -n <name>` - Agent name for configuration (default: climpt)
 * - `--resume, -r` - Resume previous session
 * - `--help, -h` - Display help information
 *
 * @example
 * ```typescript
 * // Programmatic usage - use the module exports from iterate-agent/mod.ts
 * import {
 *   parseCliArgs,
 *   loadConfig,
 *   createCompletionHandler,
 * } from "jsr:@aidevtool/climpt/iterate-agent";
 *
 * const options = parseCliArgs(["--issue", "123"]);
 * ```
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { displayHelp, parseCliArgs } from "./cli.ts";
import {
  type CompletionHandler,
  createCompletionHandler,
} from "./completion/mod.ts";
import { IterateCompletionHandler } from "./completion/iterate.ts";
import { ProjectCompletionHandler } from "./completion/project.ts";
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
  buildIssueActionRetryPrompt,
  captureIterationData,
  captureSDKResult,
  detectIssueActions,
  isSkillInvocation,
  logSDKMessage,
} from "./message-handler.ts";
import { executeIssueAction, type IssueActionResult } from "./github.ts";
import { buildSystemPrompt } from "./prompts.ts";
import { generateReport, logReport, printReport } from "./report.ts";
import type {
  AgentConfig,
  AgentOptions,
  IssueAction,
  IssueActionParseResult,
  IterateAgentConfig,
  IterationSummary,
  SDKResultStats,
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
      console.log(
        "  2. Run: deno run -A jsr:@aidevtool/climpt/agents/iterator --issue <number>\n",
      );
      console.log(
        "Note: Requires 'gh' CLI (https://cli.github.com) with authentication.\n",
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

    // Apply default label from config if not specified via CLI
    if (options.label === undefined && config.github?.labels?.filter) {
      options.label = config.github.labels.filter;
    }

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
      label: options.label,
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
  const sdkResults: SDKResultStats[] = [];

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

    // Track detected actions and completion
    const detectedActions: IssueActionParseResult[] = [];
    const executedActions: IssueActionResult[] = [];
    let issueClosed = false;
    let closedIssueNumber: number | null = null;
    let shouldStopIteration = false;

    // Process all SDK messages in this session
    try {
      for await (const message of queryIterator) {
        await logSDKMessage(message, logger);

        // Capture iteration data for handoff to next iteration
        captureIterationData(message, summary);

        // Capture SDK result statistics for report
        const resultStats = captureSDKResult(message);
        if (resultStats) {
          sdkResults.push(resultStats);
        }

        // Log Skill invocations but don't count them as iterations
        if (isSkillInvocation(message)) {
          await logger.write("debug", "Skill invoked within iteration");
        }

        // Detect issue actions (project mode only)
        if (completionHandler instanceof ProjectCompletionHandler) {
          const currentIssue = completionHandler.getCurrentIssueInfo();

          // First, try new issue-action format
          const actionResults = detectIssueActions(message);
          if (actionResults.length > 0) {
            for (const actionResult of actionResults) {
              detectedActions.push(actionResult);

              if (actionResult.success && actionResult.action) {
                await logger.write("debug", "Issue action detected", {
                  action: actionResult.action.action,
                  issue: actionResult.action.issue,
                });

                // Execute action immediately
                const execResult = await executeIssueAction(
                  actionResult.action,
                  currentIssue?.repository,
                );
                executedActions.push(execResult);

                if (execResult.success) {
                  console.log(
                    `\n✅ Action "${execResult.action}" executed for issue #${execResult.issue}`,
                  );
                  await logger.write("info", "Issue action executed", {
                    action: execResult.action,
                    issue: execResult.issue,
                  });

                  if (execResult.isClosed) {
                    issueClosed = true;
                    closedIssueNumber = execResult.issue;
                    completionHandler.markCurrentIssueCompleted();
                  }
                  if (execResult.shouldStop) {
                    shouldStopIteration = true;
                  }
                } else {
                  console.error(
                    `\n❌ Action "${execResult.action}" failed: ${execResult.error}`,
                  );
                  await logger.write("error", "Issue action execution failed", {
                    action: execResult.action,
                    issue: execResult.issue,
                    repository: currentIssue?.repository,
                    actionBody: actionResult.action?.body,
                    actionLabel: actionResult.action?.label,
                    errorMessage: execResult.error,
                    ghCommand: `gh issue ${execResult.action === "close" ? "close" : "comment"} ${execResult.issue}${currentIssue?.repository ? ` -R ${currentIssue.repository}` : ""}`,
                  });
                }
              } else {
                await logger.write("debug", "Issue action parse failed", {
                  parseError: actionResult.error,
                  rawContent: actionResult.rawContent,
                });
              }
            }
          }
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

    // Handle failed action parses - retry with LLM (project mode)
    if (completionHandler instanceof ProjectCompletionHandler) {
      const currentIssue = completionHandler.getCurrentIssueInfo();
      const failedActions = detectedActions.filter((a) => !a.success);

      if (failedActions.length > 0 && currentIssue) {
        // Retry failed action parses
        for (const failedAction of failedActions) {
          await logger.write("info", "Action parse failed, retrying", {
            parseError: failedAction.error,
            rawContent: failedAction.rawContent,
          });

          console.log(`\n⚠️ Action format error, requesting retry...`);

          const retryPrompt = buildIssueActionRetryPrompt(
            failedAction,
            currentIssue.issueNumber,
          );

          // Send retry prompt
          const retryIterator = query({
            prompt: retryPrompt,
            options: {
              cwd: Deno.cwd(),
              allowedTools: [], // No tools needed for format correction
              permissionMode: agentConfig.permissionMode,
              systemPrompt: systemPrompt,
            },
          });

          let retryAction: IssueAction | null = null;
          for await (const message of retryIterator) {
            await logSDKMessage(message, logger);
            const results = detectIssueActions(message);
            if (results.length > 0 && results[0].success && results[0].action) {
              retryAction = results[0].action;
            }
          }

          if (retryAction) {
            // Retry succeeded - execute the action
            await logger.write("info", "Retry succeeded, executing action", {
              action: retryAction.action,
              issue: retryAction.issue,
            });

            const execResult = await executeIssueAction(
              retryAction,
              currentIssue.repository,
            );

            if (execResult.success) {
              console.log(
                `\n✅ Action "${execResult.action}" executed after retry`,
              );
              executedActions.push(execResult);

              if (execResult.isClosed) {
                issueClosed = true;
                closedIssueNumber = execResult.issue;
                completionHandler.markCurrentIssueCompleted();
              }
              if (execResult.shouldStop) {
                shouldStopIteration = true;
              }
            } else {
              await logger.write("error", "Action execution failed after retry", {
                action: execResult.action,
                issue: execResult.issue,
                repository: currentIssue.repository,
                actionBody: retryAction.body,
                errorMessage: execResult.error,
                ghCommand: `gh issue ${execResult.action === "close" ? "close" : "comment"} ${execResult.issue}${currentIssue.repository ? ` -R ${currentIssue.repository}` : ""}`,
              });
              console.error(
                `\n❌ Action "${execResult.action}" failed after retry: ${execResult.error}`,
              );
            }
          } else {
            await logger.write(
              "error",
              "Retry failed, action not executed",
              {
                parseError: failedAction.error,
              },
            );
            console.log(
              `\n⚠️ Could not parse action after retry. Action not executed.`,
            );
          }
        }
      }

      // Log closed issue status
      if (issueClosed && closedIssueNumber !== null) {
        console.log(`\n✅ Issue #${closedIssueNumber} closed!`);
      }
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
    // For project mode, this may also advance to the next issue
    const previousIssue = completionHandler instanceof ProjectCompletionHandler
      ? completionHandler.getCurrentIssueNumber()
      : null;

    isComplete = await completionHandler.isComplete();

    // Log issue transition in project mode
    if (completionHandler instanceof ProjectCompletionHandler) {
      const currentIssue = completionHandler.getCurrentIssueNumber();
      const completedCount = completionHandler.getCompletedCount();

      if (previousIssue !== currentIssue) {
        if (previousIssue !== null) {
          console.log(`\n✅ Issue #${previousIssue} closed!`);
          await logger.write("info", `Issue #${previousIssue} closed`, {
            completedCount,
          });
        }
        if (currentIssue !== null) {
          console.log(`\n📋 Moving to Issue #${currentIssue}`);
          await logger.write("info", `Starting Issue #${currentIssue}`, {
            remainingAfterCurrent: 0, // Will be updated by handler
          });
        }
      }
    }

    await logger.write("debug", "Completion criteria checked", {
      type: completionHandler.type,
      complete: isComplete,
      iteration: iterationCount,
    });

    if (isComplete) {
      // Show summary for project mode
      if (completionHandler instanceof ProjectCompletionHandler) {
        const completedCount = completionHandler.getCompletedCount();
        console.log(
          `\n🎉 Project complete! ${completedCount} issue(s) closed.\n`,
        );
      } else {
        console.log(`\n🎉 Completion criteria met!\n`);
      }
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

  // Generate and display execution report
  const completionReason = isComplete ? "criteria_met" : "max_iterations";
  try {
    const report = await generateReport(
      logger.getLogPath(),
      sdkResults,
      iterationCount,
      completionReason,
    );
    printReport(report);
    await logReport(logger, report);
  } catch (error) {
    // If report generation fails, fall back to simple summary
    await logger.write("error", "Failed to generate report", {
      error: {
        name: error instanceof Error ? error.name : "Unknown",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    console.log(`\n📊 Summary:`);
    console.log(`   Total iterations: ${iterationCount}`);
    console.log(
      `   Completion: ${
        isComplete ? "✅ Criteria met" : "⏹️  Max iterations"
      }\n`,
    );
  }

  await logger.close();
}

// Run main
if (import.meta.main) {
  main();
}
