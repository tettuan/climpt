/**
 * Workflow Runner Entry Point
 *
 * Executes the orchestrator workflow loop.
 * Supports both single-issue mode (--issue) and batch mode (default).
 *
 * @module
 *
 * @example Run workflow for a single issue
 * ```bash
 * deno run --allow-all agents/scripts/run-workflow.ts --issue 123
 * ```
 *
 * @example Run workflow for issues with label "docs"
 * ```bash
 * deno run --allow-all agents/scripts/run-workflow.ts --label docs
 * ```
 *
 * @example Prioritize only
 * ```bash
 * deno run --allow-all agents/scripts/run-workflow.ts --label docs --prioritize
 * ```
 *
 * @example Dry run (no label changes)
 * ```bash
 * deno run --allow-all agents/scripts/run-workflow.ts --label docs --dry-run
 * ```
 *
 * @example Local mode (file-based, no GitHub API)
 * ```bash
 * deno run --allow-all agents/scripts/run-workflow.ts --local --issue 1 --dry-run
 * ```
 *
 * @example Stub dispatch (preconfigured agent outcomes)
 * ```bash
 * deno run --allow-all agents/scripts/run-workflow.ts --local --stub-dispatch '{"iterator":"success"}' --issue 1
 * ```
 */

import { join } from "@std/path";
import { parseArgs } from "@std/cli/parse-args";
import { loadWorkflow } from "../orchestrator/workflow-loader.ts";
import { Orchestrator } from "../orchestrator/orchestrator.ts";
import { GhCliClient } from "../orchestrator/github-client.ts";
import type { GitHubClient } from "../orchestrator/github-client.ts";
import {
  RunnerDispatcher,
  StubDispatcher,
} from "../orchestrator/dispatcher.ts";
import type { AgentDispatcher } from "../orchestrator/dispatcher.ts";
import { FileGitHubClient } from "../orchestrator/file-github-client.ts";
import { IssueStore } from "../orchestrator/issue-store.ts";
import type { IssueCriteria } from "../orchestrator/workflow-types.ts";

async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    string: [
      "workflow",
      "label",
      "repo",
      "state",
      "limit",
      "issue",
      "stub-dispatch",
    ],
    boolean: ["verbose", "dry-run", "help", "prioritize", "local"],
    alias: { h: "help", w: "workflow", v: "verbose", p: "prioritize" },
    collect: ["label"],
  });

  if (args.help) {
    // deno-lint-ignore no-console
    console.log(`
Workflow Runner

Usage:
  deno run --allow-all agents/scripts/run-workflow.ts [options]

Options:
  --issue <number>       Run workflow for a single issue (skips batch sync)
  --workflow, -w <path>  Path to workflow JSON (default: .agent/workflow.json)
  --label <label>        Filter issues by label (repeatable, batch mode)
  --repo <owner/repo>    Target repository (default: current repo)
  --state <state>        Issue state: open, closed, all (default: open)
  --limit <number>       Maximum issues to fetch (default: 30)
  --prioritize, -p       Run prioritizer agent only, then exit (batch mode)
  --verbose, -v          Enable verbose logging
  --dry-run              Skip label updates and comments (simulation mode)
  --local                Use file-based GitHub client (no GitHub API)
  --stub-dispatch <json> Use stub dispatcher with preconfigured outcomes (JSON)
  --help, -h             Show this help message
`);
    Deno.exit(0);
  }

  const cwd = Deno.cwd();
  const sharedOptions = {
    verbose: args.verbose,
    dryRun: args["dry-run"],
    workflowPath: args.workflow,
    local: args.local,
    stubDispatch: args["stub-dispatch"],
  };

  // Single-issue mode: --issue <number>
  if (args.issue !== undefined) {
    const issueNumber = Number(args.issue);
    if (!Number.isInteger(issueNumber) || issueNumber < 1) {
      // deno-lint-ignore no-console
      console.error(
        `Invalid --issue: ${args.issue}. Must be a positive integer.`,
      );
      Deno.exit(1);
    }
    await runSingleIssue(cwd, issueNumber, sharedOptions);
    return;
  }

  // Batch mode
  const validStates = ["open", "closed", "all"];
  if (args.state !== undefined && !validStates.includes(args.state)) {
    // deno-lint-ignore no-console
    console.error(
      `Invalid --state: ${args.state}. Must be: ${validStates.join(", ")}`,
    );
    Deno.exit(1);
  }

  const criteria: IssueCriteria = {};
  const labels = args.label as string[] | undefined;
  if (labels !== undefined && labels.length > 0) {
    criteria.labels = labels;
  }
  if (args.repo !== undefined) {
    criteria.repo = args.repo;
  }
  if (args.state !== undefined) {
    criteria.state = args.state as "open" | "closed" | "all";
  }
  if (args.limit !== undefined) {
    criteria.limit = Number(args.limit);
  }

  await runBatchWorkflow(cwd, criteria, {
    ...sharedOptions,
    prioritizeOnly: args.prioritize,
  });
}

async function runSingleIssue(
  cwd: string,
  issueNumber: number,
  options: {
    verbose: boolean;
    dryRun: boolean;
    workflowPath?: string;
    local: boolean;
    stubDispatch?: string;
  },
): Promise<void> {
  const config = await loadWorkflow(cwd, options.workflowPath);

  const store = options.local
    ? new IssueStore(
      join(cwd, config.issueStore?.path ?? ".agent/issues"),
    )
    : undefined;

  const github: GitHubClient = store
    ? new FileGitHubClient(store)
    : new GhCliClient(cwd);

  const dispatcher: AgentDispatcher = options.stubDispatch !== undefined
    ? new StubDispatcher(
      JSON.parse(options.stubDispatch) as Record<string, string>,
    )
    : new RunnerDispatcher(config, cwd);

  const orchestrator = new Orchestrator(config, github, dispatcher, cwd);

  const result = await orchestrator.run(issueNumber, {
    verbose: options.verbose,
    dryRun: options.dryRun,
  }, store);

  // deno-lint-ignore no-console
  console.log(JSON.stringify(result, null, 2));

  Deno.exit(result.status === "completed" ? 0 : 1);
}

async function runBatchWorkflow(
  cwd: string,
  criteria: IssueCriteria,
  options: {
    verbose: boolean;
    dryRun: boolean;
    prioritizeOnly: boolean;
    workflowPath?: string;
    local: boolean;
    stubDispatch?: string;
  },
): Promise<void> {
  const config = await loadWorkflow(cwd, options.workflowPath);

  const github: GitHubClient = options.local
    ? new FileGitHubClient(
      new IssueStore(
        join(cwd, config.issueStore?.path ?? ".agent/issues"),
      ),
    )
    : new GhCliClient(cwd);

  const dispatcher: AgentDispatcher = options.stubDispatch !== undefined
    ? new StubDispatcher(
      JSON.parse(options.stubDispatch) as Record<string, string>,
    )
    : new RunnerDispatcher(config, cwd);

  const orchestrator = new Orchestrator(config, github, dispatcher, cwd);

  const result = await orchestrator.runBatch(criteria, {
    verbose: options.verbose,
    dryRun: options.dryRun,
    prioritizeOnly: options.prioritizeOnly,
  });

  // deno-lint-ignore no-console
  console.log(JSON.stringify(result, null, 2));

  const hasFailure = result.status !== "completed";
  Deno.exit(hasFailure ? 1 : 0);
}

if (import.meta.main) {
  main();
}
