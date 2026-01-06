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
 * // Programmatic usage - use the module exports from agents/iterator/mod.ts
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
  checkClimptAgentPlugin,
  resolvePluginPathsSafe,
  type SdkPluginConfig,
} from "./plugin-resolver.ts";
import {
  type CompletionHandler,
  createCompletionHandler,
} from "./completion/mod.ts";
import { IterateCompletionHandler } from "./completion/iterate.ts";
import { ProjectCompletionHandler } from "./completion/project.ts";
import {
  type CompletionMode,
  ensureLogDirectory,
  getAgentConfig,
  initializeConfig,
  loadConfig,
  loadSystemPromptViaC3L,
} from "./config.ts";
import { createLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";
import {
  buildIssueActionRetryPrompt,
  captureIterationData,
  captureSDKResult,
  detectIssueActions,
  detectProjectPlan,
  detectReviewResult,
  isSkillInvocation,
  logSDKMessage,
  type ProjectPlanParseResult,
  type ReviewResultParseResult,
} from "./message-handler.ts";
import { executeIssueAction, type IssueActionResult } from "./github.ts";
import { generateReport, logReport, printReport } from "./report.ts";
import type {
  AgentConfig,
  AgentOptions,
  IssueAction,
  IssueActionParseResult,
  IterateAgentConfig,
  IterationSummary,
  ProjectPhase,
  SDKResultStats,
  UvVariables,
  WorktreeSetupResult,
} from "./types.ts";
import { DEFAULT_WORKTREE_CONFIG } from "./types.ts";
import { cleanupWorktree, setupWorktree } from "../../common/worktree.ts";
import {
  createPullRequest,
  ITERATOR_MERGE_ORDER,
  mergeBranch,
  pushBranch,
} from "../../common/merge.ts";

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
      const { created, skipped } = await initializeConfig();

      if (created.length > 0) {
        console.log("Created:");
        for (const path of created) {
          console.log(`  ✅ ${path}`);
        }
      }

      if (skipped.length > 0) {
        console.log("\nSkipped (already exists):");
        for (const path of skipped) {
          console.log(`  ⏭️  ${path}`);
        }
      }

      if (created.length === 0) {
        console.log("\n📋 All configuration files already exist.\n");
      } else {
        console.log("\n🎉 Initialization complete!\n");
        console.log("Next steps:");
        console.log(
          "  1. Review and customize the configuration in agents/iterator/config.json",
        );
        console.log(
          "  2. Install the Claude Code plugin (required for delegate-climpt-agent Skill):",
        );
        console.log(
          "     /plugin marketplace add tettuan/climpt",
        );
        console.log(
          "     /plugin install climpt-agent",
        );
        console.log(
          "  3. Run: deno run -A jsr:@aidevtool/climpt/agents/iterator --issue <number>\n",
        );
        console.log(
          "Note: Requires 'gh' CLI (https://cli.github.com) with authentication.\n",
        );
      }
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

    // 2.3. Setup worktree if enabled
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

    // 2.5. Check if climpt-agent plugin is installed
    const pluginCheck = await checkClimptAgentPlugin();
    if (!pluginCheck.installed) {
      console.log("\n⚠️  Warning: climpt-agent plugin is not installed.");
      console.log("   The delegate-climpt-agent Skill will not be available.");
      console.log("   To install, run in Claude Code:");
      console.log("     /plugin marketplace add tettuan/climpt");
      console.log("     /plugin install climpt-agent\n");
    }

    // 3. Initialize logger (use originalCwd to keep logs in main repo, not worktree)
    const logDir = await ensureLogDirectory(
      config,
      options.agentName,
      originalCwd,
    );
    logger = await createLogger(
      logDir,
      options.agentName,
      config.logging.maxFiles,
    );

    await logger.write("info", "Iterate agent started", {
      agentName: options.agentName,
      issue: options.issue,
      project: options.project,
      projectOwner: options.projectOwner,
      label: options.label,
      iterateMax: options.iterateMax,
      resume: options.resume,
    });

    // 4. Create completion handler
    const completionHandler = createCompletionHandler(options);

    await logger.write("debug", "Completion handler created", {
      type: completionHandler.type,
    });

    // 5. Build system prompt via breakdown CLI
    const completionMode = completionHandler.type as CompletionMode;
    const { criteria, detail } = completionHandler.buildCompletionCriteria();

    // Build uv- parameters (short strings for CLI args)
    const uvVariables: UvVariables = {
      agent_name: options.agentName,
      completion_criteria: criteria,
      target_label: options.label || config.github?.labels?.filter || "docs",
    };

    let systemPrompt: string;
    try {
      // breakdown CLI で展開
      // - uv- パラメータ: CLI args
      // - completion_criteria_detail: STDIN
      systemPrompt = await loadSystemPromptViaC3L(
        completionMode,
        uvVariables,
        detail, // STDIN で渡す
      );
      const initialC3 = completionMode === "iterate"
        ? "default"
        : completionMode;
      await logger.write("info", "Climpt prompt executed", {
        type: "climpt_prompt_used",
        c1: "iterator-dev",
        c2: "start",
        c3: initialC3,
        promptPath:
          `agent/iterator/prompts/iterator-dev/start/${initialC3}/f_default.md`,
      });
      await logger.write("debug", "System prompt loaded via C3L", {
        mode: completionMode,
        uvVariables,
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

    await logger.write("debug", "System prompt built", {
      promptLength: systemPrompt.length,
    });

    // 6. Build initial prompt
    const initialPrompt = await completionHandler.buildInitialPrompt();

    await logger.write("debug", "Initial prompt built", {
      promptLength: initialPrompt.length,
    });

    // 6.5. Resolve dynamic plugins from all settings scopes
    const dynamicPlugins = await resolvePluginPathsSafe(
      Deno.cwd(),
      async (error, message) => {
        if (logger) {
          await logger.write("info", `[warn] ${message}`, {
            error: {
              name: error.name,
              message: error.message,
            },
          });
        }
      },
    );

    if (dynamicPlugins.length > 0) {
      await logger.write("info", "Dynamic plugins resolved", {
        count: dynamicPlugins.length,
        plugins: dynamicPlugins.map((p) => p.path),
      });
    }

    // 7. Run agent loop
    await runAgentLoop(
      options,
      config,
      agentConfig,
      completionHandler,
      systemPrompt,
      initialPrompt,
      logger,
      uvVariables,
      detail, // completion criteria detail for STDIN
      dynamicPlugins,
    );

    // 8. Worktree integration (merge back to base branch)
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

      // Attempt merge using Iterator strategy (squash → ff → merge)
      const mergeResult = await mergeBranch(
        worktreeContext.branchName,
        worktreeContext.baseBranch,
        ITERATOR_MERGE_ORDER,
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
        if (mergeResult.conflictFiles && mergeResult.conflictFiles.length > 0) {
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
 *
 * For project mode, handles multi-phase workflow:
 * - preparation: Analyze project, output project-plan JSON
 * - processing: Work through issues one by one
 * - review: Check completion, output review-result JSON
 * - again: Re-execute if review fails
 */
async function runAgentLoop(
  options: AgentOptions,
  _config: IterateAgentConfig,
  agentConfig: AgentConfig,
  completionHandler: CompletionHandler,
  systemPrompt: string,
  initialPrompt: string,
  logger: Logger,
  uvVariables: UvVariables,
  stdinContent: string,
  dynamicPlugins: SdkPluginConfig[],
): Promise<void> {
  let iterationCount = 0;
  let isComplete = false;
  let currentPrompt = initialPrompt;
  let previousSummary: IterationSummary | undefined = undefined;
  let previousSessionId: string | undefined = undefined;
  const sdkResults: SDKResultStats[] = [];

  // Current system prompt (may be reloaded on phase transitions)
  let currentSystemPrompt = systemPrompt;

  // Track current phase for project mode
  let currentPhase: ProjectPhase | null = null;
  if (completionHandler instanceof ProjectCompletionHandler) {
    currentPhase = completionHandler.getPhase();
  }

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
      systemPrompt: currentSystemPrompt,
      settingSources: ["user", "project"], // Load Skills from filesystem
      plugins: dynamicPlugins.length > 0 ? dynamicPlugins : undefined,
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

    // Track detected phase outputs (project mode)
    let detectedProjectPlan: ProjectPlanParseResult | null = null;
    let detectedReviewResult: ReviewResultParseResult | null = null;

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

        // Detect phase outputs (project mode only)
        if (completionHandler instanceof ProjectCompletionHandler) {
          // Detect project-plan from preparation phase
          if (currentPhase === "preparation" && !detectedProjectPlan) {
            const planResult = detectProjectPlan(message);
            if (planResult) {
              detectedProjectPlan = planResult;
              if (planResult.success && planResult.plan) {
                await logger.write("info", "Project plan detected", {
                  totalIssues: planResult.plan.totalIssues,
                  complexity: planResult.plan.estimatedComplexity,
                  skillsNeeded: planResult.plan.skillsNeeded,
                });
              } else {
                await logger.write("error", "Project plan parse failed", {
                  parseError: planResult.error,
                });
              }
            }
          }

          // Detect review-result from review phase
          if (currentPhase === "review" && !detectedReviewResult) {
            const reviewResult = detectReviewResult(message);
            if (reviewResult) {
              detectedReviewResult = reviewResult;
              if (reviewResult.success && reviewResult.result) {
                await logger.write("info", "Review result detected", {
                  result: reviewResult.result.result,
                  summary: reviewResult.result.summary,
                });
              } else {
                await logger.write("error", "Review result parse failed", {
                  parseError: reviewResult.error,
                });
              }
            }
          }

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
                  // execResult.shouldStop is tracked but not currently used
                  // for iteration control - reserved for future use
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
                    ghCommand: `gh issue ${
                      execResult.action === "close" ? "close" : "comment"
                    } ${execResult.issue}${
                      currentIssue?.repository
                        ? ` -R ${currentIssue.repository}`
                        : ""
                    }`,
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
              systemPrompt: currentSystemPrompt,
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
              // execResult.shouldStop is tracked but not currently used
              // for iteration control - reserved for future use
            } else {
              await logger.write(
                "error",
                "Action execution failed after retry",
                {
                  action: execResult.action,
                  issue: execResult.issue,
                  repository: currentIssue.repository,
                  actionBody: retryAction.body,
                  errorMessage: execResult.error,
                  ghCommand: `gh issue ${
                    execResult.action === "close" ? "close" : "comment"
                  } ${execResult.issue}${
                    currentIssue.repository
                      ? ` -R ${currentIssue.repository}`
                      : ""
                  }`,
                },
              );
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

    // Handle phase transitions for project mode
    if (completionHandler instanceof ProjectCompletionHandler && currentPhase) {
      const previousPhase = currentPhase;

      // Handle preparation phase completion
      if (
        currentPhase === "preparation" &&
        detectedProjectPlan?.success &&
        detectedProjectPlan.plan
      ) {
        completionHandler.setProjectPlan(detectedProjectPlan.plan);
        completionHandler.advancePhase();
        currentPhase = completionHandler.getPhase();

        // Build recommended_skills string (empty becomes "指定なし")
        const recommendedSkills =
          detectedProjectPlan.plan.skillsNeeded.length > 0
            ? detectedProjectPlan.plan.skillsNeeded.join(", ")
            : "指定なし";

        console.log(`\n📋 Preparation complete. Moving to processing phase.`);
        console.log(`   Recommended skills: ${recommendedSkills}`);

        await logger.write(
          "info",
          "Phase transition: preparation → processing",
          {
            plan: detectedProjectPlan.plan,
            recommendedSkills,
          },
        );

        // Reload system prompt for processing phase with skills
        try {
          const processingUvVariables: UvVariables = {
            ...uvVariables,
            recommended_skills: recommendedSkills,
          };
          currentSystemPrompt = await loadSystemPromptViaC3L(
            "project",
            processingUvVariables,
            stdinContent,
            { edition: "processing" },
          );
          await logger.write("info", "Climpt prompt executed", {
            type: "climpt_prompt_used",
            c1: "iterator-dev",
            c2: "start",
            c3: "project",
            promptPath:
              "agent/iterator/prompts/iterator-dev/start/project/f_default.md",
          });
          await logger.write(
            "debug",
            "System prompt reloaded for processing phase",
            { recommendedSkills },
          );
        } catch (error) {
          await logger.write("error", "Failed to reload processing prompt", {
            error: {
              name: error instanceof Error ? error.name : "Unknown",
              message: error instanceof Error ? error.message : String(error),
            },
          });
          throw error;
        }
      }

      // Handle review phase completion
      if (
        currentPhase === "review" &&
        detectedReviewResult?.success &&
        detectedReviewResult.result
      ) {
        completionHandler.setReviewResult(detectedReviewResult.result);
        completionHandler.advancePhase();
        currentPhase = completionHandler.getPhase();

        if (detectedReviewResult.result.result === "pass") {
          console.log(
            `\n✅ Review passed! ${detectedReviewResult.result.summary}`,
          );
          await logger.write("info", "Phase transition: review → complete", {
            reviewResult: detectedReviewResult.result,
          });
        } else {
          console.log(
            `\n⚠️ Review failed: ${detectedReviewResult.result.summary}`,
          );
          console.log(`   Re-executing to address issues...`);
          await logger.write("info", "Phase transition: review → again", {
            reviewResult: detectedReviewResult.result,
          });

          // Reload system prompt for again phase
          try {
            currentSystemPrompt = await loadSystemPromptViaC3L(
              "project",
              uvVariables,
              stdinContent,
              { edition: "again" },
            );
            await logger.write("info", "Climpt prompt executed", {
              type: "climpt_prompt_used",
              c1: "iterator-dev",
              c2: "start",
              c3: "project",
              promptPath:
                "agent/iterator/prompts/iterator-dev/start/project/f_default.md",
            });
            await logger.write(
              "debug",
              "System prompt reloaded for again phase",
            );
          } catch (error) {
            await logger.write("error", "Failed to reload again prompt", {
              error: {
                name: error instanceof Error ? error.name : "Unknown",
                message: error instanceof Error ? error.message : String(error),
              },
            });
            throw error;
          }
        }
      }

      // Handle processing phase completion → move to review
      if (
        currentPhase === "processing" &&
        previousPhase === "processing"
      ) {
        // Check if all issues are done (handler.isComplete() will be checked later)
        // We need to detect when processing is truly done to advance to review
        const processingComplete = await completionHandler.isComplete();
        if (
          processingComplete && completionHandler.getPhase() === "processing"
        ) {
          completionHandler.advancePhase();
          currentPhase = completionHandler.getPhase();

          if (currentPhase === "review") {
            console.log(`\n📋 All issues processed. Moving to review phase.`);
            await logger.write(
              "info",
              "Phase transition: processing → review",
            );

            // Reload system prompt for review phase
            try {
              currentSystemPrompt = await loadSystemPromptViaC3L(
                "project",
                uvVariables,
                stdinContent,
                { command: "review" },
              );
              await logger.write("info", "Climpt prompt executed", {
                type: "climpt_prompt_used",
                c1: "iterator-dev",
                c2: "review",
                c3: "project",
                promptPath:
                  "agent/iterator/prompts/iterator-dev/review/project/f_default.md",
              });
              await logger.write(
                "debug",
                "System prompt reloaded for review phase",
              );
            } catch (error) {
              await logger.write("error", "Failed to reload review prompt", {
                error: {
                  name: error instanceof Error ? error.name : "Unknown",
                  message: error instanceof Error
                    ? error.message
                    : String(error),
                },
              });
              throw error;
            }
          }
        }
      }

      // Handle again phase → back to processing logic, then review
      if (currentPhase === "again" && previousPhase === "again") {
        // Again phase follows processing-like logic
        // When work is done, advance back to review
        const againComplete = await completionHandler.isComplete();
        if (againComplete) {
          completionHandler.advancePhase();
          currentPhase = completionHandler.getPhase();

          if (currentPhase === "review") {
            console.log(`\n📋 Re-execution complete. Running review again.`);
            await logger.write("info", "Phase transition: again → review");

            // Reload system prompt for review phase
            try {
              currentSystemPrompt = await loadSystemPromptViaC3L(
                "project",
                uvVariables,
                stdinContent,
                { command: "review" },
              );
              await logger.write("info", "Climpt prompt executed", {
                type: "climpt_prompt_used",
                c1: "iterator-dev",
                c2: "review",
                c3: "project",
                promptPath:
                  "agent/iterator/prompts/iterator-dev/review/project/f_default.md",
              });
              await logger.write(
                "debug",
                "System prompt reloaded for re-review phase",
              );
            } catch (error) {
              await logger.write("error", "Failed to reload review prompt", {
                error: {
                  name: error instanceof Error ? error.name : "Unknown",
                  message: error instanceof Error
                    ? error.message
                    : String(error),
                },
              });
              throw error;
            }
          }
        }
      }
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
