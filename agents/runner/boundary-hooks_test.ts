/**
 * Tests for BoundaryHooks
 *
 * Covers invokeBoundaryHook behavior for closure and non-closure steps.
 */

import { assertEquals } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { type BoundaryHookDeps, BoundaryHooks } from "./boundary-hooks.ts";
import { AgentEventEmitter } from "./events.ts";
import type { BoundaryHookPayload } from "./events.ts";
import type { ExtendedStepsRegistry } from "../common/completion-types.ts";
import type { IterationSummary, RuntimeContext } from "../src_common/types.ts";

const logger = new BreakdownLogger("boundary");

// =============================================================================
// Helpers
// =============================================================================

function createMockLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    log: () => Promise.resolve(),
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
    addContext: () => {},
    getLogPath: () => "/tmp/claude/mock.log",
    logSdkMessage: () => {},
    setToolContext: () => {},
    clearToolContext: () => {},
  };
}

function createSummary(
  overrides: Partial<IterationSummary> = {},
): IterationSummary {
  return {
    iteration: 1,
    assistantResponses: [],
    toolsUsed: [],
    errors: [],
    ...overrides,
  };
}

function createMockContext(
  onBoundaryHook?: (payload: BoundaryHookPayload) => void,
): RuntimeContext {
  return {
    completionHandler: {
      onBoundaryHook,
    } as unknown as RuntimeContext["completionHandler"],
    promptResolver: {} as RuntimeContext["promptResolver"],
    logger: createMockLogger() as unknown as RuntimeContext["logger"],
    cwd: "/tmp/claude/test",
  };
}

function createClosureRegistry(): ExtendedStepsRegistry {
  return {
    agentId: "test",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "closure.test": {
        stepId: "closure.test",
        name: "Closure Test",
        c2: "closure",
        c3: "test",
        edition: "default",
        fallbackKey: "closure_test",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["closing", "repeat"],
          intentField: "next_action.action",
          intentSchemaRef: "#/test",
        },
      },
      "initial.test": {
        stepId: "initial.test",
        name: "Initial Test",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "initial_test",
        uvVariables: [],
        usesStdin: false,
      },
    },
  };
}

function createDeps(
  registry: ExtendedStepsRegistry | null,
  emitter?: AgentEventEmitter,
): BoundaryHookDeps {
  const eventEmitter = emitter ?? new AgentEventEmitter();
  return {
    getStepsRegistry: () => registry,
    getEventEmitter: () => eventEmitter,
  };
}

// =============================================================================
// invokeBoundaryHook Tests
// =============================================================================

Deno.test("BoundaryHooks - skips non-closure step", async () => {
  const registry = createClosureRegistry();
  const emitter = new AgentEventEmitter();
  const hooks = new BoundaryHooks(createDeps(registry, emitter));
  const ctx = createMockContext();
  const emitted: BoundaryHookPayload[] = [];

  emitter.on("boundaryHook", (payload) => {
    emitted.push(payload);
  });

  const summary = createSummary({
    structuredOutput: { next_action: { action: "next" } },
  });

  logger.debug("invokeBoundaryHook input", { stepId: "initial.test" });
  await hooks.invokeBoundaryHook("initial.test", summary, ctx);
  logger.debug("invokeBoundaryHook result", { emittedCount: emitted.length });

  assertEquals(emitted.length, 0);
});

Deno.test("BoundaryHooks - skips unknown step", async () => {
  const hooks = new BoundaryHooks(createDeps(null));
  const ctx = createMockContext();

  const summary = createSummary();

  // No registry, step unknown
  await hooks.invokeBoundaryHook("nonexistent.step", summary, ctx);

  // Should not throw, just skip
});

Deno.test("BoundaryHooks - emits event for closure step", async () => {
  const registry = createClosureRegistry();
  const emitter = new AgentEventEmitter();
  const hooks = new BoundaryHooks(createDeps(registry, emitter));
  const ctx = createMockContext();
  const emitted: BoundaryHookPayload[] = [];

  emitter.on("boundaryHook", (payload) => {
    emitted.push(payload);
  });

  const summary = createSummary({
    structuredOutput: { next_action: { action: "closing" } },
  });

  logger.debug("closure step hook input", { stepId: "closure.test" });
  await hooks.invokeBoundaryHook("closure.test", summary, ctx);
  logger.debug("closure step hook result", { emittedCount: emitted.length });

  assertEquals(emitted.length, 1);
  assertEquals(emitted[0].stepId, "closure.test");
  assertEquals(emitted[0].stepKind, "closure");
});

Deno.test("BoundaryHooks - calls onBoundaryHook handler", async () => {
  const registry = createClosureRegistry();
  const emitter = new AgentEventEmitter();
  const hooks = new BoundaryHooks(createDeps(registry, emitter));
  const receivedPayloads: BoundaryHookPayload[] = [];

  const ctx = createMockContext((payload) => {
    receivedPayloads.push(payload);
  });

  const summary = createSummary({
    structuredOutput: { release: "1.0.0" },
  });

  await hooks.invokeBoundaryHook("closure.test", summary, ctx);

  assertEquals(receivedPayloads.length, 1);
  assertEquals(receivedPayloads[0].stepId, "closure.test");
});

Deno.test("BoundaryHooks - skips when onBoundaryHook is undefined", async () => {
  const registry = createClosureRegistry();
  const hooks = new BoundaryHooks(createDeps(registry));
  const ctx = createMockContext(undefined);

  const summary = createSummary({ structuredOutput: {} });

  // Should not throw even without handler
  await hooks.invokeBoundaryHook("closure.test", summary, ctx);
});

Deno.test("BoundaryHooks - correct payload structure", async () => {
  const registry = createClosureRegistry();
  const emitter = new AgentEventEmitter();
  const hooks = new BoundaryHooks(createDeps(registry, emitter));
  const ctx = createMockContext();
  let receivedPayload: BoundaryHookPayload | null = null;

  emitter.on("boundaryHook", (payload) => {
    receivedPayload = payload;
  });

  const structuredOutput = { release_version: "2.0.0", status: "done" };
  const summary = createSummary({ structuredOutput });

  await hooks.invokeBoundaryHook("closure.test", summary, ctx);

  assertEquals(receivedPayload !== null, true);
  assertEquals(receivedPayload!.stepId, "closure.test");
  assertEquals(receivedPayload!.stepKind, "closure");
  assertEquals(
    (receivedPayload!.structuredOutput as Record<string, unknown>)
      ?.release_version,
    "2.0.0",
  );
});
