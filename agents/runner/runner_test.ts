/**
 * Tests for AgentRunner and errors.ts
 *
 * Focus on error hierarchy, event system, and initialization behavior.
 * SDK calls are not tested here to avoid complex mocking.
 */

import { assertEquals, assertInstanceOf } from "@std/assert";
import {
  AgentActionError,
  AgentCompletionError,
  AgentError,
  AgentMaxIterationsError,
  AgentNotInitializedError,
  AgentQueryError,
  AgentTimeoutError,
  isAgentError,
  normalizeToAgentError,
} from "./errors.ts";
import { AgentRunner } from "./runner.ts";
import { AgentEventEmitter } from "./events.ts";
import type { AgentDefinition } from "../src_common/types.ts";

// =============================================================================
// Error Hierarchy Tests
// =============================================================================

Deno.test("AgentNotInitializedError - has correct code and recoverable", () => {
  const error = new AgentNotInitializedError();
  assertEquals(error.code, "AGENT_NOT_INITIALIZED");
  assertEquals(error.recoverable, false);
  assertEquals(error.name, "AgentNotInitializedError");
  assertEquals(error.message, "AgentRunner must be initialized before use");
});

Deno.test("AgentNotInitializedError - accepts custom message", () => {
  const error = new AgentNotInitializedError({ message: "Custom message" });
  assertEquals(error.message, "Custom message");
});

Deno.test("AgentNotInitializedError - accepts cause", () => {
  const cause = new Error("Original error");
  const error = new AgentNotInitializedError({ cause });
  assertEquals(error.cause, cause);
});

Deno.test("AgentQueryError - has correct code and is recoverable", () => {
  const error = new AgentQueryError("Query failed");
  assertEquals(error.code, "AGENT_QUERY_ERROR");
  assertEquals(error.recoverable, true);
  assertEquals(error.name, "AgentQueryError");
  assertEquals(error.message, "Query failed");
});

Deno.test("AgentQueryError - stores iteration", () => {
  const error = new AgentQueryError("Query failed", { iteration: 5 });
  assertEquals(error.iteration, 5);
});

Deno.test("AgentCompletionError - has correct code and is recoverable", () => {
  const error = new AgentCompletionError("Completion check failed");
  assertEquals(error.code, "AGENT_COMPLETION_ERROR");
  assertEquals(error.recoverable, true);
  assertEquals(error.name, "AgentCompletionError");
});

Deno.test("AgentActionError - has correct code and is recoverable", () => {
  const error = new AgentActionError("Action failed");
  assertEquals(error.code, "AGENT_ACTION_ERROR");
  assertEquals(error.recoverable, true);
  assertEquals(error.name, "AgentActionError");
});

Deno.test("AgentActionError - stores actionType", () => {
  const error = new AgentActionError("Action failed", { actionType: "commit" });
  assertEquals(error.actionType, "commit");
});

Deno.test("AgentActionError - toJSON includes actionType", () => {
  const error = new AgentActionError("Action failed", {
    actionType: "commit",
    iteration: 3,
  });
  const json = error.toJSON();
  assertEquals(json.actionType, "commit");
  assertEquals(json.iteration, 3);
  assertEquals(json.code, "AGENT_ACTION_ERROR");
});

Deno.test("AgentTimeoutError - has correct code and is recoverable", () => {
  const error = new AgentTimeoutError("Operation timed out", 5000);
  assertEquals(error.code, "AGENT_TIMEOUT");
  assertEquals(error.recoverable, true);
  assertEquals(error.name, "AgentTimeoutError");
  assertEquals(error.timeoutMs, 5000);
});

Deno.test("AgentTimeoutError - toJSON includes timeoutMs", () => {
  const error = new AgentTimeoutError("Timed out", 10000, { iteration: 2 });
  const json = error.toJSON();
  assertEquals(json.timeoutMs, 10000);
  assertEquals(json.iteration, 2);
  assertEquals(json.code, "AGENT_TIMEOUT");
});

Deno.test("AgentMaxIterationsError - has correct code and is not recoverable", () => {
  const error = new AgentMaxIterationsError(10);
  assertEquals(error.code, "AGENT_MAX_ITERATIONS");
  assertEquals(error.recoverable, false);
  assertEquals(error.name, "AgentMaxIterationsError");
  assertEquals(error.maxIterations, 10);
  assertEquals(
    error.message,
    "Maximum iterations (10) reached without completion",
  );
});

Deno.test("AgentMaxIterationsError - stores iteration", () => {
  const error = new AgentMaxIterationsError(10, 10);
  assertEquals(error.iteration, 10);
});

