#!/usr/bin/env -S deno run -A
/**
 * summarize-orchestrator.ts — Digest 1 orchestrator session JSONL.
 *
 * Usage:
 *   deno run -A .claude/skills/logs-analysis/scripts/summarize-orchestrator.ts <path>
 *
 * Output: single JSON object to stdout.
 */

interface OrchEvent {
  step?: number;
  timestamp: string;
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
}

interface Transition {
  step: number;
  timestamp: string;
  subjectId: unknown;
  fromPhase: unknown;
  toPhase: unknown;
}

interface ErrorEntry {
  step?: number;
  timestamp: string;
  level: string;
  message: string;
  event?: unknown;
  metadata?: Record<string, unknown>;
}

interface RunEnd {
  subjectId: unknown;
  finalPhase: unknown;
  cycleCount: unknown;
  status: unknown;
}

interface Summary {
  sourcePath: string;
  lineCount: number;
  parseErrors: number;
  runStart: string | null;
  runEnd: string | null;
  durationMs: number | null;
  levelCounts: Record<string, number>;
  eventCounts: Record<string, number>;
  subjectsProcessed: unknown[];
  transitions: Transition[];
  dispatchOutcomes: Record<string, Record<string, number>>;
  errors: ErrorEntry[];
  runEnds: RunEnd[];
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

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

async function main() {
  const path = Deno.args[0];
  if (!path) {
    console.error("usage: summarize-orchestrator.ts <session.jsonl>");
    Deno.exit(2);
  }

  const summary: Summary = {
    sourcePath: path,
    lineCount: 0,
    parseErrors: 0,
    runStart: null,
    runEnd: null,
    durationMs: null,
    levelCounts: {},
    eventCounts: {},
    subjectsProcessed: [],
    transitions: [],
    dispatchOutcomes: {},
    errors: [],
    runEnds: [],
  };

  const subjectsSet = new Set<string>();
  let firstTs: string | null = null;
  let lastTs: string | null = null;

  for await (const line of readLines(path)) {
    if (!line.trim()) continue;
    summary.lineCount++;
    let ev: OrchEvent;
    try {
      ev = JSON.parse(line);
    } catch {
      summary.parseErrors++;
      continue;
    }

    if (!firstTs) firstTs = ev.timestamp;
    lastTs = ev.timestamp;

    summary.levelCounts[ev.level] = (summary.levelCounts[ev.level] ?? 0) + 1;

    const event = asString(ev.metadata?.event);
    if (event) {
      summary.eventCounts[event] = (summary.eventCounts[event] ?? 0) + 1;
    }

    const subjectId = ev.metadata?.subjectId;
    if (subjectId !== undefined && subjectId !== null) {
      subjectsSet.add(JSON.stringify(subjectId));
    }

    if (event === "transition") {
      summary.transitions.push({
        step: ev.step ?? -1,
        timestamp: ev.timestamp,
        subjectId: ev.metadata?.subjectId,
        fromPhase: ev.metadata?.fromPhase,
        toPhase: ev.metadata?.toPhase,
      });
    }

    if (event === "dispatch_result") {
      const agent = String(ev.metadata?.agent ?? "unknown");
      const outcome = String(ev.metadata?.outcome ?? "unknown");
      summary.dispatchOutcomes[agent] ??= {};
      summary.dispatchOutcomes[agent][outcome] =
        (summary.dispatchOutcomes[agent][outcome] ?? 0) + 1;
    }

    if (event === "run_end") {
      summary.runEnds.push({
        subjectId: ev.metadata?.subjectId,
        finalPhase: ev.metadata?.finalPhase,
        cycleCount: ev.metadata?.cycleCount,
        status: ev.metadata?.status,
      });
    }

    if (
      ev.level === "error" ||
      event === "issue_error" ||
      event === "label_sync_baseline_failed"
    ) {
      summary.errors.push({
        step: ev.step,
        timestamp: ev.timestamp,
        level: ev.level,
        message: ev.message,
        event,
        metadata: ev.metadata,
      });
    }
  }

  summary.runStart = firstTs;
  summary.runEnd = lastTs;
  summary.durationMs = firstTs && lastTs
    ? new Date(lastTs).getTime() - new Date(firstTs).getTime()
    : null;
  summary.subjectsProcessed = [...subjectsSet].map((s) => JSON.parse(s));

  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.main) {
  await main();
}
