#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys
/**
 * Review Agent - Main Entry Point
 *
 * Autonomous agent that verifies implementation against requirements
 * and creates issues for any identified gaps.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { displayHelp, parseCliArgs } from "./cli.ts";
import {
  ensureLogDirectory,
  getAgentConfig,
  initializeConfig,
  loadConfig,
  loadSystemPromptViaC3L,
} from "./config.ts";
import {
  executeReviewAction,
  getCurrentRepo,
  parseReviewActions,
} from "./github.ts";
import { createLogger, type Logger } from "./logger.ts";
import {
  resolvePluginPathsSafe,
  type SdkPluginConfig,
} from "./plugin-resolver.ts";
import type {
  IterationSummary,
  ReviewAction,
  ReviewAgentConfig,
  ReviewOptions,
  ReviewSummary,
  UvVariables,
  WorktreeSetupResult,
} from "./types.ts";
import { DefaultReviewCompletionHandler } from "./completion/default.ts";
import { DEFAULT_WORKTREE_CONFIG } from "./types.ts";
import { cleanupWorktree, setupWorktree } from "../../common/worktree.ts";
import {
  createPullRequest,
  mergeBranch,
  pushBranch,
  REVIEWER_MERGE_ORDER,
} from "../../common/merge.ts";
import {
  generateCorrelationId,
  loadCoordinationConfig,
} from "../../common/coordination.ts";

/**
 * Display init result
 */
function displayInitResult(result: {
  configCreated: boolean;
  promptCreated: boolean;
  configPath: string;
  promptPath: string;
}): void {
  console.log("\nReview Agent Initialization\n");
  console.log("Files:");
  console.log(
    `  ${result.configCreated ? "Created" : "Skipped"}: ${result.configPath}`,
  );
  console.log(
    `  ${result.promptCreated ? "Skipped" : "Skipped"}: ${result.promptPath}`,
  );
  console.log("\nRun with --project and --issue to start reviewing.");
}

/**
 * Process SDK messages and capture iteration data
 *
 * SDK message structure:
 * - { type: "system", subtype: "init", session_id: "..." }
 * - { message: { role: "assistant", content: [...blocks] } }
 * - { message: { role: "user", content: [...blocks] } }
 * - { type: "result", result: "..." }
 */
function processMessage(
  // deno-lint-ignore no-explicit-any
  message: any,
  summary: IterationSummary,
  logger: Logger,
): void {
  // Handle system messages (init, etc.)
  if (message.type === "system") {
    if (message.subtype === "init" && message.session_id) {
      logger.write("debug", `Session initialized: ${message.session_id}`).catch(
        console.error,
      );
    }
    return;
  }

  // Handle result messages
  if (message.type === "result") {
    summary.finalResult = message.result;
    logger.write("result", "SDK session completed", {
      sessionId: message.session_id,
    }).catch(console.error);
    return;
  }

  // Handle assistant messages
  if (message.message?.role === "assistant") {
    const content = message.message.content;
    const blocks = Array.isArray(content) ? content : [];

    // Extract text blocks
    // deno-lint-ignore no-explicit-any
    const textBlocks = blocks.filter((b: any) => b.type === "text");
    // deno-lint-ignore no-explicit-any
    const text = textBlocks.map((b: any) => b.text).join("\n").trim();

    if (text && text.length > 0) {
      summary.assistantResponses.push(text);

      // Check for review actions
      const actions = parseReviewActions(text);
      summary.reviewActions.push(...actions);

      logger.write("assistant", text.substring(0, 200) + "...", {
        reviewActionsFound: actions.length,
      }).catch(console.error);
    }

    // Extract tool uses
    // deno-lint-ignore no-explicit-any
    const toolUses = blocks.filter((b: any) => b.type === "tool_use");
    for (const tool of toolUses) {
      if (tool.name && !summary.toolsUsed.includes(tool.name)) {
        summary.toolsUsed.push(tool.name);
        logger.write("info", `Tool invoked: ${tool.name}`).catch(console.error);
      }
    }
    return;
  }

  // Handle user messages (for error capture)
  if (message.message?.role === "user") {
    const content = message.message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_result" && block.is_error) {
          const errorMsg = String(block.content || "Unknown error");
          summary.errors.push(errorMsg);
          logger.write("error", errorMsg).catch(console.error);
        }
      }
    }
    return;
  }

  // Log unknown message types
  logger.write(
    "debug",
    `Unknown message: ${JSON.stringify(message).substring(0, 100)}`,
  ).catch(console.error);
}

