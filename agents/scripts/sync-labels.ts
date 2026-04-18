/**
 * Label Sync CLI
 *
 * Standalone entry point that reconciles GitHub labels declared in
 * workflow.json#labels against the repository. Used as a pre-dispatch
 * hook for agents (notably the triager) that need the workflow label
 * set present before they run.
 *
 * The triager prompt invokes this CLI as Step 1 in place of the old
 * bash bootstrap block. Orchestrator batch mode already performs the
 * same reconciliation inside BatchRunner#preflightLabelSync, so this
 * script is only needed when running a label-consuming agent outside
 * the orchestrator.
 *
 * @module
 *
 * @example Sync labels using the default workflow.json
 * ```bash
 * deno task labels:sync
 * ```
 *
 * @example Dry-run against a custom workflow file
 * ```bash
 * deno task labels:sync --workflow my-workflow.json --dry-run
 * ```
 */

import { parseArgs } from "@std/cli/parse-args";
import { loadWorkflow } from "../orchestrator/workflow-loader.ts";
import { GhCliClient } from "../orchestrator/github-client.ts";
import {
  summarizeSync,
  syncLabels,
  type SyncResult,
} from "../orchestrator/label-sync.ts";

function printHelp(): void {
  // deno-lint-ignore no-console
  console.log(`
Label Sync CLI

Usage:
  deno run --allow-all agents/scripts/sync-labels.ts [options]
  deno task labels:sync [options]

Options:
  --workflow <path>  Path to workflow JSON (default: .agent/workflow.json)
  --dry-run          Compute actions without touching the repository
  --help, -h         Show this help message

Exit codes:
  0  All specs synced successfully (or nothing to do)
  1  One or more per-label operations failed
  2  CLI / config error (workflow load, unreadable repo state, etc.)
`);
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    string: ["workflow"],
    boolean: ["help", "dry-run"],
    alias: { h: "help", w: "workflow" },
  });

  if (args.help) {
    printHelp();
    Deno.exit(0);
  }

  const cwd = Deno.cwd();
  let config;
  try {
    config = await loadWorkflow(cwd, args.workflow);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // deno-lint-ignore no-console
    console.error(`Failed to load workflow: ${msg}`);
    Deno.exit(2);
  }

  const specs = config.labels;
  if (!specs || Object.keys(specs).length === 0) {
    // deno-lint-ignore no-console
    console.log("No labels[] declared in workflow.json — nothing to sync.");
    Deno.exit(0);
  }

  const github = new GhCliClient(cwd);

  let results: SyncResult[];
  try {
    results = await syncLabels(github, specs, { dryRun: args["dry-run"] });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // deno-lint-ignore no-console
    console.error(`Failed to read repository label state: ${msg}`);
    Deno.exit(2);
  }

  // deno-lint-ignore no-console
  console.log(summarizeSync(results));
  for (const r of results) {
    if (r.action === "failed") {
      // deno-lint-ignore no-console
      console.error(`  ${r.name}: FAILED — ${r.error ?? "unknown error"}`);
    } else if (r.action !== "nochange") {
      // deno-lint-ignore no-console
      console.log(`  ${r.name}: ${r.action}`);
    }
  }

  const hasFailure = results.some((r) => r.action === "failed");
  Deno.exit(hasFailure ? 1 : 0);
}

if (import.meta.main) {
  main();
}
