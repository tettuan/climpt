#!/usr/bin/env -S deno run -A
/**
 * index-logs.ts — List recent tmp/logs files per category.
 *
 * Usage:
 *   deno run -A .claude/skills/logs-analysis/scripts/index-logs.ts
 *   deno run -A .claude/skills/logs-analysis/scripts/index-logs.ts --category orchestrator --limit 5
 *   deno run -A .claude/skills/logs-analysis/scripts/index-logs.ts --root /path/to/tmp/logs
 *
 * Output: single JSON object to stdout.
 */

import { parseArgs } from "jsr:@std/cli/parse-args";

type Category = "orchestrator" | "agents" | "examples" | "all";

interface FileEntry {
  path: string;
  mtime: string;
  sizeBytes: number;
}

interface ExamplesRunEntry {
  runId: string;
  path: string;
  mtime: string;
  fileCount: number;
  totalBytes: number;
}

interface Output {
  root: string;
  orchestrator?: FileEntry[];
  agents?: Record<string, FileEntry[]>;
  examples?: ExamplesRunEntry[];
}

async function listJsonl(dir: string, limit: number): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith(".jsonl")) continue;
      const path = `${dir}/${e.name}`;
      const stat = await Deno.stat(path);
      entries.push({
        path,
        mtime: stat.mtime?.toISOString() ?? "",
        sizeBytes: stat.size,
      });
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  entries.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return entries.slice(0, limit);
}

async function listAgents(
  agentsRoot: string,
  limit: number,
): Promise<Record<string, FileEntry[]>> {
  const out: Record<string, FileEntry[]> = {};
  try {
    for await (const e of Deno.readDir(agentsRoot)) {
      if (!e.isDirectory) continue;
      const files = await listJsonl(`${agentsRoot}/${e.name}`, limit);
      if (files.length > 0) out[e.name] = files;
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  return out;
}

async function listExamples(
  examplesRoot: string,
  limit: number,
): Promise<ExamplesRunEntry[]> {
  const entries: ExamplesRunEntry[] = [];
  try {
    for await (const e of Deno.readDir(examplesRoot)) {
      if (!e.isDirectory) continue;
      const runPath = `${examplesRoot}/${e.name}`;
      const stat = await Deno.stat(runPath);
      let fileCount = 0;
      let totalBytes = 0;
      for await (const f of Deno.readDir(runPath)) {
        if (!f.isFile) continue;
        fileCount++;
        const fstat = await Deno.stat(`${runPath}/${f.name}`);
        totalBytes += fstat.size;
      }
      entries.push({
        runId: e.name,
        path: runPath,
        mtime: stat.mtime?.toISOString() ?? "",
        fileCount,
        totalBytes,
      });
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  entries.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return entries.slice(0, limit);
}

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["category", "root", "limit"],
    default: { category: "all", limit: "10" },
  });
  const category = args.category as Category;
  const root = args.root ?? "tmp/logs";
  const limit = Number(args.limit);
  if (!Number.isFinite(limit) || limit <= 0) {
    console.error(`invalid --limit: ${args.limit}`);
    Deno.exit(2);
  }

  const output: Output = { root };

  if (category === "all" || category === "orchestrator") {
    output.orchestrator = await listJsonl(`${root}/orchestrator`, limit);
  }
  if (category === "all" || category === "agents") {
    output.agents = await listAgents(`${root}/agents`, limit);
  }
  if (category === "all" || category === "examples") {
    output.examples = await listExamples(`${root}/examples`, limit);
  }

  console.log(JSON.stringify(output, null, 2));
}

if (import.meta.main) {
  await main();
}