/**
 * Execute review actions from iteration
 */
async function executeActions(
  actions: ReviewAction[],
  repo: string,
  logger: Logger,
  coordinationConfig?:
    import("../../common/coordination-types.ts").CoordinationConfig,
): Promise<number[]> {
  const createdIssues: number[] = [];

  for (const action of actions) {
    try {
      const result = await executeReviewAction(
        repo,
        action,
        coordinationConfig,
      );

      if (result.type === "create-issue") {
        const issueNum = (result.result as { issueNumber: number }).issueNumber;
        createdIssues.push(issueNum);
        await logger.write("info", `Created gap issue #${issueNum}`, {
          reviewAction: {
            actionType: action.action,
            issueCreated: issueNum,
          },
        });
        console.log(`  Created gap issue #${issueNum}: ${action.title}`);
      } else if (result.type === "add-comment") {
        const issueNum = (result.result as { issueNumber: number }).issueNumber;
        await logger.write("info", `Added comment to issue #${issueNum}`, {
          reviewAction: {
            actionType: action.action,
            issueNumber: issueNum,
          },
        });
        console.log(`  Added comment to issue #${issueNum}`);
      } else if (result.type === "close-issue") {
        const issueNum = (result.result as { issueNumber: number }).issueNumber;
        await logger.write("info", `Closed issue #${issueNum}`, {
          reviewAction: {
            actionType: action.action,
            issueNumber: issueNum,
          },
        });
        console.log(`  Closed issue #${issueNum}`);
      } else if (result.type === "complete") {
        await logger.write("info", "Review completed", {
          summary: action.summary,
        });
      }
    } catch (error) {
      await logger.write("error", `Failed to execute action: ${error}`, {
        action: action.action,
      });
    }
  }

  return createdIssues;
}

// Note: formatIssuesForPrompt, buildInitialPrompt, buildContinuationPrompt, and isReviewComplete
// have been moved to DefaultReviewCompletionHandler (./completion/default.ts)

/**
 * Main agent loop
 */
