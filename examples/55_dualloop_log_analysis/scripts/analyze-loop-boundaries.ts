/**
 * Dual-Loop Log Boundary Analysis
 *
 * Reads a JSONL execution log and verifies that FlowLoop and CompletionLoop
 * boundary markers are correctly sequenced and paired.
 *
 * This is a contract verification step (no LLM required).
 *
 * Usage:
 *   deno run --allow-read analyze-loop-boundaries.ts <path-to-jsonl>
 */

// deno-lint-ignore no-console
const log = console.log;
// deno-lint-ignore no-console
const logErr = console.error;

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    log(`  PASS: ${name}`);
    passed++;
  } else {
    logErr(`  FAIL: ${name}${detail ? ": " + detail : ""}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Read and parse JSONL
// ---------------------------------------------------------------------------
const filePath = Deno.args[0];
if (!filePath) {
  logErr("Usage: analyze-loop-boundaries.ts <path-to-jsonl>");
  Deno.exit(2);
}

const text = await Deno.readTextFile(filePath);
const lines = text.trim().split("\n");

interface LogEntry {
  level: string;
  msg: string;
  iteration?: number;
  stepId?: string;
  done?: boolean;
  reason?: string;
  valid?: boolean;
  [key: string]: unknown;
}

const entries: LogEntry[] = lines.map((line, i) => {
  try {
    return JSON.parse(line) as LogEntry;
  } catch {
    logErr(`  Warning: failed to parse line ${i + 1}: ${line}`);
    return { level: "unknown", msg: "" };
  }
});

// Extract loop-related entries in order
const flowLoopEntries = entries.filter((e) => e.msg.includes("[FlowLoop]"));
const completionLoopEntries = entries.filter((e) =>
  e.msg.includes("[CompletionLoop]")
);

log("=== Dual-Loop Log Boundary Analysis ===\n");

// ---------------------------------------------------------------------------
// Assertion 1: FlowLoop markers exist
// ---------------------------------------------------------------------------
log("--- Assertion 1: FlowLoop markers exist ---");
{
  const flowEnters = flowLoopEntries.filter((e) =>
    e.msg.includes("[FlowLoop] Enter")
  );
  assert(
    "At least one [FlowLoop] Enter found",
    flowEnters.length > 0,
    `found ${flowEnters.length}`,
  );
}

// ---------------------------------------------------------------------------
// Assertion 2: CompletionLoop markers exist
// ---------------------------------------------------------------------------
log("\n--- Assertion 2: CompletionLoop markers exist ---");
{
  const clEnters = completionLoopEntries.filter((e) =>
    e.msg.includes("[CompletionLoop] Enter")
  );
  const clExits = completionLoopEntries.filter((e) =>
    e.msg.includes("[CompletionLoop] Exit")
  );
  assert(
    "At least one [CompletionLoop] Enter found",
    clEnters.length > 0,
    `found ${clEnters.length}`,
  );
  assert(
    "At least one [CompletionLoop] Exit found",
    clExits.length > 0,
    `found ${clExits.length}`,
  );
}

// ---------------------------------------------------------------------------
// Assertion 3: CompletionLoop Enter/Exit pairing
// ---------------------------------------------------------------------------
log("\n--- Assertion 3: CompletionLoop Enter/Exit pairing ---");
{
  // Walk through CompletionLoop entries and track nesting
  let depth = 0;
  let balanced = true;
  for (const entry of completionLoopEntries) {
    // Only count bare Enter/Exit, not "Iteration enter"/"Iteration exit"
    if (
      entry.msg === "[CompletionLoop] Enter" ||
      entry.msg.startsWith("[CompletionLoop] Enter,")
    ) {
      depth++;
    } else if (entry.msg.startsWith("[CompletionLoop] Exit")) {
      depth--;
      if (depth < 0) {
        balanced = false;
        break;
      }
    }
  }
  assert(
    "Every [CompletionLoop] Enter has a matching Exit",
    balanced && depth === 0,
    `final depth=${depth}, balanced=${balanced}`,
  );
}

// ---------------------------------------------------------------------------
// Assertion 4: CompletionLoop Iteration enter/exit pairing
// ---------------------------------------------------------------------------
log("\n--- Assertion 4: CompletionLoop Iteration enter/exit pairing ---");
{
  const iterEnters = completionLoopEntries.filter((e) =>
    e.msg.includes("[CompletionLoop] Iteration enter")
  );
  const iterExits = completionLoopEntries.filter((e) =>
    e.msg.includes("[CompletionLoop] Iteration exit")
  );
  assert(
    "Iteration enter count equals Iteration exit count",
    iterEnters.length === iterExits.length,
    `enters=${iterEnters.length}, exits=${iterExits.length}`,
  );

  // Verify sequential pairing: each enter is followed by an exit before the next enter
  let iterDepth = 0;
  let iterBalanced = true;
  for (const entry of completionLoopEntries) {
    if (entry.msg.includes("[CompletionLoop] Iteration enter")) {
      iterDepth++;
      if (iterDepth > 1) {
        iterBalanced = false;
        break;
      }
    } else if (entry.msg.includes("[CompletionLoop] Iteration exit")) {
      iterDepth--;
      if (iterDepth < 0) {
        iterBalanced = false;
        break;
      }
    }
  }
  assert(
    "Iteration enter/exit markers are sequentially paired (no nesting)",
    iterBalanced && iterDepth === 0,
    `final depth=${iterDepth}, balanced=${iterBalanced}`,
  );
}

// ---------------------------------------------------------------------------
// Assertion 5: No CompletionLoop without FlowLoop context
// ---------------------------------------------------------------------------
log("\n--- Assertion 5: No CompletionLoop without FlowLoop context ---");
{
  // For each CompletionLoop Enter, verify a FlowLoop Enter precedes it in
  // the global entry sequence.
  const allLoopEntries = entries.filter(
    (e) => e.msg.includes("[FlowLoop]") || e.msg.includes("[CompletionLoop]"),
  );

  let flowLoopSeen = false;
  let allPreceded = true;
  for (const entry of allLoopEntries) {
    if (entry.msg.includes("[FlowLoop] Enter")) {
      flowLoopSeen = true;
    }
    if (
      entry.msg === "[CompletionLoop] Enter" ||
      entry.msg.startsWith("[CompletionLoop] Enter,")
    ) {
      if (!flowLoopSeen) {
        allPreceded = false;
        break;
      }
    }
  }
  assert(
    "Every [CompletionLoop] Enter is preceded by a [FlowLoop] Enter",
    allPreceded,
  );
}

// ---------------------------------------------------------------------------
// Assertion 6: Sequence ordering — FlowLoop covers work and closure steps
// ---------------------------------------------------------------------------
log("\n--- Assertion 6: Sequence ordering ---");
{
  const flowEnters = flowLoopEntries.filter((e) =>
    e.msg.includes("[FlowLoop] Enter")
  );
  const stepIds = new Set(
    flowEnters
      .map((e) => e.stepId)
      .filter((s): s is string => typeof s === "string"),
  );
  assert(
    "FlowLoop Enter appears for multiple distinct stepIds",
    stepIds.size >= 2,
    `stepIds: ${[...stepIds].join(", ")}`,
  );

  // Verify at least one work step and one closure step based on naming
  const hasWorkStep = [...stepIds].some((id) => id.startsWith("initial"));
  const hasClosureStep = [...stepIds].some((id) => id.startsWith("closure"));
  assert(
    "FlowLoop covers both work steps (initial.*) and closure steps (closure.*)",
    hasWorkStep && hasClosureStep,
    `work=${hasWorkStep}, closure=${hasClosureStep}`,
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
log(`\nSummary: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  Deno.exit(1);
}
