/**
 * Project Items CLI
 *
 * Lists items in a GitHub Project v2 with their field values.
 * Wraps the same underlying `gh project item-list` call as
 * GitHubClient.listProjectItems, plus getProjectFields for
 * field definitions.
 *
 * @module
 *
 * @example List items for a project
 * ```bash
 * deno task project:items tettuan/5
 * ```
 */

import { parseArgs } from "@std/cli/parse-args";
import { GhCliClient } from "../orchestrator/github-client.ts";

function printHelp(): void {
  // deno-lint-ignore no-console
  console.log(`
Project Items — List items in a GitHub Project v2

Usage:
  deno task project:items <owner>/<number>

Arguments:
  <owner>/<number>  Project reference (e.g. tettuan/5)

Options:
  --help, -h        Show this help message
`);
}

/** Raw item shape from gh project item-list --format json. */
interface RawProjectItem {
  id: string;
  content?: {
    type: string;
    number: number;
    title?: string;
  };
  [fieldName: string]: unknown;
}

/** Fetch full project items with field values via gh CLI. */
async function fetchFullProjectItems(
  cwd: string,
  owner: string,
  projectNumber: number,
): Promise<RawProjectItem[]> {
  const cmd = new Deno.Command("gh", {
    args: [
      "project",
      "item-list",
      String(projectNumber),
      "--owner",
      owner,
      "--format",
      "json",
    ],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr);
    throw new Error(
      `Failed to list project items for ${owner}/${projectNumber}: ${stderr}`,
    );
  }
  const stdout = new TextDecoder().decode(output.stdout).trim();
  if (stdout === "") return [];
  const data = JSON.parse(stdout) as { items: RawProjectItem[] };
  return (data.items ?? []).filter(
    (item) => item.content?.type === "Issue",
  );
}

/** Extract display value from a field value (string, object with name, etc.). */
function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.name === "string") return obj.name;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.date === "string") return obj.date;
    if (typeof obj.title === "string") return obj.title;
    return JSON.stringify(value);
  }
  return String(value);
}

function parseProjectRef(
  arg: string,
): { owner: string; number: number } | null {
  const match = arg.match(/^([^/]+)\/(\d+)$/);
  if (!match) return null;
  return { owner: match[1], number: Number(match[2]) };
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    boolean: ["help"],
    alias: { h: "help" },
  });

  if (args.help) {
    printHelp();
    Deno.exit(0);
  }

  const positional = args._.map(String);
  if (positional.length === 0) {
    // deno-lint-ignore no-console
    console.error("Error: <owner>/<number> argument is required.");
    printHelp();
    Deno.exit(1);
  }

  const ref = parseProjectRef(positional[0]);
  if (!ref) {
    // deno-lint-ignore no-console
    console.error(
      `Error: Invalid project reference "${
        positional[0]
      }". Expected format: <owner>/<number>`,
    );
    Deno.exit(1);
  }

  const cwd = Deno.cwd();
  const github = new GhCliClient(cwd);
  const project = { owner: ref.owner, number: ref.number };

  // Fetch field definitions and items in parallel.
  const [fields, items] = await Promise.all([
    github.getProjectFields(project),
    fetchFullProjectItems(cwd, ref.owner, ref.number),
  ]);

  if (items.length === 0) {
    // deno-lint-ignore no-console
    console.log(`No items found in project ${ref.owner}/${ref.number}.`);
    return;
  }

  // Determine which fields to display (exclude built-in metadata fields).
  const builtinKeys = new Set(["id", "content"]);
  const fieldNames = fields.map((f) => f.name);

  // Build header: ISSUE# | TITLE | <field1> | <field2> | ...
  const colWidths = [8, 40, ...fieldNames.map(() => 20)];
  const headers = ["ISSUE#", "TITLE", ...fieldNames];
  // deno-lint-ignore no-console
  console.log(
    headers.map((h, i) => h.slice(0, colWidths[i]).padEnd(colWidths[i])).join(
      "  ",
    ),
  );

  for (const item of items) {
    const issueNum = String(item.content?.number ?? "?");
    const title = item.content?.title ?? "";

    // Extract field values by matching field names to item properties.
    const fieldVals = fieldNames.map((name) => {
      if (builtinKeys.has(name)) return "";
      const raw = item[name];
      return formatFieldValue(raw);
    });

    const row = [
      issueNum.padEnd(colWidths[0]),
      title.slice(0, colWidths[1]).padEnd(colWidths[1]),
      ...fieldVals.map((v, i) =>
        v.slice(0, colWidths[i + 2]).padEnd(colWidths[i + 2])
      ),
    ];
    // deno-lint-ignore no-console
    console.log(row.join("  "));
  }
}

if (import.meta.main) {
  main();
}
