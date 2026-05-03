#!/usr/bin/env -S deno run -A
/**
 * summarize-agent.ts — Digest 1 per-agent JSONL (e.g. triager-*.jsonl).
 *
 * Usage:
 *   deno run -A .claude/skills/logs-analysis/scripts/summarize-agent.ts <path>
 *
 * Output: single JSON object to stdout.
 */

interface AgentEvent {
  timestamp: string;
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
}

interface ClosureAdaptation {
  timestamp: string;
  stepId?: unknown;
  source?: unknown;
  adaptation?: unknown;
  promptPath?: unknown;
}

interface ErrorEntry {
  timestamp: string;
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
}

interface MaxIterationHit {
  timestamp: string;
  message: string;
}

interface Summary {
  sourcePath: string;
  agentName: string;
  lineCount: number;
  parseErrors: number;
  start: string | null;
  end: string | null;
  durationMs: number | null;
  iterations: number;
  flowLoopEnters: number;
  flowLoopExits: number;
  completionLoopIterations: number;
  levelCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
  sdkMessageCounts: Record<string, number>;
  closureAdaptations: ClosureAdaptation[];
  maxIterationHits: MaxIterationHit[];
  errors: ErrorEntry[];
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

function extractPrefix(message: string): string | null {
  const m = message.match(/^\[([^\]]+)\]/);
  return m ? `[${m[1]}]` : null;
}

function deriveAgentName(path: string): string {
  const base = path.split("/").pop() ?? "";
  const m = base.match(/^([a-zA-Z_-]+?)-\d{4}-\d{2}-\d{2}T/);
  if (m) return m[1];
  const parent = path.split("/").slice(-2, -1)[0] ?? "unknown";
  return parent;
}

async function main() {
  const path = Deno.args[0];
  if (!path) {
    console.error("usage: summarize-agent.ts <agent.jsonl>");
    Deno.exit(2);
  }

  const summary: Summary = {
    sourcePath: path,
    agentName: deriveAgentName(path),
    lineCount: 0,
    parseErrors: 0,
    start: null,
    end: null,
    durationMs: null,
    iterations: 0,
    flowLoopEnters: 0,
    flowLoopExits: 0,
    completionLoopIterations: 0,
    levelCounts: {},
    prefixCounts: {},
    sdkMessageCounts: {},
    closureAdaptations: [],
    maxIterationHits: [],
    errors: [],
  };

  let firstTs: string | null = null;
  let lastTs: string | null = null;

  for await (const line of readLines(path)) {
    if (!line.trim()) continue;
    summary.lineCount++;
    let ev: AgentEvent;
    try {
      ev = JSON.parse(line);
    } catch {
      summary.parseErrors++;
      continue;
    }

    if (!firstTs) firstTs = ev.timestamp;
    lastTs = ev.timestamp;

    summary.levelCounts[ev.level] = (summary.levelCounts[ev.level] ?? 0) + 1;

    const prefix = extractPrefix(ev.message);
    if (prefix) {
      summary.prefixCounts[prefix] = (summary.prefixCounts[prefix] ?? 0) + 1;
    }

    // Iteration markers: "=== Iteration N ===" lines.
    if (/^=== Iteration \d+ ===/.test(ev.message)) {
      summary.iterations++;
    }

    if (ev.message.startsWith("[FlowLoop] Enter")) summary.flowLoopEnters++;
    if (ev.message.startsWith("[FlowLoop] Exit")) summary.flowLoopExits++;
    if (ev.message.startsWith("[CompletionLoop] Iteration enter")) {
      summary.completionLoopIterations++;
    }

    // SDK message classification: "SDK message: <kind>" / "SDK result".
    const sdkMatch = ev.message.match(/^SDK message: (\S+)/);
    if (sdkMatch) {
      summary.sdkMessageCounts[sdkMatch[1]] =
        (summary.sdkMessageCounts[sdkMatch[1]] ?? 0) + 1;
    } else if (ev.message === "SDK result") {
      summary.sdkMessageCounts["result"] =
        (summary.sdkMessageCounts["result"] ?? 0) + 1;
    } else if (ev.message === "Assistant response") {
      summary.sdkMessageCounts["assistant_response"] =
        (summary.sdkMessageCounts["assistant_response"] ?? 0) + 1;
    }

    if (ev.message.startsWith("[ClosureAdaptation] Resolved closure prompt")) {
      summary.closureAdaptations.push({
        timestamp: ev.timestamp,
        stepId: ev.metadata?.stepId ?? ev.metadata?.step,
        source: ev.metadata?.source,
        adaptation: ev.metadata?.adaptation,
        promptPath: ev.metadata?.promptPath,
      });
    }

    if (/^Maximum iterations \(\d+\) reached without finishing/.test(ev.message)) {
      summary.maxIterationHits.push({
        timestamp: ev.timestamp,
        message: ev.message,
      });
    }

    if (ev.level === "error") {
      summary.errors.push({
        timestamp: ev.timestamp,
        level: ev.level,
        message: ev.message,
        metadata: ev.metadata,
      });
    }
  }

  summary.start = firstTs;
  summary.end = lastTs;
  summary.durationMs = firstTs && lastTs
    ? new Date(lastTs).getTime() - new Date(firstTs).getTime()
    : null;

  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.main) {
  await main();
}
