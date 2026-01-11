/**
 * AgentEventEmitter - Type-safe event system for AgentRunner lifecycle
 *
 * Provides observable hooks for monitoring agent execution without
 * modifying the runner itself. Events are observational and errors
 * in handlers don't stop execution.
 */

import type {
  ActionResult,
  AgentResult,
  AgentState,
  DetectedAction,
  IterationSummary,
} from "../src_common/types.ts";

/**
 * All agent lifecycle event types
 */
export type AgentEvent =
  | "initialized"
  | "iterationStart"
  | "iterationEnd"
  | "promptBuilt"
  | "queryExecuted"
  | "actionDetected"
  | "actionExecuted"
  | "completionChecked"
  | "stateChange"
  | "error"
  | "completed";

/**
 * Payload types for each event
 */
export interface AgentEventPayloads {
  initialized: { cwd: string };
  iterationStart: { iteration: number };
  iterationEnd: { iteration: number; summary: IterationSummary };
  promptBuilt: { prompt: string; systemPrompt: string };
  queryExecuted: { summary: IterationSummary };
  actionDetected: { actions: readonly DetectedAction[] };
  actionExecuted: { results: readonly ActionResult[] };
  completionChecked: { isComplete: boolean; reason?: string };
  stateChange: { previous: AgentState; current: AgentState };
  error: { error: Error; recoverable: boolean };
  completed: { result: AgentResult };
}

/**
 * Event handler type
 */
export type AgentEventHandler<E extends AgentEvent> = (
  payload: AgentEventPayloads[E],
) => void | Promise<void>;

/**
 * Type-safe event emitter for agent lifecycle
 */
export class AgentEventEmitter {
  private listeners = new Map<AgentEvent, Set<AgentEventHandler<AgentEvent>>>();

  /**
   * Subscribe to an event
   * @returns Unsubscribe function
   */
  on<E extends AgentEvent>(
    event: E,
    handler: AgentEventHandler<E>,
  ): () => void {
    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    // Type assertion needed for the collection
    handlers.add(handler as AgentEventHandler<AgentEvent>);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler as AgentEventHandler<AgentEvent>);
    };
  }

  /**
   * Subscribe to an event for one occurrence only
   */
  once<E extends AgentEvent>(
    event: E,
    handler: AgentEventHandler<E>,
  ): () => void {
    const wrapper = ((payload: AgentEventPayloads[E]) => {
      unsubscribe();
      return handler(payload);
    }) as AgentEventHandler<E>;

    const unsubscribe = this.on(event, wrapper);
    return unsubscribe;
  }

  /**
   * Emit an event to all listeners
   */
  async emit<E extends AgentEvent>(
    event: E,
    payload: AgentEventPayloads[E],
  ): Promise<void> {
    const handlers = this.listeners.get(event);
    if (!handlers) return;

    // Execute handlers, collecting any errors
    const errors: Error[] = [];
    for (const handler of handlers) {
      try {
        // deno-lint-ignore no-await-in-loop
        await handler(payload);
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(String(e)));
      }
    }

    // Log errors but don't propagate (events are observational)
    if (errors.length > 0) {
      // deno-lint-ignore no-console
      console.error(`Event ${event} handler errors:`, errors);
    }
  }

  /**
   * Remove all listeners for an event, or all events
   */
  removeAllListeners(event?: AgentEvent): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get listener count for an event
   */
  listenerCount(event: AgentEvent): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
