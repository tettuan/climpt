/**
 * Project Init Bootstrap Script
 *
 * Creates a sentinel issue for a project and adds it to the project.
 * The sentinel issue is used to trigger project-planner and project-evaluator
 * agents via the standard label → phase → agent routing.
 *
 * @module
 *
 * @example Create sentinel issue for project #5
 * ```bash
 * deno task project:init --project 5 --owner tettuan
 * ```
 */

import { parseArgs } from "@std/cli/parse-args";
import { GhCliClient } from "../orchestrator/github-client.ts";
import { loadWorkflow } from "../orchestrator/workflow-loader.ts";
import { resolvePhaseLabel } from "../orchestrator/phase-transition.ts";

function printHelp(): void {
  // deno-lint-ignore no-console
  console.log(`
Project Init — Create sentinel issue for project lifecycle

Usage:
  deno task project:init --project <N> --owner <owner> [--workflow <path>]

Required:
  --project <N>     GitHub Project v2 number
  --owner <owner>   Project owner (user or org)

Options:
  --workflow <path> Path to workflow.json (default: .agent/workflow.json)
  --help, -h        Show this help message
`);
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    string: ["project", "owner", "workflow"],
    boolean: ["help"],
    alias: { h: "help" },
  });

  if (args.help) {
    printHelp();
    Deno.exit(0);
  }

  if (args.project === undefined || args.project === "") {
    // deno-lint-ignore no-console
    console.error("Error: --project <N> is required.");
    printHelp();
    Deno.exit(1);
  }

  if (args.owner === undefined || args.owner === "") {
    // deno-lint-ignore no-console
    console.error("Error: --owner <owner> is required.");
    printHelp();
    Deno.exit(1);
  }

  const projectNumber = Number(args.project);
  if (!Number.isInteger(projectNumber) || projectNumber < 1) {
    // deno-lint-ignore no-console
    console.error(
      `Error: --project must be a positive integer, got: ${args.project}`,
    );
    Deno.exit(1);
  }

  const owner = args.owner;
  const cwd = Deno.cwd();
  const config = await loadWorkflow(cwd, args.workflow);

  // Sentinel bootstrap requires a fully-specified projectBinding. The
  // workflow-loader cross-ref checks (WF-PROJECT-010..013) guarantee that
  // planPhase / sentinelLabel resolve, but we still verify the block is
  // declared — running project:init against a workflow with no
  // projectBinding would be a category error the user should hear loud.
  const binding = config.projectBinding;
  if (binding === undefined) {
    // deno-lint-ignore no-console
    console.error(
      "Error: workflow.json has no 'projectBinding' block. " +
        "project:init requires projectBinding.planPhase / evalPhase / sentinelLabel " +
        "so the sentinel labels come from config, not hardcoded strings.",
    );
    Deno.exit(1);
  }

  const planLabel = resolvePhaseLabel(config, binding.planPhase);
  const evalLabel = resolvePhaseLabel(config, binding.evalPhase);
  if (planLabel === null || evalLabel === null) {
    // Loader invariant violated — treat as unrecoverable config drift.
    // deno-lint-ignore no-console
    console.error(
      "Error: projectBinding.planPhase / evalPhase have no labelMapping entry. " +
        "workflow-loader should have rejected this config (WF-PROJECT-006/013).",
    );
    Deno.exit(1);
  }

  const github = new GhCliClient(cwd);

  const title = `[Sentinel] Project #${projectNumber}`;
  const body = `Sentinel issue for project #${projectNumber}. ` +
    `This issue triggers the planner (via \`${planLabel}\`) and ` +
    `the evaluator (via \`${evalLabel}\`) agents through the standard ` +
    `label routing. Do not close manually.`;
  const labels = [planLabel, binding.sentinelLabel];

  // deno-lint-ignore no-console
  console.log(
    `Creating sentinel issue for project ${owner}/${projectNumber} ` +
      `with labels [${labels.join(", ")}]...`,
  );
  const issueNumber = await github.createIssue(title, labels, body);
  // deno-lint-ignore no-console
  console.log(`Created sentinel issue #${issueNumber}`);

  const project = { owner, number: projectNumber };
  const itemId = await github.addIssueToProject(project, issueNumber);
  // deno-lint-ignore no-console
  console.log(
    `Added sentinel #${issueNumber} to project ${owner}/${projectNumber} (item: ${itemId})`,
  );
}

if (import.meta.main) {
  main();
}
