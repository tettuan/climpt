/**
 * `agents/events` module entry point.
 *
 * Re-exports:
 * - The 8-event ADT and discriminator helpers ({@link ./types.ts}).
 * - The `CloseEventBus` contract + `createCloseEventBus` factory
 *   ({@link ./bus.ts}).
 *
 * Status (T3.1 + T3.2, shadow mode):
 * - Types and bus only — no publishers, no subscribers, no behavior
 *   change. T3.3 adds publish call sites; T3.4 wires the bus into
 *   `BootKernel` and registers the diagnostic subscriber.
 *
 * @see agents/docs/design/realistic/30-event-flow.md
 */

export * from "./types.ts";
export * from "./bus.ts";
export * from "./diagnostic-subscriber.ts";