async function runAgentLoop(
  options: ReviewOptions,
  config: ReviewAgentConfig,
  logger: Logger,
  dynamicPlugins: SdkPluginConfig[],
  coordinationConfig:
    import("../../common/coordination-types.ts").CoordinationConfig,
): Promise<ReviewSummary> {
  // Get agent config
  const agentConfig = getAgentConfig(config, options.agentName);

  // Create completion handler
  const completionHandler = new DefaultReviewCompletionHandler(options, logger);

  // Build completion criteria via handler
  const completionCriteria = completionHandler.buildCompletionCriteria();

  // Build uv- parameters for C3L
  const uvVariables: UvVariables = {
    project: String(options.project),
    requirements_label: options.requirementsLabel,
    review_label: options.reviewLabel,
  };

  let systemPrompt: string;
  try {
    systemPrompt = await loadSystemPromptViaC3L(
      uvVariables,
      completionCriteria.detail,
    );
    await logger.write("info", "Climpt prompt executed", {
      type: "climpt_prompt_used",
      c1: "reviewer-dev",
      c2: "start",
      c3: "default",
      promptPath: ".agent/reviewer/prompts/dev/start/default/f_default.md",
    });
  } catch (c3lError) {
    await logger.write("error", "C3L loading failed", {
      error: {
        name: c3lError instanceof Error ? c3lError.name : "UnknownError",
        message: c3lError instanceof Error
          ? c3lError.message
          : String(c3lError),
        stack: c3lError instanceof Error ? c3lError.stack : undefined,
      },
    });
    throw c3lError;
  }

  await logger.write("info", "System prompt built via C3L", {
    project: options.project,
    requirementsLabel: options.requirementsLabel,
    reviewLabel: options.reviewLabel,
  });

  // Get current repo for action execution
  const repo = await getCurrentRepo();

  // Build initial prompt using completion handler
  await logger.write(
    "info",
    `Fetching requirements issues with '${options.requirementsLabel}' label`,
  );
  await logger.write(
    "info",
    `Fetching review targets with '${options.reviewLabel}' label`,
  );
  const initialPrompt = await completionHandler.buildInitialPrompt();

  // Review state
  let iterationCount = 0;
  const allCreatedIssues: number[] = [];
  let isComplete = false;
  let currentPrompt = initialPrompt;

  console.log(`\nStarting review for GitHub Project #${options.project}`);
  console.log(`  Requirements label: '${options.requirementsLabel}'`);
  console.log(`  Review target label: '${options.reviewLabel}'\n`);

  // Main iteration loop
  while (!isComplete && iterationCount < options.iterateMax) {
    iterationCount++;

    const summary: IterationSummary = {
      iteration: iterationCount,
      assistantResponses: [],
      toolsUsed: [],
      reviewActions: [],
      errors: [],
    };

    await logger.write("info", `Starting iteration ${iterationCount}`, {
      iterationCount,
    });

    console.log(`Iteration ${iterationCount}...`);

    try {
      // Build query options
      const queryOptions: Record<string, unknown> = {
        cwd: Deno.cwd(),
        systemPrompt,
        allowedTools: agentConfig.allowedTools,
        permissionMode: agentConfig.permissionMode,
        settingSources: ["user", "project"],
        plugins: dynamicPlugins.length > 0 ? dynamicPlugins : undefined,
      };

      // Run SDK query
      const queryIterator = query({
        prompt: currentPrompt,
        options: queryOptions,
      });

      for await (const message of queryIterator) {
        processMessage(message, summary, logger);
      }

      // Execute any review actions
      const newIssues = await executeActions(
        summary.reviewActions,
        repo,
        logger,
        coordinationConfig,
      );
      allCreatedIssues.push(...newIssues);

      // Check completion using handler
      isComplete = completionHandler.isComplete(summary);

      // Log completion status
      await logger.write(
        "info",
        completionHandler.getCompletionDescription(summary),
      );

      if (!isComplete) {
        // Build continuation prompt using handler
        currentPrompt = completionHandler.buildContinuationPrompt(
          iterationCount,
          summary,
          allCreatedIssues,
        );
      }
    } catch (error) {
      await logger.write(
        "error",
        `Iteration ${iterationCount} failed: ${error}`,
        {
          error: {
            name: error instanceof Error ? error.name : "Error",
            message: error instanceof Error ? error.message : String(error),
          },
        },
      );

      // Continue to next iteration if possible
      currentPrompt = `Error occurred: ${error}. Please continue the review.`;
    }
  }

  // Build final summary
  const reviewSummary: ReviewSummary = {
    totalRequirements: 0, // Would need to track this from parsing
    completeCount: 0,
    partialCount: 0,
    missingCount: allCreatedIssues.length,
    createdIssues: allCreatedIssues,
    details: [],
  };

  return reviewSummary;
}

/**
 * Display final report
 */
