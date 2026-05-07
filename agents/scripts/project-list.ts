/**
 * Project List CLI
 *
 * Lists GitHub Projects v2 for a given owner.
 * Wraps GitHubClient.listUserProjects.
 *
 * @module
 *
 * @example List projects for the authenticated user
 * ```bash
 * deno task project:list
 * ```
 *
 * @example List projects for a specific owner
 * ```bash
 * deno task project:list --owner tettuan
 * ```
 */

import { parseArgs } from "@std/cli/parse-args";
import { GhCliClient } from "../orchestrator/github-client.ts";

function printHelp(): void {
  // deno-lint-ignore no-console
  console.log(`
Project List — List GitHub Projects v2

Usage:
  deno task project:list [--owner <owner>]

Options:
  --owner <owner>   Project owner (user or org). Defaults to authenticated user.
  --help, -h        Show this help message
`);
}

async function getDefaultOwner(): Promise<string> {
  const cmd = new Deno.Command("gh", {
    args: ["api", "user", "--jq", ".login"],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr);
    throw new Error(`Failed to determine default owner: ${stderr}`);
  }
  return new TextDecoder().decode(output.stdout).trim();
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    string: ["owner"],
    boolean: ["help"],
    alias: { h: "help" },
  });

  if (args.help) {
    printHelp();
    Deno.exit(0);
  }

  const owner = (args.owner && args.owner !== "")
    ? args.owner
    : await getDefaultOwner();

  const github = new GhCliClient(Deno.cwd());
  const projects = await github.listUserProjects(owner);

  if (projects.length === 0) {
    // deno-lint-ignore no-console
    console.log(`No projects found for ${owner}.`);
    return;
  }

  const widths = [8, 40, 8, 40] as const;
  const headers = ["NUMBER", "TITLE", "CLOSED", "DESCRIPTION"];
  // deno-lint-ignore no-console
  console.log(headers.map((h, i) => h.padEnd(widths[i])).join("  "));

  for (const p of projects) {
    // deno-lint-ignore no-console
    console.log(
      [
        String(p.number).padEnd(widths[0]),
        (p.title || "").slice(0, widths[1]).padEnd(widths[1]),
        String(p.closed).padEnd(widths[2]),
        (p.shortDescription || "").slice(0, widths[3]).padEnd(widths[3]),
      ].join("  "),
    );
  }
}

if (import.meta.main) {
  main();
}
