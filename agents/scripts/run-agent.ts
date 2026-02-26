/**
 * Unified Agent Runner Entry Point
 *
 * Runs agents using the unified AgentRunner architecture.
 *
 * @module
 *
 * @example Run iterator agent
 * ```bash
 * deno run -A agents/scripts/run-agent.ts --agent iterator --issue 123
 * ```
 *
 * @example Run reviewer agent
 * ```bash
 * deno run -A agents/scripts/run-agent.ts --agent reviewer --issue 123
 * ```
 */

import { parseArgs } from "@std/cli/parse-args";
import { AgentRunner } from "../runner/runner.ts";
import { listAgents } from "../runner/loader.ts";
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

function printHelp(): void {
  // deno-lint-ignore no-console
  console.log(`
Unified Agent Runner

Usage:
  deno task agent --agent <name> [options]
  deno task agent --init --agent <name>
  deno task agent --list

Required:
  --agent, -a <name>     Agent name (iterator, reviewer, etc.)

Options:
  --help, -h             Show this help message
  --init                 Initialize new agent with basic template
  --list                 List available agents

Agent Initialization:
  --init creates a minimal agent template in .agent/<name>/

  For advanced scaffolding with step flow, use the scaffolder skill:
    /agent-scaffolder (in Claude Code)

  Note: The scaffolder skill requires the plugin-dev plugin.
  Install: https://github.com/anthropics/claude-code-plugin-dev

  Scaffolder features:
    - Interactive completionType selection
    - Step flow configuration (stepMachine)
    - Schema generation for structured outputs
    - C3L prompt structure setup

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
  # Initialize new agent
  deno task agent --init --agent my-agent

  # Work on a GitHub Issue
  deno task agent --agent iterator --issue 123

  # Review an issue
  deno task agent --agent reviewer --issue 123

Documentation:
  Quick Start:      agents/docs/builder/01_quickstart.md
  Definition Ref:   agents/docs/builder/02_agent_definition.md
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

  // Initialize new agent
  if (args.init) {
    if (!args.agent) {
      // deno-lint-ignore no-console
      console.error("Error: --agent <name> is required for init");
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
    console.error("Error: --agent <name> is required");
    // deno-lint-ignore no-console
    console.error(
      "Use --help for usage information or --list to see available agents",
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
            `Error: Required parameter ${param.cli} is not provided for agent '${agentName}'`,
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

    Deno.exit(result.success ? 0 : 1);
  } catch (error) {
    // deno-lint-ignore no-console
    console.error(
      `\nError: ${error instanceof Error ? error.message : String(error)}`,
    );
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
