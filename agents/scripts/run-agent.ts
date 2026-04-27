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
import { listAgents } from "../runner/loader.ts";
import { agentBundleToResolvedDefinition } from "../config/mod.ts";
import { initAgent } from "../init.ts";
import { BootKernel } from "../boot/mod.ts";
import { isReject } from "../shared/validation/mod.ts";
import { BootValidationFailed } from "../shared/validation/boundary.ts";
import { Orchestrator } from "../orchestrator/orchestrator.ts";
import { RunnerDispatcher } from "../orchestrator/dispatcher.ts";
import { SubjectPicker } from "../orchestrator/subject-picker.ts";
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

Key Concepts:
  breakdown config    Config files defining prompt paths and validation patterns
                      Location: .agent/climpt/config/{agent}-{c1}-{app,user}.yml
  steps_registry      Step definitions, transitions, and UV variable declarations
                      Location: .agent/{agent}/steps_registry.json
  C3L paths           Prompt file organization: {c1}/{c2}/{c3}/f_{edition}.md
  UV variables        User variables substituted in prompts as {uv-name}

Documentation:
  Getting started:  docs/guides/en/10-getting-started-guide.md
  Config files:     docs/guides/en/06-config-files.md
  Steps registry:   docs/guides/en/14-steps-registry-guide.md
  Troubleshooting:  docs/guides/en/12-troubleshooting.md
  Quick Start:      agents/docs/builder/01_quickstart.md
  Definition Ref:   agents/docs/builder/02_agent_definition.md
  YAML Reference:   agents/docs/builder/reference/
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

    // Label existence
    if (result.labelExistenceResult) {
      if (result.labelExistenceResult.valid) {
        // deno-lint-ignore no-console
        console.log("  \u2713 Labels \u2014 All declared labels exist on repo");
      } else {
        // deno-lint-ignore no-console
        console.log("  \u2717 Labels \u2014 Missing labels on repository:");
        for (const err of result.labelExistenceResult.errors) {
          // deno-lint-ignore no-console
          console.log(`    - ${err}`);
        }
        totalErrors += result.labelExistenceResult.errors.length;
      }
      if (result.labelExistenceResult.warnings.length > 0) {
        for (const warn of result.labelExistenceResult.warnings) {
          // deno-lint-ignore no-console
          console.log(`  \u26A0 Labels \u2014 ${warn}`);
        }
        totalWarnings += result.labelExistenceResult.warnings.length;
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

    // Step Registry validation
    if (result.stepRegistryValidation) {
      if (result.stepRegistryValidation.valid) {
        // deno-lint-ignore no-console
        console.log(
          "  \u2713 Step Registry \u2014 All step definitions valid",
        );
      } else {
        // deno-lint-ignore no-console
        console.log("  \u2717 Step Registry \u2014 Step definition errors:");
        for (const err of result.stepRegistryValidation.errors) {
          // deno-lint-ignore no-console
          console.log(`    - ${err}`);
        }
        totalErrors += result.stepRegistryValidation.errors.length;
      }
      if (result.stepRegistryValidation.warnings.length > 0) {
        for (const warn of result.stepRegistryValidation.warnings) {
          // deno-lint-ignore no-console
          console.log(`  \u26A0 Step Registry \u2014 ${warn}`);
        }
        totalWarnings += result.stepRegistryValidation.warnings.length;
      }
    }

    // Handoff-to-inputs compatibility
    if (result.handoffInputsResult) {
      if (result.handoffInputsResult.valid) {
        // deno-lint-ignore no-console
        console.log(
          "  \u2713 Handoff Inputs \u2014 All handoff-to-inputs compatible",
        );
      } else {
        // deno-lint-ignore no-console
        console.log(
          "  \u2717 Handoff Inputs \u2014 Compatibility errors:",
        );
        for (const err of result.handoffInputsResult.errors) {
          // deno-lint-ignore no-console
          console.log(`    - ${err}`);
        }
        totalErrors += result.handoffInputsResult.errors.length;
      }
      if (result.handoffInputsResult.warnings.length > 0) {
        for (const warn of result.handoffInputsResult.warnings) {
          // deno-lint-ignore no-console
          console.log(`  \u26A0 Handoff Inputs \u2014 ${warn}`);
        }
        totalWarnings += result.handoffInputsResult.warnings.length;
      }
    }

    // Config-registry consistency
    if (result.configRegistryResult) {
      if (result.configRegistryResult.valid) {
        // deno-lint-ignore no-console
        console.log(
          "  \u2713 Config Registry \u2014 Registry/yml patterns consistent",
        );
      } else {
        // deno-lint-ignore no-console
        console.log(
          "  \u2717 Config Registry \u2014 Consistency errors:",
        );
        for (const err of result.configRegistryResult.errors) {
          // deno-lint-ignore no-console
          console.log(`    - ${err}`);
        }
        totalErrors += result.configRegistryResult.errors.length;
      }
      if (result.configRegistryResult.warnings.length > 0) {
        for (const warn of result.configRegistryResult.warnings) {
          // deno-lint-ignore no-console
          console.log(`  \u26A0 Config Registry \u2014 ${warn}`);
        }
        totalWarnings += result.configRegistryResult.warnings.length;
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
    // T2.4: Standalone agent mode goes through the full BootKernel
    // pipeline (per Critique F12 — no lite boot). `bootStandalone`
    // synthesises an in-memory single-agent WorkflowConfig and re-enters
    // the same validate-and-freeze path used by run-workflow.ts; the
    // agent doesn't need a `.agent/workflow.json` entry to run in
    // isolation.
    // deno-lint-ignore no-console
    console.log(`\nLoading agent: ${agentName}`);
    const decision = await BootKernel.bootStandalone({
      cwd: Deno.cwd(),
      agentName,
    });
    if (isReject(decision)) {
      throw new BootValidationFailed(decision.errors);
    }
    const artifacts = decision.value;
    const bundle = artifacts.agentRegistry.lookup(agentName);
    if (!bundle) {
      // bootStandalone built the registry from this bundle, so a missing
      // lookup would mean the bundle id mismatched the requested name —
      // surface a precise error rather than a generic "not found".
      throw new Error(
        `Internal: BootArtifacts is missing the standalone agent "${agentName}" — agent.json "name" must equal the directory id`,
      );
    }
    const definition = agentBundleToResolvedDefinition(bundle);
    // deno-lint-ignore no-console
    console.log(`  ${definition.displayName}: ${definition.description}`);

    // Build args for the runner
    const runnerArgs: Record<string, unknown> = {};

    // Map CLI args to runner args based on definition parameters.
    // Precedence: explicit CLI arg > parameter.default (from agent.json).
    // Without default-fallback, optional UV variables declared in
    // steps_registry.json fail prompt resolution even though agent.json
    // declares a default value.
    if (definition.parameters) {
      for (
        const [key, param] of Object.entries(definition.parameters)
      ) {
        // Convert camelCase to kebab-case for CLI arg lookup
        const kebabKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        const cliValue = args[kebabKey] ?? args[key];
        const value = cliValue ?? param.default;
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

    // T5.3 (R2b cutover): standalone agent mode now flows through the
    // same `SubjectPicker → Orchestrator → RunnerDispatcher → Channels`
    // spine workflow mode uses, instead of constructing
    // `new AgentRunner(definition)` directly. Per design 11 §C the
    // SubjectPicker is traversed in BOTH modes — only the input source
    // differs (gh listing vs argv lift). Boot already sealed the bus +
    // channels in `bootStandalone`; the orchestrator below publishes
    // `dispatchPlanned({ source: "argv" })` and the close path is
    // structurally identical to workflow mode (R5 hard gate).
    //
    // `--issue` is mandatory after the cutover: SubjectQueueItem has a
    // required `subjectId`. Surfacing this as a configuration error here
    // keeps the message symmetric with the existing required-parameter
    // handling above.
    const issueArg = args.issue !== undefined ? Number(args.issue) : undefined;
    if (issueArg === undefined || !Number.isFinite(issueArg)) {
      // deno-lint-ignore no-console
      console.error(
        "Error: [CONFIGURATION] --issue <number> is required " +
          "for standalone agent runs (T5.3 R2b cutover)\n" +
          "  → Resolution: Add --issue <number> to your command\n" +
          "  → See: docs/guides/en/12-troubleshooting.md#23-validation-failure",
      );
      Deno.exit(1);
    }

    // Build the same `RunnerDispatcher` + `Orchestrator` workflow mode
    // builds (run-workflow.ts §runSingleIssue / §runBatchWorkflow). All
    // close-path artifacts come from the frozen `bootStandalone`
    // BootArtifacts — no second source of truth. Note: the dispatcher's
    // `cwd` is the worktree path so the AgentRunner spawned inside
    // dispatch sees the worktree as its working directory.
    const dispatcher = new RunnerDispatcher(
      artifacts.workflow,
      artifacts.agentRegistry,
      workingDir,
      artifacts.bus,
      artifacts.runId,
      artifacts.boundaryClose,
    );
    const orchestrator = new Orchestrator(
      artifacts.workflow,
      artifacts.githubClient,
      dispatcher,
      workingDir,
      undefined,
      artifacts.agentRegistry,
      artifacts.bus,
      artifacts.runId,
      artifacts.directClose,
      artifacts.outboxClosePre,
      artifacts.outboxClosePost,
      artifacts.mergeCloseAdapter,
    );

    // Argv-lift path (design 11 §B): the picker is traversed but its
    // input source is argv, not the IssueQueryTransport. Queue length
    // is exactly 1 by construction.
    const picker = SubjectPicker.fromArgv({ subjectId: issueArg });
    const queue = await picker.pick();
    const item = queue[0];

    // deno-lint-ignore no-console
    console.log(`\nStarting ${definition.displayName}...\n`);

    // The CLI-derived `runnerArgs` map is forwarded as
    // `OrchestratorOptions.initialPayload` so the dispatcher merges it
    // into `AgentRunner.run({ args })` exactly as the legacy direct-
    // construction path did. Workflow mode reads payload from
    // `SubjectStore`; standalone mode has no store, so we hand the
    // already-projected map in directly (T5.3 cutover).
    const orchestratorResult = await orchestrator.runOne(item, {
      verbose: args.verbose,
      initialPayload: runnerArgs,
    });

    const success = orchestratorResult.status === "completed" ||
      orchestratorResult.status === "dry-run";

    // Report result
    // deno-lint-ignore no-console
    console.log(`\n${"=".repeat(60)}`);
    // deno-lint-ignore no-console
    console.log(`Agent completed: ${success ? "SUCCESS" : "FAILED"}`);
    // deno-lint-ignore no-console
    console.log(`Final phase: ${orchestratorResult.finalPhase}`);
    // deno-lint-ignore no-console
    console.log(`Status: ${orchestratorResult.status}`);
    // deno-lint-ignore no-console
    console.log(`Cycle count: ${orchestratorResult.cycleCount}`);
    // T6.2: `issueClosed` is no longer a result field — close success
    // is observable via the bus event log (`IssueClosedEvent`).
    // run-agent's standalone mode does not subscribe; the cycle status
    // alone is what we surface here.

    // Finalize worktree on success
    if (success && worktreeResult) {
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
    } else if (!success && worktreeResult) {
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

    // Output JSON result line for orchestrator dispatcher.
    // The cycle status is the canonical outcome for the standalone
    // path now that it flows through the orchestrator (T5.3); rate
    // limit info is observable on the bus for downstream consumers.
    const dispatchResult: Record<string, unknown> = {
      outcome: success ? "success" : "failed",
      status: orchestratorResult.status,
      finalPhase: orchestratorResult.finalPhase,
      cycleCount: orchestratorResult.cycleCount,
    };
    // deno-lint-ignore no-console
    console.log(JSON.stringify(dispatchResult));

    Deno.exit(success ? 0 : 1);
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
