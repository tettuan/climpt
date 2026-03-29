/**
 * Unified Agent Runner Entry Point
 *
 * Runs agents using the unified AgentRunner architecture.
 *
 * @module
 *
 * @example Run iterator agent
 * ```bash
 * deno task agent --agent iterator --issue 123
 * ```
 *
 * @example Run reviewer agent
 * ```bash
 * deno task agent --agent reviewer --issue 123
 * ```
 */

import { parseArgs } from "@std/cli/parse-args";
import { AgentRunner } from "../runner/runner.ts";
import { listAgents } from "../config/loader.ts";
import { loadConfiguration } from "../config/mod.ts";
import { initAgent } from "../init.ts";
import {
  type FinalizeOptions,
  finalizeWorktreeBranch,
  setupWorktree,
} from "../common/worktree.ts";
import type {
  WorktreeSetupConfig,
  WorktreeSetupResult,
} from "../common/types.ts";
import type { FinalizeConfig } from "../src_common/types.ts";

const RUN = "deno task agent";
const RUN_RW = "deno task agent";
const RUN_RO = "deno task agent";

function printHelp(): void {
  // deno-lint-ignore no-console
  console.log(`
Unified Agent Runner

Usage:
  ${RUN} --agent <name> [options]
  ${RUN_RW} --init --agent <name>
  ${RUN_RO} --list

Required:
  --agent, -a <name>     Agent name (iterator, reviewer, etc.)

Options:
  --help, -h             Show this help message
  --init                 Initialize new agent with basic template
  --list                 List available agents

Validation:
  --validate             Validate agent configuration without running

Common Options:
  --issue, -i <number>   GitHub Issue number
  --iterate-max <n>      Maximum iterations
  --resume               Resume previous session
  --branch <name>        Working branch for worktree mode
  --base-branch <name>   Base branch for worktree mode
  --verbose, -v          Enable verbose logging (SDK I/O details)

Finalize Options:
  --no-merge             Skip merging worktree branch to base
  --push                 Push after merge
  --push-remote <name>   Remote to push to (default: origin)
  --create-pr            Create PR instead of direct merge
  --pr-target <branch>   Target branch for PR (default: base branch)

Examples:
  ${RUN_RW} --init --agent my-agent
  ${RUN} --agent iterator --issue 123
  ${RUN} --agent reviewer --issue 123

Documentation:
  Quick Start:      agents/docs/builder/01_quickstart.md
  Definition Ref:   agents/docs/builder/02_agent_definition.md
  YAML Reference:   agents/docs/builder/reference/
  Troubleshooting:  agents/docs/builder/05_troubleshooting.md
  Design Docs:      agents/docs/design/
  JSON Schemas:     agents/schemas/
`);
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    string: [
      "agent",
      "branch",
      "base-branch",
      "requirements-label",
      "review-label",
      "push-remote",
      "pr-target",
    ],
    boolean: [
      "help",
      "init",
      "list",
      "resume",
      "no-merge",
      "push",
      "create-pr",
      "verbose",
      "validate",
    ],
    alias: {
      a: "agent",
      h: "help",
      i: "issue",
      m: "iterate-max",
      v: "verbose",
    },
  });

  // Help
  if (args.help) {
    printHelp();
    Deno.exit(0);
  }

  // List available agents
  if (args.list) {
    // deno-lint-ignore no-console
    console.log("\nAvailable agents:");
    const agents = await listAgents(Deno.cwd());
    for (const agent of agents) {
      // deno-lint-ignore no-console
      console.log(`  - ${agent}`);
    }
    // deno-lint-ignore no-console
    console.log("");
    Deno.exit(0);
  }

  // Validate agent configuration
  if (args.validate) {
    if (!args.agent) {
      // deno-lint-ignore no-console
      console.error(
        "Error: [CONFIGURATION] --validate requires --agent <name>\n" +
          "  \u2192 Resolution: Add --agent <name> to your command\n" +
          "  \u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
      );
      Deno.exit(1);
    }
    const { validateFull } = await import("../config/mod.ts");
    const result = await validateFull(args.agent, Deno.cwd());

    // deno-lint-ignore no-console
    console.log(`\nValidating agent: ${args.agent}`);

    let totalErrors = 0;
    let totalWarnings = 0;

    // Agent schema
    if (result.agentSchemaResult.valid) {
      // deno-lint-ignore no-console
      console.log("  \u2713 agent.json \u2014 Schema valid");
    } else {
      // deno-lint-ignore no-console
      console.log("  \u2717 agent.json \u2014 Schema errors:");
      for (const err of result.agentSchemaResult.errors) {
        // deno-lint-ignore no-console
        console.log(`    - ${err.path}: ${err.message}`);
      }
      totalErrors += result.agentSchemaResult.errors.length;
    }

    // Agent config
    if (result.agentConfigResult.valid) {
      // deno-lint-ignore no-console
      console.log("  \u2713 agent.json \u2014 Configuration valid");
    } else {
      // deno-lint-ignore no-console
      console.log("  \u2717 agent.json \u2014 Configuration errors:");
      for (const err of result.agentConfigResult.errors) {
        // deno-lint-ignore no-console
        console.log(`    - ${err}`);
      }
      totalErrors += result.agentConfigResult.errors.length;
    }

    // Agent config warnings
    if (result.agentConfigResult.warnings.length > 0) {
      for (const warn of result.agentConfigResult.warnings) {
        // deno-lint-ignore no-console
        console.log(`  \u26A0 agent.json \u2014 ${warn}`);
      }
      totalWarnings += result.agentConfigResult.warnings.length;
    }

    // Registry schema
    if (result.registrySchemaResult) {
      if (result.registrySchemaResult.valid) {
        // deno-lint-ignore no-console
        console.log("  \u2713 steps_registry.json \u2014 Schema valid");
      } else {
        // deno-lint-ignore no-console
        console.log("  \u2717 steps_registry.json \u2014 Schema errors:");
        for (const err of result.registrySchemaResult.errors) {
          // deno-lint-ignore no-console
          console.log(`    - ${err.path}: ${err.message}`);
        }
        totalErrors += result.registrySchemaResult.errors.length;
      }
    }

    // Cross-references
    if (result.crossRefResult) {
      if (result.crossRefResult.valid) {
        // deno-lint-ignore no-console
        console.log(
          "  \u2713 steps_registry.json \u2014 Cross-references valid",
        );
      } else {
        // deno-lint-ignore no-console
        console.log(
          "  \u2717 steps_registry.json \u2014 Cross-reference errors:",
        );
        for (const err of result.crossRefResult.errors) {
          // deno-lint-ignore no-console
          console.log(`    - ${err}`);
        }
        totalErrors += result.crossRefResult.errors.length;
      }
    }

    // Path validation
    if (result.pathResult) {
      if (result.pathResult.valid) {
        // deno-lint-ignore no-console
        console.log("  \u2713 Paths \u2014 All referenced paths exist");
      } else {
        // deno-lint-ignore no-console
        console.log("  \u2717 Paths \u2014 Missing paths:");
        for (const err of result.pathResult.errors) {
          // deno-lint-ignore no-console
          console.log(`    - ${err}`);
        }
        totalErrors += result.pathResult.errors.length;
      }
      if (result.pathResult.warnings.length > 0) {
        for (const warn of result.pathResult.warnings) {
          // deno-lint-ignore no-console
          console.log(`  \u26A0 Paths \u2014 ${warn}`);
        }
        totalWarnings += result.pathResult.warnings.length;
      }
    }

    // Flow reachability
    if (result.flowResult) {
      if (result.flowResult.valid) {
        // deno-lint-ignore no-console
        console.log("  \u2713 Flow \u2014 Reachability check passed");
      } else {
        // deno-lint-ignore no-console
        console.log("  \u2717 Flow \u2014 Reachability errors:");
        for (const err of result.flowResult.errors) {
          // deno-lint-ignore no-console
          console.log(`    - ${err}`);
        }
        totalErrors += result.flowResult.errors.length;
      }
      if (result.flowResult.warnings.length > 0) {
        for (const warn of result.flowResult.warnings) {
          // deno-lint-ignore no-console
          console.log(`  \u26A0 Flow \u2014 ${warn}`);
        }
        totalWarnings += result.flowResult.warnings.length;
      }
    }

    // Prompt resolution
    if (result.promptResult) {
      if (result.promptResult.valid) {
        // deno-lint-ignore no-console
        console.log(
          "  \u2713 Prompts \u2014 All steps have valid prompt configuration",
        );
      } else {
        // deno-lint-ignore no-console
        console.log("  \u2717 Prompts \u2014 Prompt configuration errors:");
        for (const err of result.promptResult.errors) {
          // deno-lint-ignore no-console
          console.log(`    - ${err}`);
        }
        totalErrors += result.promptResult.errors.length;
      }
      if (result.promptResult.warnings.length > 0) {
        for (const warn of result.promptResult.warnings) {
          // deno-lint-ignore no-console
          console.log(`  \u26A0 Prompts \u2014 ${warn}`);
        }
        totalWarnings += result.promptResult.warnings.length;
      }
    }

    // UV Reachability
    if (result.uvReachabilityResult) {
      if (result.uvReachabilityResult.valid) {
        // deno-lint-ignore no-console
        console.log(
          "  \u2713 UV Reachability \u2014 All UV variables have supply sources",
        );
      } else {
        // deno-lint-ignore no-console
        console.log("  \u2717 UV Reachability \u2014 Supply source errors:");
        for (const err of result.uvReachabilityResult.errors) {
          // deno-lint-ignore no-console
          console.log(`    - ${err}`);
        }
        totalErrors += result.uvReachabilityResult.errors.length;
      }
      if (result.uvReachabilityResult.warnings.length > 0) {
        for (const warn of result.uvReachabilityResult.warnings) {
          // deno-lint-ignore no-console
          console.log(`  \u26A0 UV Reachability \u2014 ${warn}`);
        }
        totalWarnings += result.uvReachabilityResult.warnings.length;
      }
    }

    // Template UV Consistency
    if (result.templateUvResult) {
      if (result.templateUvResult.valid) {
        // deno-lint-ignore no-console
        console.log(
          "  \u2713 Template UV \u2014 Template placeholders match declarations",
        );
      } else {
        // deno-lint-ignore no-console
        console.log("  \u2717 Template UV \u2014 Consistency errors:");
        for (const err of result.templateUvResult.errors) {
          // deno-lint-ignore no-console
          console.log(`    - ${err}`);
        }
        totalErrors += result.templateUvResult.errors.length;
      }
      if (result.templateUvResult.warnings.length > 0) {
        for (const warn of result.templateUvResult.warnings) {
          // deno-lint-ignore no-console
          console.log(`  \u26A0 Template UV \u2014 ${warn}`);
        }
        totalWarnings += result.templateUvResult.warnings.length;
      }
    }

    // deno-lint-ignore no-console
    console.log("");
    const warningsSuffix = totalWarnings > 0
      ? ` (${totalWarnings} warning${totalWarnings !== 1 ? "s" : ""})`
      : "";

    if (result.valid) {
      // deno-lint-ignore no-console
      console.log(`Validation passed.${warningsSuffix}`);
    } else {
      // deno-lint-ignore no-console
      console.log(
        `Validation failed (${totalErrors} error${
          totalErrors !== 1 ? "s" : ""
        }${
          totalWarnings > 0
            ? `, ${totalWarnings} warning${totalWarnings !== 1 ? "s" : ""}`
            : ""
        }).\n` +
          `  \u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
      );
    }

    Deno.exit(result.valid ? 0 : 1);
  }

  // Initialize new agent
  if (args.init) {
    if (!args.agent) {
      // deno-lint-ignore no-console
      console.error(
        "Error: [CONFIGURATION] --agent <name> is required for init\n" +
          "  \u2192 Resolution: Add --agent <name> to your command\n" +
          "  \u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
      );
      Deno.exit(1);
    }
    try {
      await initAgent(args.agent);
      Deno.exit(0);
    } catch (error) {
      // deno-lint-ignore no-console
      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      Deno.exit(1);
    }
  }

  // Agent name is required
  if (!args.agent) {
    // deno-lint-ignore no-console
    console.error(
      "Error: [CONFIGURATION] --agent <name> is required\n" +
        "  \u2192 Resolution: Add --agent <name> to your command, " +
        "or use --list to see available agents\n" +
        "  \u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
    );
    Deno.exit(1);
  }

  const agentName = args.agent;

  try {
    // Load agent definition
    // deno-lint-ignore no-console
    console.log(`\nLoading agent: ${agentName}`);
    const definition = await loadConfiguration(agentName, Deno.cwd());
    // deno-lint-ignore no-console
    console.log(`  ${definition.displayName}: ${definition.description}`);

    // Build args for the runner
    const runnerArgs: Record<string, unknown> = {};

    // Map CLI args to runner args based on definition parameters
    if (definition.parameters) {
      for (const key of Object.keys(definition.parameters)) {
        // Convert camelCase to kebab-case for CLI arg lookup
        const kebabKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        const value = args[kebabKey] ?? args[key];
        if (value !== undefined) {
          runnerArgs[key] = value;
        }
      }
    }

    // Validate required parameters
    if (definition.parameters) {
      for (
        const [key, param] of Object.entries(definition.parameters)
      ) {
        if (param.required === true && runnerArgs[key] === undefined) {
          // deno-lint-ignore no-console
          console.error(
            `Error: [CONFIGURATION] Required parameter ${param.cli} is not provided for agent '${agentName}'\n` +
              `  \u2192 Resolution: Add ${param.cli} <value> to your command\n` +
              `  \u2192 See: docs/guides/en/12-troubleshooting.md#23-validation-failure`,
          );
          Deno.exit(1);
        }
      }
    }

    // Setup worktree if enabled in config
    // When worktree is enabled, branch name is auto-generated if not specified
    let workingDir = Deno.cwd();
    let worktreeResult: WorktreeSetupResult | undefined;

    const worktreeConfig = definition.runner.execution?.worktree;
    if (worktreeConfig?.enabled) {
      const setupConfig: WorktreeSetupConfig = {
        forceWorktree: true,
        worktreeRoot: worktreeConfig.root ?? ".worktrees",
      };

      // deno-lint-ignore no-console
      console.log(`\nSetting up worktree...`);
      worktreeResult = await setupWorktree(setupConfig, {
        branch: args.branch as string | undefined,
        baseBranch: args["base-branch"] as string | undefined,
      });

      workingDir = worktreeResult.worktreePath;
      // deno-lint-ignore no-console
      console.log(`  Branch: ${worktreeResult.branchName}`);
      // deno-lint-ignore no-console
      console.log(`  Base: ${worktreeResult.baseBranch}`);
      // deno-lint-ignore no-console
      console.log(`  Path: ${worktreeResult.worktreePath}`);
      if (worktreeResult.created) {
        // deno-lint-ignore no-console
        console.log(`  Status: Created new worktree`);
      } else {
        // deno-lint-ignore no-console
        console.log(`  Status: Using existing worktree`);
      }
    }

    // Create and run the agent
    const runner = new AgentRunner(definition);
    // deno-lint-ignore no-console
    console.log(`\nStarting ${definition.displayName}...\n`);

    const result = await runner.run({
      cwd: workingDir,
      args: runnerArgs,
      plugins: [],
      verbose: args.verbose,
    });

    // Report result
    // deno-lint-ignore no-console
    console.log(`\n${"=".repeat(60)}`);
    // deno-lint-ignore no-console
    console.log(`Agent completed: ${result.success ? "SUCCESS" : "FAILED"}`);
    // deno-lint-ignore no-console
    console.log(`Total iterations: ${result.iterations}`);
    // deno-lint-ignore no-console
    console.log(`Reason: ${result.reason}`);
    if (result.totalCostUsd !== undefined) {
      // deno-lint-ignore no-console
      console.log(`Total cost: $${result.totalCostUsd.toFixed(4)} USD`);
    }
    if (result.numTurns !== undefined) {
      // deno-lint-ignore no-console
      console.log(`SDK turns: ${result.numTurns}`);
    }
    if (result.durationMs !== undefined) {
      // deno-lint-ignore no-console
      console.log(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
    }
    if (result.error) {
      // deno-lint-ignore no-console
      console.error(`Error: ${result.error}`);
    }

    // Surface per-iteration errors for diagnosis
    if (!result.success) {
      const iterationErrors = result.summaries
        .filter((s) => s.errors.length > 0)
        .map((s) => `  iteration ${s.iteration}: ${s.errors.join("; ")}`);
      if (iterationErrors.length > 0) {
        // deno-lint-ignore no-console
        console.error(`Iteration errors:`);
        for (const line of iterationErrors) {
          // deno-lint-ignore no-console
          console.error(line);
        }
      }
      // Warn if no LLM interaction occurred at all
      const hasAnyLlmResponse = result.summaries.some((s) =>
        s.assistantResponses.length > 0
      );
      if (!hasAnyLlmResponse) {
        // deno-lint-ignore no-console
        console.error(
          "WARNING: No LLM responses received. " +
            "Check SDK availability, API key, and network connectivity.",
        );
      }
    }

    // Finalize worktree on success
    if (result.success && worktreeResult) {
      const parentCwd = Deno.cwd();

      // Build finalize options from CLI args and agent definition
      const finalizeConfig: FinalizeConfig =
        definition.runner.execution?.finalize ?? {};
      const finalizeOptions: FinalizeOptions = {
        autoMerge: !args["no-merge"] && (finalizeConfig.autoMerge ?? true),
        push: args.push || (finalizeConfig.push ?? false),
        remote: (args["push-remote"] as string) ||
          finalizeConfig.remote ||
          "origin",
        createPr: args["create-pr"] || (finalizeConfig.createPr ?? false),
        prTarget: (args["pr-target"] as string) || finalizeConfig.prTarget,
        logger: {
          info: (msg, meta) => {
            // deno-lint-ignore no-console
            console.log(`  ${msg}`, meta ? JSON.stringify(meta) : "");
          },
          warn: (msg, meta) => {
            // deno-lint-ignore no-console
            console.warn(`  ${msg}`, meta ? JSON.stringify(meta) : "");
          },
          error: (msg, meta) => {
            // deno-lint-ignore no-console
            console.error(`  ${msg}`, meta ? JSON.stringify(meta) : "");
          },
        },
      };

      // deno-lint-ignore no-console
      console.log(`\nFinalizing worktree...`);
      const finalizationOutcome = await finalizeWorktreeBranch(
        worktreeResult,
        finalizeOptions,
        parentCwd,
      );

      // Report finalization result
      // deno-lint-ignore no-console
      console.log(
        `\nFinalization: ${finalizationOutcome.status.toUpperCase()}`,
      );
      // deno-lint-ignore no-console
      console.log(`  Reason: ${finalizationOutcome.reason}`);

      if (finalizationOutcome.merge) {
        // deno-lint-ignore no-console
        console.log(
          `  Merge: ${
            finalizationOutcome.merge.success ? "OK" : "FAILED"
          } (${finalizationOutcome.merge.commitsMerged} commits)`,
        );
      }

      if (finalizationOutcome.push) {
        // deno-lint-ignore no-console
        console.log(
          `  Push: ${
            finalizationOutcome.push.success ? "OK" : "FAILED"
          } to ${finalizationOutcome.push.remote}`,
        );
      }

      if (finalizationOutcome.pr) {
        // deno-lint-ignore no-console
        console.log(
          `  PR: ${
            finalizationOutcome.pr.success
              ? finalizationOutcome.pr.url
              : "FAILED"
          }`,
        );
      }

      // deno-lint-ignore no-console
      console.log(
        `  Cleanup: ${finalizationOutcome.cleanedUp ? "Done" : "Skipped"}`,
      );

      if (finalizationOutcome.pendingActions?.length) {
        // deno-lint-ignore no-console
        console.log(`  Pending actions:`);
        for (const action of finalizationOutcome.pendingActions) {
          // deno-lint-ignore no-console
          console.log(`    - ${action}`);
        }
      }
    } else if (!result.success && worktreeResult) {
      // Agent failed - preserve worktree for recovery
      // deno-lint-ignore no-console
      console.log(`\nWorktree preserved for recovery:`);
      // deno-lint-ignore no-console
      console.log(`  Path: ${worktreeResult.worktreePath}`);
      // deno-lint-ignore no-console
      console.log(`  Branch: ${worktreeResult.branchName}`);
    }

    // deno-lint-ignore no-console
    console.log(`${"=".repeat(60)}\n`);

    // Output JSON result line for orchestrator dispatcher
    const dispatchResult: Record<string, unknown> = {
      outcome: result.success ? "success" : "failed",
    };
    if (result.rateLimitInfo) {
      dispatchResult.rateLimitInfo = result.rateLimitInfo;
    }
    // deno-lint-ignore no-console
    console.log(JSON.stringify(dispatchResult));

    Deno.exit(result.success ? 0 : 1);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // deno-lint-ignore no-console
    console.error(
      `\nError: [RUNTIME] ${msg}\n` +
        `  \u2192 See: docs/guides/en/12-troubleshooting.md`,
    );
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