function displayReport(
  summary: ReviewSummary,
  iterations: number,
  logPath: string,
): void {
  console.log("\n" + "=".repeat(60));
  console.log("Review Complete");
  console.log("=".repeat(60));

  console.log(`\nIterations: ${iterations}`);
  console.log(`Gap issues created: ${summary.createdIssues.length}`);

  if (summary.createdIssues.length > 0) {
    console.log(`\nCreated Issues:`);
    for (const issueNum of summary.createdIssues) {
      console.log(`  - #${issueNum}`);
    }
  }

  console.log(`\nLog file: ${logPath}`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    // Parse CLI arguments
    const args = parseCliArgs(Deno.args);

    // Handle help
    if (args.help) {
      displayHelp();
      Deno.exit(0);
    }

    // Handle init
    if (args.init) {
      const result = await initializeConfig();
      displayInitResult(result);
      Deno.exit(0);
    }

    // Load configuration
    const config = await loadConfig();

    // Get options
    const options = args.options!;

    // Setup worktree if enabled
    const worktreeConfig = config.worktree ?? DEFAULT_WORKTREE_CONFIG;
    let worktreeContext: WorktreeSetupResult | null = null;
    const originalCwd = Deno.cwd();

    if (worktreeConfig.forceWorktree) {
      console.log(`\n🌲 Worktree mode enabled`);
      try {
        worktreeContext = await setupWorktree(worktreeConfig, {
          branch: options.branch,
          baseBranch: options.baseBranch,
        });
        console.log(`   Branch: ${worktreeContext.branchName}`);
        console.log(`   Base: ${worktreeContext.baseBranch}`);
        console.log(`   Path: ${worktreeContext.worktreePath}`);
        if (worktreeContext.created) {
          console.log(`   Status: Created new worktree`);
        } else {
          console.log(`   Status: Using existing worktree`);
        }

        // Change to worktree directory
        Deno.chdir(worktreeContext.worktreePath);
        console.log(`   Working directory changed to worktree\n`);
      } catch (error) {
        console.error(
          `\n❌ Worktree setup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        Deno.exit(1);
      }
    }

    // Ensure log directory exists
    const logDir = await ensureLogDirectory(config);

    // Generate correlation ID for tracing
    const coordinationConfig = loadCoordinationConfig();
    const correlationId = generateCorrelationId(coordinationConfig, "reviewer");

    // Create logger with correlation ID
    const logger = await createLogger(
      logDir,
      options.agentName,
      config.logging.maxFiles,
      correlationId,
    );

    await logger.write("info", "Review agent started", {
      project: options.project,
      requirementsLabel: options.requirementsLabel,
      reviewLabel: options.reviewLabel,
      agentName: options.agentName,
      correlationId,
    });

    // Resolve dynamic plugins from settings.json
    const dynamicPlugins = await resolvePluginPathsSafe(
      ".claude/settings.json",
      Deno.cwd(),
      async (error, message) => {
        await logger.write("info", `[warn] ${message}`, {
          error: {
            name: error.name,
            message: error.message,
          },
        });
      },
    );

    if (dynamicPlugins.length > 0) {
      await logger.write("info", "Dynamic plugins resolved", {
        count: dynamicPlugins.length,
        plugins: dynamicPlugins.map((p) => p.path),
      });
    }

    // Run agent loop
    let iterations = 0;
    try {
      const summary = await runAgentLoop(
        options,
        config,
        logger,
        dynamicPlugins,
        coordinationConfig,
      );
      iterations = summary.createdIssues.length > 0 ? 1 : 0; // Simplified

      // Display report
      displayReport(summary, iterations, logger.getLogPath());

      // Worktree integration (merge back to base branch)
      if (worktreeContext) {
        console.log(`\n🔀 Integrating worktree changes...`);
        await logger.write("info", "Starting worktree integration", {
          sourceBranch: worktreeContext.branchName,
          targetBranch: worktreeContext.baseBranch,
        });

        // Change back to original directory for merge
        Deno.chdir(originalCwd);

        // Clean up worktree to unlock the branch for merging
        console.log(`   🧹 Cleaning up worktree...`);
        await cleanupWorktree(worktreeContext.worktreePath, originalCwd);
        await logger.write("info", "Worktree cleaned up", {
          worktreePath: worktreeContext.worktreePath,
        });

        // Attempt merge using Reviewer strategy (ff → squash → merge)
        const mergeResult = await mergeBranch(
          worktreeContext.branchName,
          worktreeContext.baseBranch,
          REVIEWER_MERGE_ORDER,
          originalCwd,
        );

        if (mergeResult.success) {
          console.log(
            `   ✅ Merge successful (strategy: ${mergeResult.strategy})`,
          );
          await logger.write("info", "Worktree merge successful", {
            strategy: mergeResult.strategy,
          });
        } else {
          console.log(`   ⚠️ Merge failed: ${mergeResult.error}`);
          if (
            mergeResult.conflictFiles && mergeResult.conflictFiles.length > 0
          ) {
            console.log(`   Conflicting files:`);
            for (const file of mergeResult.conflictFiles) {
              console.log(`     - ${file}`);
            }
          }

          await logger.write("error", "Worktree merge failed", {
            strategy: mergeResult.strategy,
            error: mergeResult.error
              ? { name: "MergeError", message: mergeResult.error }
              : undefined,
            conflictFiles: mergeResult.conflictFiles,
          });

          // Create PR for manual resolution
          console.log(`\n   Creating PR for manual resolution...`);
          const pushed = await pushBranch(
            worktreeContext.branchName,
            originalCwd,
          );
          if (pushed) {
            const prUrl = await createPullRequest(
              `[Auto] Merge ${worktreeContext.branchName} to ${worktreeContext.baseBranch}`,
              `## Automatic merge failed\n\nThis PR was created because automatic merge failed.\n\n**Conflict files:**\n${
                mergeResult.conflictFiles?.map((f) => `- ${f}`).join("\n") ||
                "Unknown"
              }\n\n**Error:** ${mergeResult.error}`,
              worktreeContext.baseBranch,
              originalCwd,
            );
            if (prUrl) {
              console.log(`   ✅ PR created: ${prUrl}`);
              await logger.write("info", "PR created for manual resolution", {
                prUrl,
              });
            }
          }
        }
      }
    } finally {
      await logger.close();
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}
