#!/usr/bin/env -S deno run -A
/**
 * search-logs.ts — Locate matching lines across tmp/logs and return file:line.
 *
 * Pipeline contract:
 *   - Haiku sub agent runs this script with filter flags.
 *   - Output is purely positional (file + 1-based line + minimal snippet).
 *   - Opus (main) reads the actual content via Read tool using the returned line.
 *
 * Usage:
 *   deno run -A .claude/skills/logs-analysis/scripts/search-logs.ts --query "rate limit"
 *   deno run -A .claude/skills/logs-analysis/scripts/search-logs.ts --category orchestrator --event dispatch_result --level error
 *   deno run -A .claude/skills/logs-analysis/scripts/search-logs.ts --agent reviewer --since 2026-04-20 --max 30
 *   deno run -A .claude/skills/logs-analysis/scripts/search-logs.ts --file tmp/logs/orchestrator/session-2026-04-24T12-52-42-266Z.jsonl --query "phase_resolved"
 *
 * Filters (all optional, AND-joined):
 *   --category <orchestrator|agents|examples|all>   (default: all)
 *   --agent <name>      restrict agents/<name>/* (implies category=agents)
 *   --file <path>       restrict to a single file (overrides category/agent)
 *   --query <regex>     match against message (JSONL) or raw line (examples)
 *   --event <name>      metadata.event equals (JSONL only)
 *   --level <name>      level equals (JSONL only; e.g. error|warn|info|debug)
 *   --since <ISO>       timestamp >= (JSONL only; examples lines have no ts)
 *   --until <ISO>       timestamp <  (JSONL only)
 *   --step <N>          step equals (orchestrator JSONL only)
 *   --max <N>           cap total hits (default: 100)
 *   --root <path>       tmp/logs root (default: tmp/logs)
 *
 * Output: single JSON object to stdout.
 */

import { parseArgs } from "jsr:@std/cli/parse-args";

type Category = "orchestrator" | "agents" | "examples" | "all";
type Source = "orchestrator" | "agents" | "examples";

interface Hit {
  source: Source;
  agentName?: string;
  runId?: string;
  file: string;
  line: number;
  timestamp?: string;
  level?: string;
  event?: string;
  step?: number;
  snippet: string;
}

interface Filters {
  query: RegExp | null;
  event: string | null;
  level: string | null;
  since: string | null;
  until: string | null;
  step: number | null;
}

interface Output {
  root: string;
  filters: {
    category: Category;
    agent: string | null;
    file: string | null;
    query: string | null;
    event: string | null;
    level: string | null;
    since: string | null;
    until: string | null;
    step: number | null;
  };
  scannedFiles: number;
  totalHits: number;
  truncated: boolean;
  hits: Hit[];
}

const SNIPPET_MAX = 240;

function snippetOf(s: string): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > SNIPPET_MAX
    ? oneLine.slice(0, SNIPPET_MAX) + "…"
    : oneLine;
}

async function* readLinesIndexed(
  path: string,
): AsyncGenerator<{ line: number; text: string }> {
  const file = await Deno.open(path, { read: true });
  try {
    const decoder = new TextDecoder();
    let buffer = "";
    let line = 0;
    for await (const chunk of file.readable) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        line++;
        yield { line, text: buffer.slice(0, nl) };
        buffer = buffer.slice(nl + 1);
      }
    }
    if (buffer.length > 0) {
      line++;
      yield { line, text: buffer };
    }
  } finally {
    try { file.close(); } catch { /* already closed */ }
  }
}

function matchJsonl(
  obj: Record<string, unknown>,
  filters: Filters,
): { ts?: string; level?: string; event?: string; step?: number; message: string } | null {
  const ts = typeof obj.timestamp === "string" ? obj.timestamp : undefined;
  const level = typeof obj.level === "string" ? obj.level : undefined;
  const message = typeof obj.message === "string" ? obj.message : "";
  const step = typeof obj.step === "number" ? obj.step : undefined;
  const metadata = (obj.metadata ?? undefined) as
    | Record<string, unknown>
    | undefined;
  const event = typeof metadata?.event === "string"
    ? (metadata.event as string)
    : undefined;

  if (filters.since && (!ts || ts < filters.since)) return null;
  if (filters.until && (!ts || ts >= filters.until)) return null;
  if (filters.level && level !== filters.level) return null;
  if (filters.event && event !== filters.event) return null;
  if (filters.step !== null && step !== filters.step) return null;
  if (filters.query && !filters.query.test(message)) return null;

  return { ts, level, event, step, message };
}

async function scanJsonl(
  path: string,
  source: "orchestrator" | "agents",
  agentName: string | undefined,
  filters: Filters,
  max: number,
  out: Hit[],
): Promise<{ capped: boolean }> {
  for await (const { line, text } of readLinesIndexed(path)) {
    if (!text.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(text);
    } catch {
      continue;
    }
    const m = matchJsonl(obj, filters);
    if (!m) continue;
    out.push({
      source,
      agentName,
      file: path,
      line,
      timestamp: m.ts,
      level: m.level,
      event: m.event,
      step: m.step,
      snippet: snippetOf(m.message),
    });
    if (out.length >= max) return { capped: true };
  }
  return { capped: false };
}

async function scanFreeForm(
  path: string,
  runId: string | undefined,
  filters: Filters,
  max: number,
  out: Hit[],
): Promise<{ capped: boolean }> {
  // Examples logs have no JSON / no timestamp / no event / no level / no step.
  // Only --query is meaningful; other JSONL-only filters are ignored here.
  if (!filters.query) return { capped: false }; // require query to avoid dumping the world
  for await (const { line, text } of readLinesIndexed(path)) {
    if (!filters.query.test(text)) continue;
    out.push({
      source: "examples",
      runId,
      file: path,
      line,
      snippet: snippetOf(text),
    });
    if (out.length >= max) return { capped: true };
  }
  return { capped: false };
}

