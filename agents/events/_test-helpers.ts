/**
 * Internal test helpers for event-bus emission tests (T3.5).
 *
 * Single source of truth for the "subscribe → run → assert published"
 * pattern used by `emission_test.ts` and any future bus consumer test.
 * Production code MUST NOT import from this module — it is intentionally
 * not re-exported via `mod.ts`.
 *
 * Why a collector?
 * - `bus.publish` is fire-and-forget. There is no inspectable buffer on
 *   the bus itself; subscribers are the only observation surface.
 * - The collector subscribes with no `kind` filter so every event variant
 *   lands in the captured array regardless of test scope.
 * - It MUST be installed **before** `bus.freeze()`. Tests that drive the
 *   orchestrator with a synthetic bus call `createEventCollector(bus)`
 *   first, then optionally freeze, then run the scenario.
 *
 * @see agents/events/bus.ts (CloseEventBus contract — F1 freeze model)
 * @see agents/events/emission_test.ts (consumer)
 */

import type { CloseEventBus } from "./bus.ts";
import type { Event, EventKind } from "./types.ts";

/**
 * Lightweight collector subscriber for tests.
 *
 * Returns a stable handle exposing the captured events as a live
 * read-only view (the underlying array reference is the same one the
 * subscriber pushes into, so `.events` always reflects the latest
 * state without re-querying the bus).
 *
 * @param bus  Unfrozen `CloseEventBus`. Calling this after `bus.freeze()`
 *             throws `SubscribeAfterBootError` (bus.ts F1) — emission
 *             tests must subscribe pre-freeze.
 *
 * @returns Object with:
 *   - `events`: live snapshot of captured events (insertion order).
 *   - `byKind(k)`: filter helper for the common "find events of kind k"
 *     assertion. Returns a fresh array; callers mutate freely.
 *   - `reset()`: clear the captured array in place. Useful when a test
 *     drives multiple scenarios on the same bus and wants per-scenario
 *     assertions without re-subscribing.
 */
export interface EventCollector {
  readonly events: ReadonlyArray<Event>;
  byKind<K extends EventKind>(
    kind: K,
  ): ReadonlyArray<Extract<Event, { kind: K }>>;
  reset(): void;
}

export const createEventCollector = (bus: CloseEventBus): EventCollector => {
  const captured: Event[] = [];
  bus.subscribe<Event>({}, (e) => {
    captured.push(e);
  });
  return {
    get events(): ReadonlyArray<Event> {
      return captured;
    },
    byKind<K extends EventKind>(
      kind: K,
    ): ReadonlyArray<Extract<Event, { kind: K }>> {
      return captured.filter((e): e is Extract<Event, { kind: K }> =>
        e.kind === kind
      );
    },
    reset(): void {
      captured.length = 0;
    },
  };
};
