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

function printHelp(): void {
  // deno-lint-ignore no-console
  console.log(`
Project Init — Create sentinel issue for project lifecycle

Usage:
  deno task project:init --project <N> --owner <owner>

Required:
  --project <N>     GitHub Project v2 number
  --owner <owner>   Project owner (user or org)

Options:
  --help, -h        Show this help message
`);
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    string: ["project", "owner"],
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
  const github = new GhCliClient(cwd);

  // Step 1: Create sentinel issue with kind:plan + project-sentinel labels.
  const title = `[Sentinel] Project #${projectNumber}`;
  const body = `Sentinel issue for project #${projectNumber}. ` +
    `This issue triggers project-planner (via \`kind:plan\`) and ` +
    `project-evaluator (via \`kind:eval\`) agents through the standard ` +
    `label routing. Do not close manually.`;
  const labels = ["kind:plan", "project-sentinel"];

  // deno-lint-ignore no-console
  console.log(
    `Creating sentinel issue for project ${owner}/${projectNumber}...`,
  );
  const issueNumber = await github.createIssue(title, labels, body);
  // deno-lint-ignore no-console
  console.log(`Created sentinel issue #${issueNumber}`);

  // Step 2: Add sentinel to the project.
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
