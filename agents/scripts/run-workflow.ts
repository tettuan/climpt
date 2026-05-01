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
 * deno task orchestrator --issue 123
 * ```
 *
 * @example Run workflow for issues with label "docs"
 * ```bash
 * deno task orchestrator --label docs
 * ```
 *
 * @example Prioritize only
 * ```bash
 * deno task orchestrator --label docs --prioritize
 * ```
 *
 * @example Dry run (no label changes)
 * ```bash
 * deno task orchestrator --label docs --dry-run
 * ```
 *
 * @example Local mode (file-based, no GitHub API)
 * ```bash
 * deno task orchestrator --local --issue 1 --dry-run
 * ```
 *
 * @example Stub dispatch (preconfigured agent outcomes)
 * ```bash
 * deno task orchestrator --local --stub-dispatch '{"iterator":"success"}' --issue 1
 * ```
 */

import { join } from "@std/path";
import { parseArgs } from "@std/cli/parse-args";
import { Orchestrator } from "../orchestrator/orchestrator.ts";
import type { GitHubClient } from "../orchestrator/github-client.ts";
import {
  RunnerDispatcher,
  StubDispatcher,
} from "../orchestrator/dispatcher.ts";
import type { AgentDispatcher } from "../orchestrator/dispatcher.ts";
import { FileGitHubClient } from "../orchestrator/file-github-client.ts";
import { SubjectStore } from "../orchestrator/subject-store.ts";
import {
  DEFAULT_SUBJECT_STORE,
  type IssueSource,
  type ProjectRef,
} from "../orchestrator/workflow-types.ts";
import { detectRuntimeOrigin } from "../common/runtime-origin.ts";
import { BootKernel } from "../boot/mod.ts";
import type { BootArtifacts } from "../boot/types.ts";
import { isReject } from "../shared/validation/mod.ts";
import { BootValidationFailed } from "../shared/validation/boundary.ts";

/**
 * Run the full Boot pipeline (`BootKernel.boot`) and project the result
 * into a `BootArtifacts` aggregate, throwing {@link BootValidationFailed}
 * on Reject.
 *
 * Per design 10 §E (3 modes share Boot) + Critique F12 (no lite-boot),
 * every entry point that needs config goes through the same kernel —
 * `loadWorkflow` and `loadAgentBundle` are no longer called from script
 * code. Boot rejections are surfaced as a single thrown
 * `BootValidationFailed` at the entry-point boundary so callers that
 * already catch generic `Error` keep working unchanged.
 *
 * PR4-2a note: when `localGithubClient` is provided (`--local` mode),
 * the entry point passes it to `BootKernel.boot` so the
 * boot-constructed `closeTransport` delegates to the FileGitHubClient
 * instead of shelling out to the real `gh` CLI. The `--local` path
 * cannot construct the `FileGitHubClient` from `workflow.subjectStore`
 * (workflow is loaded inside boot), so it uses `DEFAULT_SUBJECT_STORE`
 * — the matching post-boot construction below also re-uses the default
 * for the entry point's own `github` reference. Custom
 * `workflow.subjectStore.path` configurations therefore still work for
 * read-side operations (entry-point re-constructs the client with the
 * actual workflow path); only the close transport uses the default
 * path, which is fine because PR4-2a channels still `skip`.
 */
async function bootOrThrow(
  cwd: string,
  workflowPath: string | undefined,
  localGithubClient: GitHubClient | undefined,
): Promise<BootArtifacts> {
  const decision = await BootKernel.boot({
    cwd,
    workflowFile: workflowPath,
    githubClient: localGithubClient,
  });
  if (isReject(decision)) {
    throw new BootValidationFailed(decision.errors);
  }
  return decision.value;
}

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
      "project",
    ],
    boolean: [
      "verbose",
      "dry-run",
      "help",
      "prioritize",
      "local",
      "all-projects",
    ],
    alias: { h: "help", w: "workflow", v: "verbose", p: "prioritize" },
    collect: ["label"],
  });

  const origin = detectRuntimeOrigin(import.meta.url);
  // deno-lint-ignore no-console
  console.log(
    `[orchestrator] climpt ${origin.version} source=${origin.source} (${origin.moduleUrl})`,
  );

  if (args.help) {
    // deno-lint-ignore no-console
    console.log(`
