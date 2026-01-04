/**
 * @fileoverview Integration tests for climpt-agent
 *
 * Fixture-based tests that verify component integration without external API calls.
 *
 * @module climpt-plugins/tests/integration_test
 */

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { handleMessage } from "../skills/delegate-climpt-agent/scripts/climpt-agent/sub-agent.ts";
import type { Logger } from "../skills/delegate-climpt-agent/scripts/climpt-agent/logger.ts";

// =============================================================================
// Test Fixtures: Mock Logger
// =============================================================================

interface LogCall {
  method: string;
  args: unknown[];
}

/**
 * Mock Logger that records all method calls for verification
 */
class MockLogger implements Partial<Logger> {
  calls: LogCall[] = [];

  write(message: string, metadata?: Record<string, unknown>): Promise<void> {
    this.calls.push({ method: "write", args: [message, metadata] });
    return Promise.resolve();
  }

  writeAssistant(message: string): Promise<void> {
    this.calls.push({ method: "writeAssistant", args: [message] });
    return Promise.resolve();
  }

  writeSystem(
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.calls.push({ method: "writeSystem", args: [message, metadata] });
    return Promise.resolve();
  }

  writeResult(
    status: "success" | "error",
    cost?: number,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.calls.push({ method: "writeResult", args: [status, cost, metadata] });
    return Promise.resolve();
  }

  writeError(
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.calls.push({ method: "writeError", args: [message, metadata] });
    return Promise.resolve();
  }

  getCallsByMethod(method: string): LogCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  reset(): void {
    this.calls = [];
  }
}

// =============================================================================
// Test Fixtures: SDK Message Types
// =============================================================================

/**
 * Create assistant message fixture with text content
 */
function createAssistantMessage(text: string) {
  return {
    type: "assistant" as const,
    message: {
      content: [{ type: "text" as const, text }],
    },
  };
}

/**
 * Create success result message fixture
 */
function createSuccessResult(cost: number) {
  return {
    type: "result" as const,
    subtype: "success" as const,
    total_cost_usd: cost,
  };
}

/**
 * Create error result message fixture
 */
function createErrorResult(errors: string[]) {
  return {
    type: "result" as const,
    subtype: "error" as const,
    errors,
  };
}

/**
 * Create system init message fixture
 */
function createSystemInit(sessionId: string, model: string) {
  return {
    type: "system" as const,
    subtype: "init" as const,
    session_id: sessionId,
    model,
  };
}

/**
 * Create user message fixture (should be ignored)
 */
function createUserMessage(text: string) {
  return {
    type: "user" as const,
    message: { content: text },
  };
}

// =============================================================================
// handleMessage Integration Tests
// =============================================================================

Deno.test("Integration: handleMessage processes assistant text messages", async () => {
  const logger = new MockLogger();
  const message = createAssistantMessage("Hello from assistant");

  await handleMessage(message as never, logger as unknown as Logger);

  const assistantCalls = logger.getCallsByMethod("writeAssistant");
  assertEquals(assistantCalls.length, 1);
  assertEquals(assistantCalls[0].args[0], "Hello from assistant");
});

Deno.test("Integration: handleMessage processes multiple content blocks", async () => {
  const logger = new MockLogger();
  const message = {
    type: "assistant" as const,
    message: {
      content: [
        { type: "text" as const, text: "First block" },
        { type: "text" as const, text: "Second block" },
        { type: "tool_use" as const, id: "123", name: "test", input: {} }, // non-text block
      ],
    },
  };

  await handleMessage(message as never, logger as unknown as Logger);

  const assistantCalls = logger.getCallsByMethod("writeAssistant");
  assertEquals(assistantCalls.length, 2);
  assertEquals(assistantCalls[0].args[0], "First block");
  assertEquals(assistantCalls[1].args[0], "Second block");
});

Deno.test("Integration: handleMessage processes success result", async () => {
  const logger = new MockLogger();
  const message = createSuccessResult(0.0025);

  await handleMessage(message as never, logger as unknown as Logger);

  const resultCalls = logger.getCallsByMethod("writeResult");
  assertEquals(resultCalls.length, 1);
  assertEquals(resultCalls[0].args[0], "success");
  assertEquals(resultCalls[0].args[1], 0.0025);
});

Deno.test("Integration: handleMessage processes error result", async () => {
  const logger = new MockLogger();
  const message = createErrorResult(["Error 1", "Error 2"]);

  await handleMessage(message as never, logger as unknown as Logger);

  const resultCalls = logger.getCallsByMethod("writeResult");
  assertEquals(resultCalls.length, 1);
  assertEquals(resultCalls[0].args[0], "error");
  assertEquals(resultCalls[0].args[2], { errors: ["Error 1", "Error 2"] });
});

Deno.test("Integration: handleMessage processes system init", async () => {
  const logger = new MockLogger();
  const message = createSystemInit("session-123", "claude-3-opus");

  await handleMessage(message as never, logger as unknown as Logger);

  const systemCalls = logger.getCallsByMethod("writeSystem");
  assertEquals(systemCalls.length, 1);
  assertStringIncludes(systemCalls[0].args[0] as string, "session-123");
  assertStringIncludes(systemCalls[0].args[0] as string, "claude-3-opus");
});

Deno.test("Integration: handleMessage ignores user messages", async () => {
  const logger = new MockLogger();
  const message = createUserMessage("User input");

  await handleMessage(message as never, logger as unknown as Logger);

  assertEquals(logger.calls.length, 0);
});

Deno.test("Integration: handleMessage handles unknown message types gracefully", async () => {
  const logger = new MockLogger();
  const message = {
    type: "unknown_future_type",
    data: "some data",
  };

  // Should not throw
  await handleMessage(message as never, logger as unknown as Logger);

  assertEquals(logger.calls.length, 0);
});

Deno.test("Integration: handleMessage handles empty content array", async () => {
  const logger = new MockLogger();
  const message = {
    type: "assistant" as const,
    message: {
      content: [],
    },
  };

  await handleMessage(message as never, logger as unknown as Logger);

  assertEquals(logger.getCallsByMethod("writeAssistant").length, 0);
});

Deno.test("Integration: handleMessage handles undefined content", async () => {
  const logger = new MockLogger();
  const message = {
    type: "assistant" as const,
    message: {},
  };

  // Should not throw
  await handleMessage(message as never, logger as unknown as Logger);

  assertEquals(logger.getCallsByMethod("writeAssistant").length, 0);
});