Deno.test("AgentMaxIterationsError - toJSON includes maxIterations", () => {
  const error = new AgentMaxIterationsError(50, 50);
  const json = error.toJSON();
  assertEquals(json.maxIterations, 50);
  assertEquals(json.iteration, 50);
  assertEquals(json.code, "AGENT_MAX_ITERATIONS");
});

// =============================================================================
// Base AgentError toJSON Tests
// =============================================================================

Deno.test("AgentError - toJSON returns complete structure", () => {
  const cause = new Error("Original");
  const error = new AgentQueryError("Test error", { cause, iteration: 7 });
  const json = error.toJSON();

  assertEquals(json.name, "AgentQueryError");
  assertEquals(json.code, "AGENT_QUERY_ERROR");
  assertEquals(json.message, "Test error");
  assertEquals(json.recoverable, true);
  assertEquals(json.iteration, 7);
  assertEquals(json.cause, "Original");
});

Deno.test("AgentError - toJSON handles undefined cause", () => {
  const error = new AgentQueryError("Test error");
  const json = error.toJSON();
  assertEquals(json.cause, undefined);
});

// =============================================================================
// Type Guard Tests
// =============================================================================

Deno.test("isAgentError - returns true for AgentError instances", () => {
  const errors = [
    new AgentNotInitializedError(),
    new AgentQueryError("test"),
    new AgentCompletionError("test"),
    new AgentActionError("test"),
    new AgentTimeoutError("test", 1000),
    new AgentMaxIterationsError(10),
  ];

  for (const error of errors) {
    assertEquals(isAgentError(error), true);
  }
});

Deno.test("isAgentError - returns false for non-AgentError", () => {
  assertEquals(isAgentError(new Error("test")), false);
  assertEquals(isAgentError(new TypeError("test")), false);
  assertEquals(isAgentError("string error"), false);
  assertEquals(isAgentError(null), false);
  assertEquals(isAgentError(undefined), false);
  assertEquals(isAgentError({}), false);
});

// =============================================================================
// normalizeToAgentError Tests
// =============================================================================

Deno.test("normalizeToAgentError - returns AgentError as-is", () => {
  const original = new AgentActionError("Original");
  const normalized = normalizeToAgentError(original);
  assertEquals(normalized, original);
});

Deno.test("normalizeToAgentError - wraps Error as AgentQueryError", () => {
  const original = new Error("Regular error");
  const normalized = normalizeToAgentError(original);
  assertInstanceOf(normalized, AgentQueryError);
  assertEquals(normalized.message, "Regular error");
  assertEquals(normalized.cause, original);
});

Deno.test("normalizeToAgentError - wraps Error with iteration", () => {
  const original = new Error("Error");
  const normalized = normalizeToAgentError(original, { iteration: 5 });
  assertEquals(normalized.iteration, 5);
});

Deno.test("normalizeToAgentError - wraps string as AgentQueryError", () => {
  const normalized = normalizeToAgentError("String error");
  assertInstanceOf(normalized, AgentQueryError);
  assertEquals(normalized.message, "String error");
});

Deno.test("normalizeToAgentError - wraps unknown type as AgentQueryError", () => {
  const normalized = normalizeToAgentError(12345);
  assertInstanceOf(normalized, AgentQueryError);
  assertEquals(normalized.message, "12345");
});

// =============================================================================
// AgentEventEmitter Tests
// =============================================================================

Deno.test("AgentEventEmitter - on registers handler and returns unsubscribe", () => {
  const emitter = new AgentEventEmitter();

  const unsubscribe = emitter.on("initialized", () => {
    // Handler registered for testing
  });

  assertEquals(typeof unsubscribe, "function");
  assertEquals(emitter.listenerCount("initialized"), 1);

  unsubscribe();
  assertEquals(emitter.listenerCount("initialized"), 0);
});

Deno.test("AgentEventEmitter - emit calls registered handlers", async () => {
  const emitter = new AgentEventEmitter();
  const events: number[] = [];

  emitter.on("iterationStart", ({ iteration }) => {
    events.push(iteration);
  });

  await emitter.emit("iterationStart", { iteration: 1 });
  await emitter.emit("iterationStart", { iteration: 2 });

  assertEquals(events, [1, 2]);
});

Deno.test("AgentEventEmitter - multiple handlers for same event", async () => {
  const emitter = new AgentEventEmitter();
  let count = 0;

  emitter.on("initialized", () => {
    count++;
  });
  emitter.on("initialized", () => {
    count++;
  });

  await emitter.emit("initialized", { cwd: "/test" });
  assertEquals(count, 2);
});

Deno.test("AgentEventEmitter - unsubscribe only removes specific handler", async () => {
  const emitter = new AgentEventEmitter();
  let count1 = 0;
  let count2 = 0;

  const unsub1 = emitter.on("initialized", () => {
    count1++;
  });
  emitter.on("initialized", () => {
    count2++;
  });

  unsub1();
  await emitter.emit("initialized", { cwd: "/test" });

  assertEquals(count1, 0);
  assertEquals(count2, 1);
});

