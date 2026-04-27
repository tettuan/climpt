/**
 * Diagnostic subscriber — append every published {@link Event} as one
 * JSONL line to `tmp/logs/events-<runId>.jsonl`.
 *
 * Lifecycle (design 30 §A subscriber contract, critique F1 + F7):
 * - Registered **inside** `BootKernel.boot` before the bus is sealed via
 *   `freeze()`. Until P4 wires the 6 close channels, this is the only
 *   subscriber the bus has.
 * - Re-registration on every boot (re-deploy = new boot = new bus + new
 *   subscriber set, critique F1).
 *
 * Error containment (critique F7):
 * - The subscriber handler is **synchronous void-returning**: it kicks
 *   off the disk write as a fire-and-forget Promise and returns
 *   immediately so publisher latency is ~0. The write Promise has a
 *   `.catch(() => {})` chained so disk errors never propagate to the
 *   publisher and never reach the global unhandled-rejection handler.
 * - Subscribe-time `mkdir` is wrapped in try / catch and any failure is
 *   swallowed: the subscriber registers regardless and the per-event
 *   write Promise will then absorb the failed-create-then-write attempts.
 * - **No `await` in the publisher's call stack.** Events are JSON-encoded
 *   synchronously (cheap), then `Deno.writeTextFile` returns its Promise
 *   without blocking the publisher's iteration over subscribers.
 *
 * I/O strategy: one `Deno.writeTextFile` call per event, with
 * `{ append: true, create: true }`. Buffering (e.g. an in-memory queue
 * flushed on a timer) was considered and rejected for P3:
 * - The diagnostic subscriber is the only subscriber in P3, the event
 *   rate is bounded by the orchestrator dispatch rate (≤1 event per
 *   step), and unbuffered writes are simpler and have correct on-crash
 *   ordering.
 * - P4 may swap to a buffered writer if the event rate ever justifies
 *   it; the contract here (one JSONL line per event, errors silenced)
 *   is unaffected by that internal change.
 *
 * @see agents/docs/design/realistic/30-event-flow.md §A
 * @see tmp/realistic-migration/critique.md F1 (cyclic freeze) / F7 (I/O)
 *
 * @module
 */

import type { CloseEventBus, Unsubscribe } from "./bus.ts";
import type { Event } from "./types.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Options for {@link registerDiagnosticSubscriber}.
 *
 * `runId` — Boot-issued correlation id; appended to the filename so a
 *           single workspace can host multiple parallel boots without
 *           interleaving JSONL streams.
 * `logDir` — Absolute directory in which the JSONL file is created.
 *            Conventionally `${cwd}/tmp/logs`.
 * `enabled` — Defaults to `true`. Set to `false` from unit tests that
 *             must not touch the filesystem (the helper returns a
 *             no-op {@link Unsubscribe}).
 */
export interface DiagnosticOpts {
  readonly runId: string;
  readonly logDir: string;
  readonly enabled?: boolean;
}

/**
 * Subscribe a JSONL diagnostic logger to every event on `bus`.
 *
 * Behavior:
 *  1. If `opts.enabled === false`, returns a no-op `Unsubscribe`
 *     immediately and does not touch the filesystem. Tests that don't
 *     want disk I/O pass `disableDiagnostic: true` through Boot.
 *  2. Otherwise, attempts a best-effort `Deno.mkdirSync(logDir,
 *     { recursive: true })` so the first write succeeds. Errors are
 *     swallowed — the subscriber still registers; per-event writes will
 *     surface the same error and silence it again.
 *  3. Subscribes a no-filter handler that, for each event, JSON-encodes
 *     the payload + appends a newline + fires `Deno.writeTextFile` with
 *     `{ append: true, create: true }`. The Promise is `.catch(() =>
 *     {})`-chained so handler-side errors are silenced (critique F7).
 *  4. Returns the bus's {@link Unsubscribe} so callers (typically tests)
 *     can detach. Production code does not detach — re-deploy creates a
 *     fresh bus.
 *
 * Never throws. The only failure modes (mkdir / writeTextFile) are
 * structurally absorbed.
 */
export const registerDiagnosticSubscriber = (
  bus: CloseEventBus,
  opts: DiagnosticOpts,
): Unsubscribe => {
  if (opts.enabled === false) {
    // Cheapest possible no-op: do not even consume a subscriber slot on
    // the bus. Tests that disable disk I/O still expect the bus to be
    // empty.
    return () => {};
  }

  const logPath = `${opts.logDir}/events-${opts.runId}.jsonl`;

  // Best-effort directory creation. Synchronous so the first write has a
  // higher chance of succeeding even when the publisher fires
  // immediately after Boot. Sync mkdir is acceptable here because Boot
  // is itself async and this runs once per process — not on the hot
  // publish path.
  try {
    Deno.mkdirSync(opts.logDir, { recursive: true });
  } catch {
    // Swallow per F7: subscriber must register regardless. The per-event
    // write will hit the same error and is also silenced.
  }

  return bus.subscribe<Event>({}, (event) => {
    // JSON-encode synchronously inside the handler so the encoded line
    // captures the event exactly as published (no later mutation can
    // race the write). Encoding is cheap and we already accepted that
    // synchronous handler exceptions are swallowed by the bus (bus.ts
    // F7), so a malformed event will fail-silent here just like any
    // other handler bug.
    const line = JSON.stringify(event) + "\n";

    // Fire-and-forget: do NOT await. Returning the Promise from the
    // handler would let the bus chain a no-op `.catch`, but we attach
    // our own here so the F7 contract is double-locked at the
    // subscriber level too — defence in depth against a future bus
    // refactor that drops the silenced-rejection behavior.
    Deno.writeTextFile(logPath, line, { append: true, create: true })
      .catch(() => {
        // Disk full, permission denied, FS removed mid-run — all
        // diagnostic-only failures. Never propagate.
      });
  });
};
