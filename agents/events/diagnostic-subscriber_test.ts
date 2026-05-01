/**
 * Unit tests for {@link registerDiagnosticSubscriber}.
 *
 * Coverage:
 * - Disabled mode (`enabled: false`) returns a no-op without touching
 *   the filesystem.
 * - Enabled mode writes one JSONL line per published event to the
 *   expected path.
 * - Disk errors NEVER propagate to the publisher (Critique F7).
 * - The returned `Unsubscribe` removes the subscriber as expected.
 *
 * These tests run with disk I/O to a temp directory; they are NOT in
 * the BootKernel suite because they exercise the subscriber in
 * isolation against a fresh `createCloseEventBus()` (no need for the
 * 5 Boot inputs).
 *
 * @see agents/events/diagnostic-subscriber.ts
 * @see tmp/realistic-migration/critique.md F7 (publisher latency / I/O)
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

import { createCloseEventBus } from "./bus.ts";
import type { Event } from "./types.ts";
import { registerDiagnosticSubscriber } from "./diagnostic-subscriber.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const sampleDispatchPlanned = (runId: string): Event => ({
  kind: "dispatchPlanned",
  publishedAt: 0,
  runId,
  agentId: "sample-agent",
  phase: "ready",
  source: "workflow",
});

// ---------------------------------------------------------------------------
// Disabled mode — no filesystem effect
// ---------------------------------------------------------------------------

Deno.test("registerDiagnosticSubscriber — disabled returns no-op without writing", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const bus = createCloseEventBus();
    const unsubscribe = registerDiagnosticSubscriber(bus, {
      runId: "disabled-run",
      logDir: join(tmp, "logs"),
      enabled: false,
    });
    bus.freeze();

    bus.publish(sampleDispatchPlanned("disabled-run"));

    // Yield a tick to let any (incorrectly) scheduled write resolve.
    await new Promise((r) => setTimeout(r, 10));

    // Directory must not be created (disabled mode short-circuits
    // BEFORE the best-effort mkdir).
    let dirExists = false;
    try {
      await Deno.stat(join(tmp, "logs"));
      dirExists = true;
    } catch {
      dirExists = false;
    }
    assertEquals(
      dirExists,
      false,
      "disabled subscriber must not create the log dir",
    );

    // Unsubscribe must be a callable no-op.
    assertEquals(typeof unsubscribe, "function");
    unsubscribe();
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Enabled mode — JSONL write per event
// ---------------------------------------------------------------------------

Deno.test("registerDiagnosticSubscriber — writes one JSONL line per event", async () => {
  const tmp = await Deno.makeTempDir();
  const logDir = join(tmp, "logs");
  const runId = "enabled-run-123";
  const expectedPath = join(logDir, `events-${runId}.jsonl`);
  try {
    const bus = createCloseEventBus();
    registerDiagnosticSubscriber(bus, { runId, logDir, enabled: true });
    bus.freeze();

    bus.publish(sampleDispatchPlanned(runId));
    bus.publish({
      kind: "dispatchCompleted",
      publishedAt: 1,
      runId,
      agentId: "sample-agent",
      phase: "ready",
      outcome: "ok",
    });

    // Disk write is fire-and-forget — wait for both writes to land.
    // Polling avoids a fixed sleep that could flake on a slow runner.
    let content = "";
    for (let i = 0; i < 50; i++) {
      try {
        content = await Deno.readTextFile(expectedPath);
        if (content.split("\n").filter((l) => l.length > 0).length >= 2) break;
      } catch {
        // Not yet created.
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    const lines = content.split("\n").filter((l) => l.length > 0);
    assertEquals(lines.length, 2, `expected 2 JSONL lines, got: ${content}`);
    assertStringIncludes(lines[0], `"kind":"dispatchPlanned"`);
    assertStringIncludes(lines[0], `"runId":"${runId}"`);
    assertStringIncludes(lines[1], `"kind":"dispatchCompleted"`);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// F7 — disk errors must not surface to the publisher
// ---------------------------------------------------------------------------

Deno.test("registerDiagnosticSubscriber — F7: write failure never propagates to publisher", async () => {
  // Use a logDir that points at a regular file, not a directory.
  // mkdirSync will fail (the path exists as a file) and writeTextFile
  // will subsequently fail too. The publisher must complete normally.
  const tmp = await Deno.makeTempDir();
  const collidingFile = join(tmp, "not-a-dir");
  try {
    await Deno.writeTextFile(collidingFile, "occupied");

    const bus = createCloseEventBus();
    // No throw expected here even though mkdir will fail.
    registerDiagnosticSubscriber(bus, {
      runId: "fail-run",
      logDir: collidingFile, // file, not dir → mkdir fails
      enabled: true,
    });
    bus.freeze();

    // No throw expected here even though the write will fail.
    bus.publish(sampleDispatchPlanned("fail-run"));

    // Allow async write rejection to settle. We're proving the
    // publisher already returned synchronously — this delay only
    // confirms no unhandled rejection escapes.
    await new Promise((r) => setTimeout(r, 20));

    // If we got here without crashing the test runner, F7 holds.
    assert(true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Unsubscribe contract
// ---------------------------------------------------------------------------

Deno.test("registerDiagnosticSubscriber — returned unsubscribe detaches the handler", async () => {
  const tmp = await Deno.makeTempDir();
  const logDir = join(tmp, "logs");
  const runId = "unsub-run";
  const expectedPath = join(logDir, `events-${runId}.jsonl`);
  try {
    const bus = createCloseEventBus();
    const unsubscribe = registerDiagnosticSubscriber(bus, {
      runId,
      logDir,
      enabled: true,
    });
    // NB: do NOT freeze before unsubscribe — we want to prove the
    // unsubscribe path works structurally; freeze does not block
    // unsubscribe per bus.ts contract.
    bus.publish(sampleDispatchPlanned(runId));

    // Wait for the first write.
    for (let i = 0; i < 50; i++) {
      try {
        const c = await Deno.readTextFile(expectedPath);
        if (c.length > 0) break;
      } catch {
        // not ready
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    unsubscribe();

    // Subsequent publishes must not append. Capture pre-size, publish,
    // wait, compare.
    const beforeSize = (await Deno.stat(expectedPath)).size;
    bus.publish(sampleDispatchPlanned(runId));
    await new Promise((r) => setTimeout(r, 50));
    const afterSize = (await Deno.stat(expectedPath)).size;
    assertEquals(
      afterSize,
      beforeSize,
      "post-unsubscribe publish must not append to JSONL",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