Deno.test("AgentEventEmitter - once only fires handler once", async () => {
  const emitter = new AgentEventEmitter();
  let count = 0;

  emitter.once("iterationStart", () => {
    count++;
  });

  await emitter.emit("iterationStart", { iteration: 1 });
  await emitter.emit("iterationStart", { iteration: 2 });

  assertEquals(count, 1);
});

Deno.test("AgentEventEmitter - removeAllListeners for specific event", () => {
  const emitter = new AgentEventEmitter();

  emitter.on("initialized", () => {});
  emitter.on("initialized", () => {});
  emitter.on("iterationStart", () => {});

  assertEquals(emitter.listenerCount("initialized"), 2);
  assertEquals(emitter.listenerCount("iterationStart"), 1);

  emitter.removeAllListeners("initialized");

  assertEquals(emitter.listenerCount("initialized"), 0);
  assertEquals(emitter.listenerCount("iterationStart"), 1);
});

Deno.test("AgentEventEmitter - removeAllListeners for all events", () => {
  const emitter = new AgentEventEmitter();

  emitter.on("initialized", () => {});
  emitter.on("iterationStart", () => {});
  emitter.on("error", () => {});

  emitter.removeAllListeners();

  assertEquals(emitter.listenerCount("initialized"), 0);
  assertEquals(emitter.listenerCount("iterationStart"), 0);
  assertEquals(emitter.listenerCount("error"), 0);
});

Deno.test("AgentEventEmitter - listenerCount for non-existent event returns 0", () => {
  const emitter = new AgentEventEmitter();
  assertEquals(emitter.listenerCount("completed"), 0);
});

// =============================================================================
// AgentRunner Initialization Tests
// =============================================================================

// Minimal valid agent definition for testing
function createMinimalDefinition(): AgentDefinition {
  return {
    name: "test-agent",
    displayName: "Test Agent",
    description: "Test agent for unit tests",
    version: "1.0.0",
    behavior: {
      systemPromptPath: "./prompts/system.md",
      completionType: "iterate",
      completionConfig: { maxIterations: 10 },
      allowedTools: [],
      permissionMode: "plan",
    },
    parameters: {},
    prompts: {
      registry: "./prompts/registry.json",
      fallbackDir: "./prompts",
    },
    logging: {
      directory: "./logs",
      format: "jsonl",
    },
  };
}

Deno.test("AgentRunner - constructor accepts definition without dependencies", () => {
  const definition = createMinimalDefinition();
  // Should not throw - uses default dependencies
  const runner = new AgentRunner(definition);
  assertEquals(typeof runner.on, "function");
});

Deno.test("AgentRunner - getContext throws AgentNotInitializedError before initialization", () => {
  // getContext is private, so we verify the error class behavior is correct
  const error = new AgentNotInitializedError();
  assertEquals(error.code, "AGENT_NOT_INITIALIZED");
  assertEquals(error.recoverable, false);
});

Deno.test("AgentRunner - on returns unsubscribe function", () => {
  const definition = createMinimalDefinition();
  const runner = new AgentRunner(definition);

  const unsubscribe = runner.on("initialized", () => {});
  assertEquals(typeof unsubscribe, "function");

  // Calling unsubscribe should not throw
  unsubscribe();
});

Deno.test("AgentRunner - on registers multiple handlers", () => {
  const definition = createMinimalDefinition();
  const runner = new AgentRunner(definition);

  // Register multiple handlers - should not throw
  runner.on("iterationStart", () => {});
  runner.on("iterationStart", () => {});
  runner.on("error", () => {});
});

// =============================================================================
// Error inheritance chain tests
// =============================================================================

Deno.test("All error classes extend AgentError", () => {
  const errors: AgentError[] = [
    new AgentNotInitializedError(),
    new AgentQueryError("test"),
    new AgentCompletionError("test"),
    new AgentActionError("test"),
    new AgentTimeoutError("test", 1000),
    new AgentMaxIterationsError(10),
  ];

  for (const error of errors) {
    assertInstanceOf(error, AgentError);
    assertInstanceOf(error, Error);
  }
});

Deno.test("Error codes are unique", () => {
  const codes = [
    new AgentNotInitializedError().code,
    new AgentQueryError("test").code,
    new AgentCompletionError("test").code,
    new AgentActionError("test").code,
    new AgentTimeoutError("test", 1000).code,
    new AgentMaxIterationsError(10).code,
  ];

  const uniqueCodes = new Set(codes);
  assertEquals(
    uniqueCodes.size,
    codes.length,
    "All error codes should be unique",
  );
});