async function* walkOrchestrator(root: string): AsyncGenerator<string> {
  try {
    for await (const e of Deno.readDir(`${root}/orchestrator`)) {
      if (e.isFile && e.name.endsWith(".jsonl")) {
        yield `${root}/orchestrator/${e.name}`;
      }
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}

async function* walkAgents(
  root: string,
  agentFilter: string | null,
): AsyncGenerator<{ path: string; agentName: string }> {
  try {
    for await (const dir of Deno.readDir(`${root}/agents`)) {
      if (!dir.isDirectory) continue;
      if (agentFilter && dir.name !== agentFilter) continue;
      for await (const e of Deno.readDir(`${root}/agents/${dir.name}`)) {
        if (e.isFile && e.name.endsWith(".jsonl")) {
          yield {
            path: `${root}/agents/${dir.name}/${e.name}`,
            agentName: dir.name,
          };
        }
      }
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}

async function* walkExamples(
  root: string,
): AsyncGenerator<{ path: string; runId: string }> {
  try {
    for await (const dir of Deno.readDir(`${root}/examples`)) {
      if (!dir.isDirectory) continue;
      for await (const e of Deno.readDir(`${root}/examples/${dir.name}`)) {
        if (e.isFile) {
          yield {
            path: `${root}/examples/${dir.name}/${e.name}`,
            runId: dir.name,
          };
        }
      }
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}

function classifyExplicitFile(
  path: string,
): { source: Source; agentName?: string; runId?: string } {
  // Best-effort source detection from path segments.
  if (path.includes("/orchestrator/")) return { source: "orchestrator" };
  const ag = path.match(/\/agents\/([^/]+)\//);
  if (ag) return { source: "agents", agentName: ag[1] };
  const ex = path.match(/\/examples\/([^/]+)\//);
  if (ex) return { source: "examples", runId: ex[1] };
  // Default to free-form scan.
  return { source: "examples" };
}

async function main() {
  const args = parseArgs(Deno.args, {
    string: [
      "category",
      "agent",
      "file",
      "query",
      "event",
      "level",
      "since",
      "until",
      "step",
      "max",
      "root",
    ],
    default: { category: "all", max: "100" },
  });

  const root = args.root ?? "tmp/logs";
  const max = Number(args.max);
  if (!Number.isFinite(max) || max <= 0) {
    console.error(`invalid --max: ${args.max}`);
    Deno.exit(2);
  }

  let category = args.category as Category;
  const agentFilter = args.agent ?? null;
  const fileFilter = args.file ?? null;

  if (agentFilter && category === "all") category = "agents";

  let queryRe: RegExp | null = null;
  if (args.query) {
    try {
      queryRe = new RegExp(args.query, "i");
    } catch (err) {
      console.error(`invalid --query regex: ${(err as Error).message}`);
      Deno.exit(2);
    }
  }

  let stepNum: number | null = null;
  if (args.step !== undefined) {
    const n = Number(args.step);
    if (!Number.isFinite(n)) {
      console.error(`invalid --step: ${args.step}`);
      Deno.exit(2);
    }
    stepNum = n;
  }

  const filters: Filters = {
    query: queryRe,
    event: args.event ?? null,
    level: args.level ?? null,
    since: args.since ?? null,
    until: args.until ?? null,
    step: stepNum,
  };

  const hits: Hit[] = [];
  let scanned = 0;
  let truncated = false;

  const checkCap = (capped: boolean) => {
    if (capped) truncated = true;
    return capped;
  };

  if (fileFilter) {
    const cls = classifyExplicitFile(fileFilter);
    scanned++;
    if (cls.source === "examples") {
      const r = await scanFreeForm(fileFilter, cls.runId, filters, max, hits);
      checkCap(r.capped);
    } else {
      const r = await scanJsonl(
        fileFilter,
        cls.source,
        cls.agentName,
        filters,
        max,
        hits,
      );
      checkCap(r.capped);
    }
  } else {
    if (!truncated && (category === "all" || category === "orchestrator")) {
      for await (const path of walkOrchestrator(root)) {
        scanned++;
        const r = await scanJsonl(path, "orchestrator", undefined, filters, max, hits);
        if (checkCap(r.capped)) break;
      }
    }
    if (!truncated && (category === "all" || category === "agents")) {
      for await (const { path, agentName } of walkAgents(root, agentFilter)) {
        scanned++;
        const r = await scanJsonl(path, "agents", agentName, filters, max, hits);
        if (checkCap(r.capped)) break;
      }
    }
    if (!truncated && (category === "all" || category === "examples")) {
      for await (const { path, runId } of walkExamples(root)) {
        scanned++;
        const r = await scanFreeForm(path, runId, filters, max, hits);
        if (checkCap(r.capped)) break;
      }
    }
  }

  // Sort newest-first when timestamp is available; keep stable order otherwise.
  hits.sort((a, b) => {
    if (a.timestamp && b.timestamp) {
      return b.timestamp.localeCompare(a.timestamp);
    }
    if (a.timestamp) return -1;
    if (b.timestamp) return 1;
    return a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file);
  });

  const output: Output = {
    root,
    filters: {
      category,
      agent: agentFilter,
      file: fileFilter,
      query: args.query ?? null,
      event: args.event ?? null,
      level: args.level ?? null,
      since: args.since ?? null,
      until: args.until ?? null,
      step: stepNum,
    },
    scannedFiles: scanned,
    totalHits: hits.length,
    truncated,
    hits,
  };

  console.log(JSON.stringify(output, null, 2));
}

if (import.meta.main) {
  await main();
}