Workflow Runner

Usage:
  deno run --allow-all @aidevtool/climpt/agents/orchestrator [options]
  deno task orchestrator [options]

Options:
  --issue <number>       Run workflow for a single issue (skips batch sync)
  --workflow, -w <path>  Path to workflow JSON (default: .agent/workflow.json)
  --label <label>        Filter issues by label (repeatable, batch mode)
  --repo <owner/repo>    Target repository (default: current repo)
  --state <state>        Issue state: open, closed, all (default: open)
  --project <owner/number> Filter issues by GitHub Project v2 (batch mode).
                         When omitted, only issues that belong to NO project
                         are processed; pass --all-projects to override.
  --all-projects         Disable the default unbound-only filter; process
                         every matching issue regardless of project membership
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

  const labels = args.label as string[] | undefined;
  const sharedListing = {
    labels: labels !== undefined && labels.length > 0 ? labels : undefined,
    state: args.state !== undefined
      ? (args.state as "open" | "closed" | "all")
      : undefined,
    limit: args.limit !== undefined ? Number(args.limit) : undefined,
  } as const;

  let projectRef: ProjectRef | undefined;
  if (args.project !== undefined) {
    const parts = args.project.split("/");
    if (
      parts.length !== 2 || parts[1] === "" || Number.isNaN(Number(parts[1]))
    ) {
      // deno-lint-ignore no-console
      console.error(
        `Invalid --project: ${args.project}. Must be <owner>/<number> (e.g., tettuan/5).`,
      );
      Deno.exit(1);
    }
    projectRef = { owner: parts[0], number: Number(parts[1]) };
  }

  if (args["all-projects"] && projectRef !== undefined) {
    // deno-lint-ignore no-console
    console.error(
      `--all-projects cannot be combined with --project. ` +
        `Pick one scoping mode.`,
    );
    Deno.exit(1);
  }

  // Map CLI scoping flags onto the IssueSource ADT (12 §C):
  //   --project=X       → { kind: "ghProject", project: X, ... }
  //   --all-projects    → { kind: "ghRepoIssues", projectMembership: "any", ... }
  //   default           → { kind: "ghRepoIssues", projectMembership: "unbound", ... }
  // The default branch preserves the legacy "unbound issues only" filter
  // (criteria.project === undefined && !criteria.allProjects).
  const source: IssueSource = projectRef !== undefined
    ? {
      kind: "ghProject",
      project: projectRef,
      labels: sharedListing.labels,
      state: sharedListing.state,
      limit: sharedListing.limit,
    }
    : {
      kind: "ghRepoIssues",
      repo: args.repo,
      labels: sharedListing.labels,
      state: sharedListing.state,
      limit: sharedListing.limit,
      projectMembership: args["all-projects"] ? "any" : "unbound",
    };

  await runBatchWorkflow(cwd, source, {
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
  // T2.4: full Boot — single source of WorkflowConfig + AgentRegistry +
  // Policy for the whole process. Boot rejections throw
  // BootValidationFailed at this boundary (T1.4 helper).
  //
  // PR4-2a: `--local` injects a fixture FileGitHubClient (against the
  // DEFAULT_SUBJECT_STORE) so the boot-constructed CloseTransport
  // delegates to the local store rather than shelling out to `gh`.
  // The entry point re-creates the FileGitHubClient post-boot using
  // the workflow-resolved subjectStore path so the read-side seam
  // honours custom `workflow.subjectStore` configurations.
  const localGithubClient = options.local
    ? new FileGitHubClient(
      new SubjectStore(join(cwd, DEFAULT_SUBJECT_STORE.path)),
    )
    : undefined;
  const artifacts = await bootOrThrow(
    cwd,
    options.workflowPath,
    localGithubClient,
  );
  const { workflow, agentRegistry, bus, runId } = artifacts;

  const store = options.local
    ? new SubjectStore(
      join(cwd, (workflow.subjectStore ?? DEFAULT_SUBJECT_STORE).path),
    )
    : undefined;

  // Read-side seam: `--local` uses a workflow-resolved FileGitHubClient;
  // production reads from `artifacts.githubClient` (the same instance
  // bound to the close transport — single source of gh-CLI seam).
  const github: GitHubClient = store
    ? new FileGitHubClient(store)
    : artifacts.githubClient;

  // StubDispatcher tests bypass the real dispatcher path. The real
  // dispatcher uses the frozen registry from BootArtifacts directly —
  // no per-call disk loads (T2.3 contract). T3.3 threads
  // `BootArtifacts.bus` + `runId` so dispatched runners publish
  // `closureBoundaryReached` against the same boot correlation id.
  const dispatcher: AgentDispatcher = options.stubDispatch !== undefined
    ? new StubDispatcher(
      JSON.parse(options.stubDispatch) as Record<string, string>,
    )
    : new RunnerDispatcher(
      workflow,
      agentRegistry,
      cwd,
      bus,
      runId,
      artifacts.boundaryClose,
    );

  const orchestrator = new Orchestrator(
    workflow,
    github,
    dispatcher,
    cwd,
    undefined,
    agentRegistry,
    bus,
    runId,
    artifacts.directClose,
    artifacts.outboxClosePre,
    artifacts.outboxClosePost,
    artifacts.mergeCloseAdapter,
  );

  // Note: artifacts.policy is currently consulted via loadPolicy at
  // subprocess boundaries. T6.4 will thread it through Orchestrator so
  // merge-pr inherits transport polarity.

  const result = await orchestrator.run(issueNumber, {
    verbose: options.verbose,
    dryRun: options.dryRun,
  }, store);

  // deno-lint-ignore no-console
  console.log(JSON.stringify(result, null, 2));

  Deno.exit(
    result.status === "completed" || result.status === "dry-run" ? 0 : 1,
  );
}

async function runBatchWorkflow(
  cwd: string,
  source: IssueSource,
  options: {
    verbose: boolean;
    dryRun: boolean;
    prioritizeOnly: boolean;
    workflowPath?: string;
    local: boolean;
    stubDispatch?: string;
  },
): Promise<void> {
  // T2.4: see runSingleIssue for rationale.
  // PR4-2a: same `--local` injection pattern as runSingleIssue —
  // boot binds the close transport to the fixture client.
  const localGithubClient = options.local
    ? new FileGitHubClient(
      new SubjectStore(join(cwd, DEFAULT_SUBJECT_STORE.path)),
    )
    : undefined;
  const artifacts = await bootOrThrow(
    cwd,
    options.workflowPath,
    localGithubClient,
  );
  const { workflow, agentRegistry, bus, runId } = artifacts;

  const github: GitHubClient = options.local
    ? new FileGitHubClient(
      new SubjectStore(
        join(cwd, (workflow.subjectStore ?? DEFAULT_SUBJECT_STORE).path),
      ),
    )
    : artifacts.githubClient;

  const dispatcher: AgentDispatcher = options.stubDispatch !== undefined
    ? new StubDispatcher(
      JSON.parse(options.stubDispatch) as Record<string, string>,
    )
    : new RunnerDispatcher(
      workflow,
      agentRegistry,
      cwd,
      bus,
      runId,
      artifacts.boundaryClose,
    );

  const orchestrator = new Orchestrator(
    workflow,
    github,
    dispatcher,
    cwd,
    undefined,
    agentRegistry,
    bus,
    runId,
    artifacts.directClose,
    artifacts.outboxClosePre,
    artifacts.outboxClosePost,
    artifacts.mergeCloseAdapter,
  );

  const result = await orchestrator.runBatch(source, {
    verbose: options.verbose,
    dryRun: options.dryRun,
    prioritizeOnly: options.prioritizeOnly,
  });

  // deno-lint-ignore no-console
  console.log(JSON.stringify(result, null, 2));

  const hasFailure = result.status === "failed" || result.status === "partial";
  Deno.exit(hasFailure ? 1 : 0);
}

if (import.meta.main) {
  main();
}
