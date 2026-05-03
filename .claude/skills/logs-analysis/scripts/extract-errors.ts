#!/usr/bin/env -S deno run -A
/**
 * extract-errors.ts — Scan all tmp/logs JSONL for errors.
 *
 * Usage:
 *   deno run -A .claude/skills/logs-analysis/scripts/extract-errors.ts
 *   deno run -A .claude/skills/logs-analysis/scripts/extract-errors.ts --since 2026-04-20 --max 50
 *   deno run -A .claude/skills/logs-analysis/scripts/extract-errors.ts --root /path/to/tmp/logs
 *
 * Matches: level=error, or metadata.event in KNOWN_ERROR_EVENTS.
 * Output: single JSON object to stdout.
 */

import { parseArgs } from "jsr:@std/cli/parse-args";

const KNOWN_ERROR_EVENTS = new Set<string>([
  "issue_error",
  "label_sync_baseline_failed",
  "dispatch_result", // only counted when outcome=fail
]);

interface Hit {
  source: "orchestrator" | "agents";
  agentName?: string;
  file: string;
  step?: number;
  timestamp: string;
  level: string;
  message: string;
  event?: string;
  outcome?: string;
  metadata?: Record<string, unknown>;
}

interface Output {
  root: string;
  since: string | null;
  scannedFiles: number;
  totalHits: number;
  truncated: boolean;
  hits: Hit[];
}

async function* readLines(path: string): AsyncGenerator<string> {
  const file = await Deno.open(path, { read: true });
  try {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of file.readable) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        yield buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
      }
    }
    if (buffer.length > 0) yield buffer;
  } finally {
    try { file.close(); } catch { /* already closed */ }
  }
}

async function scanFile(
  path: string,
  source: "orchestrator" | "agents",
  agentName: string | undefined,
  sinceIso: string | null,
  max: number,
  out: Hit[],
): Promise<{ capped: boolean }> {
  for await (const line of readLines(path)) {
    if (!line.trim()) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = typeof ev.timestamp === "string" ? ev.timestamp : "";
    if (sinceIso && ts < sinceIso) continue;
    const level = typeof ev.level === "string" ? ev.level : "";
    const message = typeof ev.message === "string" ? ev.message : "";
    const metadata = (ev.metadata ?? undefined) as
      | Record<string, unknown>
      | undefined;
    const event = typeof metadata?.event === "string"
      ? (metadata.event as string)
      : undefined;
    const outcome = typeof metadata?.outcome === "string"
      ? (metadata.outcome as string)
      : undefined;

    const isError = level === "error";
    const isKnownErrorEvent = event !== undefined &&
      KNOWN_ERROR_EVENTS.has(event) &&
      (event !== "dispatch_result" || outcome === "fail");

    if (!isError && !isKnownErrorEvent) continue;

    out.push({
      source,
      agentName,
      file: path,
      step: typeof ev.step === "number" ? ev.step : undefined,
      timestamp: ts,
      level,
      message,
      event,
      outcome,
      metadata,
    });

    if (out.length >= max) return { capped: true };
  }
  return { capped: false };
}

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["since", "root", "max"],
    default: { max: "50" },
  });
  const root = args.root ?? "tmp/logs";
  const max = Number(args.max);
  if (!Number.isFinite(max) || max <= 0) {
    console.error(`invalid --max: ${args.max}`);
    Deno.exit(2);
  }
  const sinceIso = args.since ?? null;

  const hits: Hit[] = [];
  let scanned = 0;
  let truncated = false;

  // Orchestrator sessions.
  try {
    for await (const e of Deno.readDir(`${root}/orchestrator`)) {
      if (!e.isFile || !e.name.endsWith(".jsonl")) continue;
      scanned++;
      const r = await scanFile(
        `${root}/orchestrator/${e.name}`,
        "orchestrator",
        undefined,
        sinceIso,
        max,
        hits,
      );
      if (r.capped) {
        truncated = true;
        break;
      }
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }

  // Agent jsonl (per-agent subdirectories).
  if (!truncated) {
    try {
      for await (const dir of Deno.readDir(`${root}/agents`)) {
        if (!dir.isDirectory) continue;
        const agentName = dir.name;
        let capped = false;
        for await (const e of Deno.readDir(`${root}/agents/${agentName}`)) {
          if (!e.isFile || !e.name.endsWith(".jsonl")) continue;
          scanned++;
          const r = await scanFile(
            `${root}/agents/${agentName}/${e.name}`,
            "agents",
            agentName,
            sinceIso,
            max,
            hits,
          );
          if (r.capped) {
            truncated = true;
            capped = true;
            break;
          }
        }
        if (capped) break;
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }

  // Sort newest-first for downstream model consumption.
  hits.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const output: Output = {
    root,
    since: sinceIso,
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
