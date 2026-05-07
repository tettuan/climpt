/**
 * `CloseEventBus` contract tests (T3.2).
 *
 * Source of truth:
 * - `bus.ts` is the implementation under test.
 * - `types.ts` defines the closed event ADT used to construct fixtures.
 * - design 30 §A / §C / §E (event ADT, subscriber contract, channel id
 *   closed enum) and critique F1 / F7 (freeze model, error containment)
 *   define the expected behaviors.
 *
 * The cases below cover the {@link CloseEventBus} surface area
 * exhaustively for shadow mode:
 *   1. subscribe → publish reaches handler.
 *   2. `kind` filter narrows to a single discriminator literal.
 *   3. `kind` filter narrows to an array of discriminators.
 *   4. `freeze()` then `subscribe()` throws `SubscribeAfterBootError`.
 *   5. Synchronous handler exception does not propagate to publisher.
 *   6. Asynchronous handler rejection is swallowed (no
 *      `unhandledrejection`).
 *   7. Multiple subscribers all fire for a matching event.
 *   8. `Unsubscribe` returned before freeze is callable after freeze
 *      (freeze gates `subscribe`, not removal).
 *   9. `isFrozen()` reports the freeze state truthfully.
 */

import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";

import {
  type CloseEventBus,
  createCloseEventBus,
  SubscribeAfterBootError,
} from "./bus.ts";
import type { DispatchPlannedEvent, Event, IssueClosedEvent } from "./types.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN_ID = "run-test";

const dispatchPlanned = (
  overrides: Partial<DispatchPlannedEvent> = {},
): DispatchPlannedEvent => ({
  kind: "dispatchPlanned",
  publishedAt: 1,
  runId: RUN_ID,
  agentId: "agent-a",
  phase: "phase-1",
  source: "workflow",
  ...overrides,
});

const issueClosed = (
  overrides: Partial<IssueClosedEvent> = {},
): IssueClosedEvent => ({
  kind: "issueClosed",
  publishedAt: 2,
  runId: RUN_ID,
  channel: "D",
  subjectId: 42,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

Deno.test("subscribe then publish reaches handler", () => {
  const bus: CloseEventBus = createCloseEventBus();
  const seen: Event[] = [];
  bus.subscribe({}, (e) => {
    seen.push(e);
  });
  bus.publish(dispatchPlanned());
  assertEquals(
    seen.length,
    1,
    "handler should receive exactly one event after one publish",
  );
  assertEquals(seen[0]!.kind, "dispatchPlanned");
});

Deno.test("kind filter (single literal) narrows to matching discriminator", () => {
  const bus = createCloseEventBus();
  const closedSeen: IssueClosedEvent[] = [];
  bus.subscribe<IssueClosedEvent>({ kind: "issueClosed" }, (e) => {
    closedSeen.push(e);
  });
  bus.publish(dispatchPlanned()); // should not match
  bus.publish(issueClosed());
  assertEquals(
    closedSeen.length,
    1,
    "filter=issueClosed must reject dispatchPlanned and accept issueClosed",
  );
  assertEquals(closedSeen[0]!.kind, "issueClosed");
});

Deno.test("kind filter (array) accepts any listed discriminator", () => {
  const bus = createCloseEventBus();
  const seen: Event[] = [];
  bus.subscribe(
    { kind: ["dispatchPlanned", "issueClosed"] },
    (e) => {
      seen.push(e);
    },
  );
  bus.publish(dispatchPlanned());
  bus.publish(issueClosed());
  bus.publish({
    kind: "transitionComputed",
    publishedAt: 3,
    runId: RUN_ID,
    fromPhase: "p0",
    toPhase: "p1",
    outcome: "ok",
  });
  assertEquals(
    seen.length,
    2,
    "array filter [dispatchPlanned, issueClosed] must reject transitionComputed",
  );
  assertEquals(seen.map((e) => e.kind), ["dispatchPlanned", "issueClosed"]);
});

Deno.test("freeze then subscribe throws SubscribeAfterBootError", () => {
  const bus = createCloseEventBus();
  bus.freeze();
  assertThrows(
    () => {
      bus.subscribe({}, () => {});
    },
    SubscribeAfterBootError,
    "Cannot subscribe after CloseEventBus.freeze()",
  );
});

Deno.test("synchronous handler error does not propagate to publisher", () => {
  const bus = createCloseEventBus();
  bus.subscribe({}, () => {
    throw new Error("handler boom (sync)");
  });
  let downstreamFired = false;
  bus.subscribe({}, () => {
    downstreamFired = true;
  });
  // Must not throw — F7 requires error containment at publish boundary.
  bus.publish(dispatchPlanned());
  assert(
    downstreamFired,
    "downstream subscriber must still fire when an upstream handler throws",
  );
});

Deno.test("asynchronous handler rejection is swallowed (no unhandled rejection)", async () => {
  const bus = createCloseEventBus();
  let unhandled = false;
  const onUnhandled = (e: PromiseRejectionEvent) => {
    unhandled = true;
    e.preventDefault();
  };
  globalThis.addEventListener("unhandledrejection", onUnhandled);
  try {
    bus.subscribe({}, () => Promise.reject(new Error("handler boom (async)")));
    // Must not throw and must not produce an unhandled rejection.
    bus.publish(dispatchPlanned());
    // Yield to the microtask queue so any unhandled rejection has a
    // chance to surface before we inspect the flag.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    assertEquals(
      unhandled,
      false,
      "async handler rejection must be swallowed by publish (F7)",
    );
  } finally {
    globalThis.removeEventListener("unhandledrejection", onUnhandled);
  }
});

Deno.test("multiple subscribers all fire for a matching event", () => {
  const bus = createCloseEventBus();
  const calls: string[] = [];
  bus.subscribe({ kind: "issueClosed" }, () => {
    calls.push("first");
  });
  bus.subscribe({ kind: "issueClosed" }, () => {
    calls.push("second");
  });
  bus.subscribe({ kind: "issueClosed" }, () => {
    calls.push("third");
  });
  bus.publish(issueClosed());
  assertEquals(
    calls,
    ["first", "second", "third"],
    "every matching subscriber must fire in registration order",
  );
});

Deno.test("Unsubscribe returned pre-freeze remains callable post-freeze", () => {
  const bus = createCloseEventBus();
  const seen: Event[] = [];
  const off = bus.subscribe({}, (e) => {
    seen.push(e);
  });
  bus.freeze();
  off(); // freeze gates `subscribe`, not removal of an already-registered subscriber.
  bus.publish(dispatchPlanned());
  assertEquals(
    seen.length,
    0,
    "after Unsubscribe, the handler must not receive further events",
  );
});

Deno.test("isFrozen reflects freeze state truthfully", () => {
  const bus = createCloseEventBus();
  assertEquals(bus.isFrozen(), false, "fresh bus must not be frozen");
  bus.freeze();
  assertEquals(bus.isFrozen(), true, "after freeze() the bus must be frozen");
  // Idempotency: calling freeze a second time must remain frozen and not throw.
  bus.freeze();
  assertEquals(bus.isFrozen(), true, "freeze() must be idempotent");
});
