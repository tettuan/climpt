/**
 * `CloseEventBus` — fire-and-forget pub/sub bus for the 8-event ADT.
 *
 * Construction-time freeze model (design 10 §B `ConstructChannels`,
 * critique F1):
 * - Subscribers register **inside** `BootKernel.boot` (T3.4, T4.3) before
 *   the bus is sealed via `freeze()`.
 * - Calling `subscribe()` after `freeze()` throws
 *   `SubscribeAfterBootError`. This forbids run-time subscriber set
 *   mutation: every Channel that participates in close-path resolution
 *   must declare itself at boot.
 * - `Unsubscribe` callbacks remain callable after freeze. Removing an
 *   already-registered subscriber is structurally unrelated to the
 *   "no new subscribers" invariant, and disallowing it would prevent
 *   per-test cleanup. Tests that need both invariants assert them
 *   independently (see `bus_test.ts`).
 *
 * Error containment (design 30 §A subscriber contract, critique F7):
 * - `publish` is sync fire-and-forget. Synchronous handler exceptions
 *   are swallowed; async handler rejections are silenced via a
 *   `.catch(() => {})` attached to the returned Promise.
 * - The publisher MUST NOT see handler errors. Any subscriber
 *   instability (e.g. a buggy diagnostic logger) must not corrupt the
 *   close path.
 *
 * @see agents/docs/design/realistic/30-event-flow.md §A / §C
 * @see tmp/realistic-migration/critique.md F1 (cyclic freeze) / F7 (I/O)
 */

import type { Event, EventKind } from "./types.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Handler for a subset of {@link Event}.
 *
 * Subscribers that filter on `kind` may narrow `E` to the matching
 * variant(s); the bus's `publish` performs the runtime kind check, so the
 * handler can rely on `E` being the declared variant.
 */
export type EventHandler<E extends Event = Event> = (
  event: E,
) => void | Promise<void>;

/**
 * Subscription filter.
 *
 * `kind` may be a single discriminator literal or an array. When omitted
 * the handler receives every event. Future filters (predicate-based, by
 * channel, ...) are intentionally absent; design 30 §C subscribers are
 * declared at construction and the simple kind filter covers the 8-event
 * union exhaustively.
 */
export interface SubscribeOptions<_E extends Event = Event> {
  readonly kind?: EventKind | ReadonlyArray<EventKind>;
}

/** Removes a previously registered subscriber. Idempotent. */
export type Unsubscribe = () => void;

/**
 * Pub/sub bus contract.
 *
 * Lifecycle:
 *  1. Boot constructs the bus.
 *  2. Boot registers subscribers via `subscribe`.
 *  3. Boot calls `freeze()` — any later `subscribe` throws
 *     {@link SubscribeAfterBootError}.
 *  4. Run-time publishers call `publish`; subscribers fire in
 *     registration order.
 */
export interface CloseEventBus {
  /** Fire-and-forget publish; never throws to the caller. */
  readonly publish: (event: Event) => void;
  /** Register a kind-filtered handler. Must be called before `freeze()`. */
  readonly subscribe: <E extends Event = Event>(
    opts: SubscribeOptions<E>,
    handler: EventHandler<E>,
  ) => Unsubscribe;
  /** Seal the subscriber set; further `subscribe` calls throw. */
  readonly freeze: () => void;
  /** True after `freeze()` has been called at least once. */
  readonly isFrozen: () => boolean;
}

/**
 * Thrown when {@link CloseEventBus.subscribe} is called after
 * {@link CloseEventBus.freeze}.
 *
 * Boot-time constraint enforcement: every Channel and every diagnostic
 * subscriber must register inside `BootKernel.boot` before the bus
 * freezes. Run-time code that attempts to subscribe is structurally
 * incorrect and crashes loudly rather than silently degrading.
 */
export class SubscribeAfterBootError extends Error {
  constructor(message = "Cannot subscribe after CloseEventBus.freeze()") {
    super(message);
    this.name = "SubscribeAfterBootError";
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface SubscriberEntry {
  readonly opts: SubscribeOptions;
  readonly handler: EventHandler;
}

/**
 * Decide whether a subscription's `kind` filter accepts a given event.
 *
 * Pure helper; pulled out for readability. Branches:
 * - filter absent  → match every event
 * - filter array   → match if event.kind is included
 * - filter literal → match on string equality
 */
const matchesKindFilter = (
  filter: SubscribeOptions["kind"],
  eventKind: EventKind,
): boolean => {
  if (filter === undefined) return true;
  if (Array.isArray(filter)) {
    return (filter as readonly EventKind[]).includes(eventKind);
  }
  return filter === eventKind;
};

/**
 * Construct a fresh `CloseEventBus`.
 *
 * Each invocation produces an independent subscriber list and freeze
 * flag; tests should construct a new bus per case. Production code
 * constructs exactly one inside `BootKernel.boot` (T3.4).
 */
export const createCloseEventBus = (): CloseEventBus => {
  const subscribers: SubscriberEntry[] = [];
  let frozen = false;

  return {
    publish(event: Event): void {
      // Snapshot iteration: handlers running here cannot inject new
      // subscribers anyway (the bus is frozen by the time any publish
      // fires in production), but a copy makes ordering deterministic
      // even if a handler unsubscribes itself synchronously.
      for (const sub of subscribers.slice()) {
        if (!matchesKindFilter(sub.opts.kind, event.kind)) continue;
        try {
          const result = sub.handler(event);
          if (
            result !== undefined && result !== null &&
            typeof (result as Promise<void>).catch === "function"
          ) {
            // F7: async handler rejection is swallowed. Attach a no-op
            // catch so the rejection never reaches the global
            // unhandled-rejection handler.
            (result as Promise<void>).catch(() => {});
          }
        } catch {
          // F7: synchronous handler error is swallowed. The publisher
          // sees nothing and proceeds to the next subscriber.
        }
      }
    },

    subscribe<E extends Event = Event>(
      opts: SubscribeOptions<E>,
      handler: EventHandler<E>,
    ): Unsubscribe {
      if (frozen) throw new SubscribeAfterBootError();
      const entry: SubscriberEntry = {
        opts,
        handler: handler as EventHandler,
      };
      subscribers.push(entry);
      return () => {
        const idx = subscribers.indexOf(entry);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },

    freeze(): void {
      frozen = true;
    },

    isFrozen(): boolean {
      return frozen;
    },
  };
};
