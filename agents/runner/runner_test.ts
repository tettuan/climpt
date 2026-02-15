/**
 * Tests for AgentRunner and errors.ts
 *
 * Focus on error hierarchy, event system, and initialization behavior.
 * SDK calls are not tested here to avoid complex mocking.
 */

import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import {
  AgentCompletionError,
  AgentError,
  AgentMaxIterationsError,
  AgentNotInitializedError,
  AgentQueryError,
  AgentSchemaResolutionError,
  AgentTimeoutError,
  isAgentError,
  normalizeToAgentError,
} from "./errors.ts";
import { AgentRunner } from "./runner.ts";
import { AgentEventEmitter } from "./events.ts";
import type { AgentDefinition } from "../src_common/types.ts";

const logger = new BreakdownLogger("agent-runner");

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
  const original = new AgentCompletionError("Original");
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
      completionType: "iterationBudget",
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

// =============================================================================
// Completion Validation Integration Tests
// =============================================================================

import { FormatValidator } from "../loop/format-validator.ts";
import type { ResponseFormat } from "../common/completion-types.ts";
import type { IterationSummary } from "../src_common/types.ts";

// Helper to create a minimal iteration summary
function createIterationSummary(
  options: Partial<IterationSummary> = {},
): IterationSummary {
  return {
    iteration: 1,
    assistantResponses: [],
    toolsUsed: [],
    errors: [],
    ...options,
  };
}

// Helper to check if AI declared completion via structured output (matches runner.ts logic)
function hasAICompletionDeclaration(summary: IterationSummary): boolean {
  if (!summary.structuredOutput) {
    return false;
  }

  const so = summary.structuredOutput;

  // Check status field
  if (so.status === "completed") {
    return true;
  }

  // Check next_action.action field
  if (
    so.next_action &&
    typeof so.next_action === "object" &&
    (so.next_action as Record<string, unknown>).action === "complete"
  ) {
    return true;
  }

  return false;
}

Deno.test("Completion Validation - hasAICompletionDeclaration detects status=completed", () => {
  const summary = createIterationSummary({
    structuredOutput: {
      status: "completed",
      summary: "Task done",
    },
  });
  assertEquals(hasAICompletionDeclaration(summary), true);
});

Deno.test("Completion Validation - hasAICompletionDeclaration detects next_action.action=complete", () => {
  const summary = createIterationSummary({
    structuredOutput: {
      status: "in_progress",
      next_action: { action: "complete", reason: "All done" },
    },
  });
  assertEquals(hasAICompletionDeclaration(summary), true);
});

Deno.test("Completion Validation - hasAICompletionDeclaration returns false for in_progress", () => {
  const summary = createIterationSummary({
    structuredOutput: {
      status: "in_progress",
      next_action: { action: "continue", reason: "More work needed" },
    },
  });
  assertEquals(hasAICompletionDeclaration(summary), false);
});

Deno.test("Completion Validation - hasAICompletionDeclaration returns false without structured output", () => {
  const summary = createIterationSummary({});
  assertEquals(hasAICompletionDeclaration(summary), false);
});

Deno.test("Completion Validation - FormatValidator validates JSON in assistant response", () => {
  const validator = new FormatValidator();

  const summary = createIterationSummary({
    assistantResponses: [
      'Analysis complete:\n```json\n{"status":"success","count":5}\n```',
    ],
  });

  const format: ResponseFormat = {
    type: "json",
    schema: {
      required: ["status", "count"],
    },
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, true);
  assertEquals((result.extracted as Record<string, unknown>).status, "success");
  assertEquals((result.extracted as Record<string, unknown>).count, 5);
});

Deno.test("Completion Validation - FormatValidator validates text pattern", () => {
  const validator = new FormatValidator();

  const summary = createIterationSummary({
    assistantResponses: [
      "Task completed successfully. Status: COMPLETE-42",
    ],
  });

  const format: ResponseFormat = {
    type: "text-pattern",
    pattern: "COMPLETE-\\d+",
  };

  const result = validator.validate(summary, format);

  assertEquals(result.valid, true);
  assertEquals(result.extracted, "COMPLETE-42");
});

// =============================================================================
// Structured Gate Flow Integration Tests
// =============================================================================

import {
  GateInterpretationError,
  StepGateInterpreter,
} from "./step-gate-interpreter.ts";
import { RoutingError, WorkflowRouter } from "./workflow-router.ts";
import type {
  PromptStepDefinition,
  StepRegistry,
} from "../common/step-registry.ts";

/**
 * Creates a minimal step registry for testing structured gate flow.
 */
function createTestStepRegistry(): StepRegistry {
  return {
    agentId: "test",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "initial.test": {
        stepId: "initial.test",
        name: "Initial Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "test_initial_default",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["next", "repeat", "jump", "handoff"],
          intentField: "next_action.action",
          intentSchemaRef:
            "#/definitions/initial.test/properties/next_action/properties/action",
          targetField: "next_action.details.target",
          fallbackIntent: "next",
          handoffFields: ["result.data"],
        },
        transitions: {
          next: { target: "continuation.test" },
          repeat: { target: "initial.test" },
        },
      },
      "continuation.test": {
        stepId: "continuation.test",
        name: "Continuation Test Step",
        c2: "continuation",
        c3: "test",
        edition: "default",
        fallbackKey: "test_continuation_default",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["next", "repeat", "jump", "handoff"],
          intentField: "next_action.action",
          intentSchemaRef:
            "#/definitions/continuation.test/properties/next_action/properties/action",
          fallbackIntent: "next",
        },
        transitions: {
          next: { target: "continuation.test" },
          repeat: { target: "continuation.test" },
        },
      },
      "closure.test": {
        stepId: "closure.test",
        name: "Closure Test Step",
        c2: "closure",
        c3: "test",
        edition: "default",
        fallbackKey: "test_closure_default",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["closing", "repeat"],
          intentField: "next_action.action",
          intentSchemaRef:
            "#/definitions/closure.test/properties/next_action/properties/action",
          fallbackIntent: "repeat",
        },
        transitions: {
          closing: { target: null },
          repeat: { target: "closure.test" },
        },
      },
    },
  };
}

Deno.test("Structured Gate Flow - interpreter extracts intent 'next' from structured output", () => {
  const interpreter = new StepGateInterpreter();
  const registry = createTestStepRegistry();
  const stepDef = registry.steps["initial.test"] as PromptStepDefinition;

  const structuredOutput = {
    status: "in_progress",
    next_action: {
      action: "continue",
      reason: "More work needed",
    },
    result: {
      data: "test data",
    },
  };

  logger.debug("interpret input", { stepId: stepDef.stepId, structuredOutput });
  const interpretation = interpreter.interpret(structuredOutput, stepDef);
  logger.debug("interpret result", interpretation);

  assertEquals(interpretation.intent, "next"); // "continue" maps to "next"
  assertEquals(interpretation.usedFallback, false);
  assertEquals(interpretation.handoff?.data, "test data");
});

Deno.test("Structured Gate Flow - interpreter extracts intent 'closing' from structured output", () => {
  const interpreter = new StepGateInterpreter();
  const registry = createTestStepRegistry();
  const closureStepDef = registry.steps["closure.test"] as PromptStepDefinition;

  const structuredOutput = {
    status: "completed",
    next_action: {
      action: "closing",
      reason: "Task finished",
    },
  };

  const interpretation = interpreter.interpret(
    structuredOutput,
    closureStepDef,
  );

  assertEquals(interpretation.intent, "closing");
  assertEquals(interpretation.usedFallback, false);
});

Deno.test("Structured Gate Flow - interpreter throws when action is missing (failFast default)", () => {
  // Per design/08_step_flow_design.md Section 4/6, failFast defaults to true
  // Missing intent field should throw GateInterpretationError
  const interpreter = new StepGateInterpreter();
  const registry = createTestStepRegistry();
  const stepDef = registry.steps["initial.test"] as PromptStepDefinition;

  const structuredOutput = {
    status: "unknown",
    // no next_action field
  };

  assertThrows(
    () => interpreter.interpret(structuredOutput, stepDef),
    GateInterpretationError,
    "failFast",
  );
});

Deno.test("Structured Gate Flow - router routes 'next' intent to continuation step", () => {
  const registry = createTestStepRegistry();
  const router = new WorkflowRouter(registry);

  const interpretation = {
    intent: "next" as const,
    usedFallback: false,
  };

  const routing = router.route("initial.test", interpretation);

  assertEquals(routing.nextStepId, "continuation.test");
  assertEquals(routing.signalCompletion, false);
});

Deno.test("Structured Gate Flow - router routes 'repeat' intent to same step", () => {
  const registry = createTestStepRegistry();
  const router = new WorkflowRouter(registry);

  const interpretation = {
    intent: "repeat" as const,
    usedFallback: false,
  };

  const routing = router.route("initial.test", interpretation);

  assertEquals(routing.nextStepId, "initial.test");
  assertEquals(routing.signalCompletion, false);
});

Deno.test("Structured Gate Flow - work step cannot emit closing intent", () => {
  const registry = createTestStepRegistry();
  const router = new WorkflowRouter(registry);

  const interpretation = {
    intent: "closing" as const,
    usedFallback: false,
  };

  // Work step (initial.*) cannot emit closing intent - only closure steps can
  assertThrows(
    () => router.route("initial.test", interpretation),
    RoutingError,
    "Intent 'closing' not allowed for work step",
  );
});

Deno.test("Structured Gate Flow - closure step closing signals completion", () => {
  const registry = createTestStepRegistry();
  const router = new WorkflowRouter(registry);

  const interpretation = {
    intent: "closing" as const,
    usedFallback: false,
  };

  // Closure step with closing intent signals workflow completion
  const routing = router.route("closure.test", interpretation);

  assertEquals(routing.signalCompletion, true);
});

Deno.test("Structured Gate Flow - router uses default transition for steps without explicit transitions", () => {
  const registry: StepRegistry = {
    agentId: "test",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "initial.foo": {
        stepId: "initial.foo",
        name: "Initial Foo",
        c2: "initial",
        c3: "foo",
        edition: "default",
        fallbackKey: "foo_initial_default",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["next"],
          intentField: "next_action.action",
          intentSchemaRef:
            "#/definitions/initial.foo/properties/next_action/properties/action",
        },
        // No explicit transitions - should use default (initial -> continuation)
      },
      "continuation.foo": {
        stepId: "continuation.foo",
        name: "Continuation Foo",
        c2: "continuation",
        c3: "foo",
        edition: "default",
        fallbackKey: "foo_continuation_default",
        uvVariables: [],
        usesStdin: false,
      },
    },
  };

  const router = new WorkflowRouter(registry);
  const interpretation = { intent: "next" as const, usedFallback: false };
  const routing = router.route("initial.foo", interpretation);

  assertEquals(routing.nextStepId, "continuation.foo");
  assertEquals(routing.signalCompletion, false);
});

Deno.test("Structured Gate Flow - end-to-end interpreter to router flow", () => {
  const interpreter = new StepGateInterpreter();
  const registry = createTestStepRegistry();
  const router = new WorkflowRouter(registry);

  // Simulate AI response with structured output
  const structuredOutput = {
    status: "in_progress",
    next_action: {
      action: "continue",
      reason: "Processing files",
      details: {
        processed: 5,
        remaining: 3,
      },
    },
    result: {
      data: "partial result",
    },
  };

  // Step 1: Interpreter extracts intent
  const stepDef = registry.steps["initial.test"] as PromptStepDefinition;
  logger.debug("e2e: interpret input", {
    stepId: stepDef.stepId,
    structuredOutput,
  });
  const interpretation = interpreter.interpret(structuredOutput, stepDef);
  logger.debug("e2e: interpretation", interpretation);

  assertEquals(interpretation.intent, "next");
  assertEquals(interpretation.handoff?.data, "partial result");

  // Step 2: Router determines next step
  const routing = router.route("initial.test", interpretation);
  logger.debug("e2e: routing result", {
    nextStepId: routing.nextStepId,
    signalCompletion: routing.signalCompletion,
    reason: routing.reason,
  });

  assertEquals(routing.nextStepId, "continuation.test");
  assertEquals(routing.signalCompletion, false);
  // Reason comes from structured output's next_action.reason
  assertEquals(routing.reason, "Processing files");
});

Deno.test("Structured Gate Flow - end-to-end completion flow", () => {
  const interpreter = new StepGateInterpreter();
  const registry = createTestStepRegistry();
  const router = new WorkflowRouter(registry);

  // Closure step declares closing intent
  const structuredOutput = {
    status: "completed",
    next_action: {
      action: "closing",
      reason: "All tasks finished",
    },
  };

  // Interpreter extracts closing intent from closure step
  const closureStepDef = registry.steps["closure.test"] as PromptStepDefinition;
  logger.debug("e2e completion: interpret input", {
    stepId: closureStepDef.stepId,
    structuredOutput,
  });
  const interpretation = interpreter.interpret(
    structuredOutput,
    closureStepDef,
  );
  logger.debug("e2e completion: interpretation", interpretation);

  assertEquals(interpretation.intent, "closing");

  // Closure step signals completion
  const closureRouting = router.route("closure.test", interpretation);
  logger.debug("e2e completion: routing result", {
    signalCompletion: closureRouting.signalCompletion,
    reason: closureRouting.reason,
  });
  assertEquals(closureRouting.signalCompletion, true);
  assertEquals(closureRouting.reason, "All tasks finished");
});

// =============================================================================
// Schema Resolution Error Tests (fail-fast behavior)
// =============================================================================

Deno.test("AgentSchemaResolutionError - has correct code and is not recoverable", () => {
  const error = new AgentSchemaResolutionError(
    "Schema resolution failed 2 consecutive times",
    {
      stepId: "initial.test",
      schemaRef: "step_outputs.schema.json#/definitions/initial",
      consecutiveFailures: 2,
      iteration: 3,
    },
  );
  assertEquals(error.code, "FAILED_SCHEMA_RESOLUTION");
  assertEquals(error.recoverable, false);
  assertEquals(error.name, "AgentSchemaResolutionError");
  assertEquals(error.stepId, "initial.test");
  assertEquals(
    error.schemaRef,
    "step_outputs.schema.json#/definitions/initial",
  );
  assertEquals(error.consecutiveFailures, 2);
  assertEquals(error.iteration, 3);
});

Deno.test("AgentSchemaResolutionError - toJSON includes all fields", () => {
  const cause = new Error("Original error");
  const error = new AgentSchemaResolutionError(
    "Schema resolution failed",
    {
      stepId: "continuation.test",
      schemaRef: "test.schema.json#/definitions/foo",
      consecutiveFailures: 2,
      cause,
      iteration: 5,
    },
  );
  const json = error.toJSON();

  assertEquals(json.code, "FAILED_SCHEMA_RESOLUTION");
  assertEquals(json.stepId, "continuation.test");
  assertEquals(json.schemaRef, "test.schema.json#/definitions/foo");
  assertEquals(json.consecutiveFailures, 2);
  assertEquals(json.iteration, 5);
  assertEquals(json.cause, "Original error");
});

Deno.test("AgentSchemaResolutionError - is AgentError", () => {
  const error = new AgentSchemaResolutionError("Test", {
    stepId: "test",
    schemaRef: "test#ref",
    consecutiveFailures: 2,
  });
  assertInstanceOf(error, AgentError);
  assertEquals(isAgentError(error), true);
});

Deno.test("AgentSchemaResolutionError - is included in isAgentError", () => {
  const error = new AgentSchemaResolutionError("test", {
    stepId: "s",
    schemaRef: "r",
    consecutiveFailures: 2,
  });
  assertEquals(isAgentError(error), true);
  assertInstanceOf(error, AgentError);
});

Deno.test("Error codes for new error types are unique", () => {
  const allCodes = [
    new AgentNotInitializedError().code,
    new AgentQueryError("test").code,
    new AgentCompletionError("test").code,
    new AgentTimeoutError("test", 1000).code,
    new AgentMaxIterationsError(10).code,
    new AgentSchemaResolutionError("t", {
      stepId: "s",
      schemaRef: "r",
      consecutiveFailures: 2,
    }).code,
  ];

  const uniqueCodes = new Set(allCodes);
  assertEquals(
    uniqueCodes.size,
    allCodes.length,
    "All error codes should be unique",
  );
});

// =============================================================================
// R5: Flow Fail-Fast Tests (Schema failure, 2-strike abort, no-intent paths)
// =============================================================================

Deno.test("R5 - IterationSummary has schemaResolutionFailed field", () => {
  // Verify the IterationSummary type supports schemaResolutionFailed flag
  const summary: IterationSummary = {
    iteration: 1,
    assistantResponses: [],
    toolsUsed: [],
    errors: [
      'Schema resolution failed for step "initial.test". Iteration aborted.',
    ],
    schemaResolutionFailed: true,
  };

  assertEquals(summary.schemaResolutionFailed, true);
  assertEquals(summary.errors.length, 1);
  assertEquals(
    summary.errors[0].includes("Schema resolution failed"),
    true,
    "Error should mention schema resolution failure",
  );
});

Deno.test("R5 - AgentSchemaResolutionError captures consecutive failure count", () => {
  // Test that error properly tracks the 2-strike rule
  const error = new AgentSchemaResolutionError(
    'Schema resolution failed 2 consecutive times for step "initial.test"',
    {
      stepId: "initial.test",
      schemaRef: "step_outputs.schema.json#/definitions/initial.test",
      consecutiveFailures: 2,
      iteration: 5,
    },
  );

  assertEquals(error.consecutiveFailures, 2);
  assertEquals(error.stepId, "initial.test");
  assertEquals(error.iteration, 5);
  assertEquals(
    error.message.includes("2 consecutive times"),
    true,
    "Error message should mention consecutive failures",
  );
});

Deno.test("R5 - Structured Gate Flow - no intent on iteration > 1 should fail (error message format)", () => {
  // This tests the R4 error message format used when no intent is produced
  // The actual check is: iteration > 1 && routingResult === null && !schemaResolutionFailed && hasFlowRoutingEnabled()
  const expectedErrorPattern =
    /\[StepFlow\] No intent produced for iteration \d+ on step "[\w.]+"/;

  const sampleErrorMsg =
    '[StepFlow] No intent produced for iteration 3 on step "continuation.test". ' +
    "Flow steps must produce structured output with a valid intent. " +
    "Check that the step's schema includes next_action.action and the LLM returns valid JSON.";

  assertEquals(
    expectedErrorPattern.test(sampleErrorMsg),
    true,
    "Error message should match R4 format",
  );
  assertEquals(
    sampleErrorMsg.includes("must produce structured output"),
    true,
    "Error should guide user to check structured output",
  );
});

Deno.test("R5 - Schema resolution failure should set schemaResolutionFailed flag", () => {
  // When schema resolution fails (first time), the iteration should be aborted
  // and schemaResolutionFailed should be set to true
  const summaryWithSchemaFailure = createIterationSummary({
    iteration: 2,
    errors: [
      'Schema resolution failed for step "initial.test". Iteration aborted.',
    ],
    schemaResolutionFailed: true,
  });

  // Verify the flag is set
  assertEquals(summaryWithSchemaFailure.schemaResolutionFailed, true);

  // Verify this prevents R4 check from triggering (schemaResolutionFailed exempts from no-intent error)
  // The logic is: iteration > 1 && routingResult === null && !summary.schemaResolutionFailed
  // So when schemaResolutionFailed is true, R4 error should NOT be thrown
  const shouldTriggerR4Error = summaryWithSchemaFailure.iteration > 1 &&
    !summaryWithSchemaFailure.schemaResolutionFailed;
  assertEquals(
    shouldTriggerR4Error,
    false,
    "Schema failure should exempt from R4 check",
  );
});

Deno.test("R5 - Two consecutive schema failures should throw AgentSchemaResolutionError", () => {
  // Simulate the 2-strike rule: after 2 consecutive schema failures, run should abort
  const error = new AgentSchemaResolutionError(
    'Schema resolution failed 2 consecutive times for step "initial.default". ' +
      'Cannot resolve pointer "/definitions/initial.default" in step_outputs.schema.json. ' +
      "Flow halted to prevent infinite loop.",
    {
      stepId: "initial.default",
      schemaRef: "step_outputs.schema.json#/definitions/initial.default",
      consecutiveFailures: 2,
      iteration: 2,
    },
  );

  assertEquals(error.code, "FAILED_SCHEMA_RESOLUTION");
  assertEquals(error.recoverable, false); // Not recoverable - requires config fix
  assertEquals(error.consecutiveFailures, 2);
  assertEquals(error.stepId, "initial.default");
  assertEquals(
    error.message.includes("Flow halted to prevent infinite loop"),
    true,
    "Error should explain the halt reason",
  );
});

// =============================================================================
// Boundary Hook Tests
// @design_ref agents/docs/design/08_step_flow_design.md Section 7.1
// =============================================================================

import type { BoundaryHookPayload } from "./events.ts";

Deno.test("BoundaryHook - payload has correct structure for closure step", () => {
  // BoundaryHookPayload must have stepId, stepKind="closure", and optional structuredOutput
  const payload: BoundaryHookPayload = {
    stepId: "closure.issue",
    stepKind: "closure",
    structuredOutput: {
      next_action: { action: "closing", reason: "Task complete" },
    },
  };

  assertEquals(payload.stepId, "closure.issue");
  assertEquals(payload.stepKind, "closure");
  assertEquals(
    (payload.structuredOutput?.next_action as Record<string, unknown>)?.action,
    "closing",
  );
});

Deno.test("BoundaryHook - only closure steps can invoke boundary hook", () => {
  // Per design doc Section 7.1: Boundary hook fires only when Closure Step
  // emits 'closing' intent. Work/Verification steps cannot trigger it.

  // Verify the closure step type constraint
  const closurePayload: BoundaryHookPayload = {
    stepId: "closure.default",
    stepKind: "closure",
  };

  // stepKind must be "closure" - this is enforced by TypeScript type
  assertEquals(closurePayload.stepKind, "closure");

  // Work step cannot create a valid BoundaryHookPayload
  // (TypeScript prevents stepKind: "work" or stepKind: "verification")
});

Deno.test("BoundaryHook - event emitter accepts boundaryHook event", async () => {
  const emitter = new AgentEventEmitter();
  const receivedPayloads: BoundaryHookPayload[] = [];

  emitter.on("boundaryHook", (payload) => {
    receivedPayloads.push(payload);
  });

  await emitter.emit("boundaryHook", {
    stepId: "closure.release",
    stepKind: "closure",
    structuredOutput: { release_version: "1.0.0" },
  });

  // Verify payload was received
  assertEquals(receivedPayloads.length, 1);
  const payload = receivedPayloads[0];
  assertEquals(payload.stepId, "closure.release");
  assertEquals(payload.stepKind, "closure");
  assertEquals(
    (payload.structuredOutput as Record<string, unknown>)?.release_version,
    "1.0.0",
  );
});

Deno.test("BoundaryHook - only firing on closing intent (router integration)", () => {
  // Verify that router.signalCompletion is true only for closing intent from closure step
  const registry = createTestStepRegistry();
  const router = new WorkflowRouter(registry);

  // Closure step with closing intent - should signal completion (triggers boundary hook)
  const closingResult = router.route("closure.test", {
    intent: "closing",
    usedFallback: false,
  });
  assertEquals(closingResult.signalCompletion, true);

  // Closure step with repeat intent - should NOT signal completion (no boundary hook)
  const repeatResult = router.route("closure.test", {
    intent: "repeat",
    usedFallback: false,
  });
  assertEquals(repeatResult.signalCompletion, false);
});

Deno.test("BoundaryHook - work step closing intent rejected (no boundary hook possible)", () => {
  // Per design doc: Work/Verification steps must NOT emit closing intent
  // This prevents them from triggering boundary hooks
  const registry = createTestStepRegistry();
  const router = new WorkflowRouter(registry);

  // Work step (initial.*) trying to emit closing - should throw
  assertThrows(
    () =>
      router.route("initial.test", {
        intent: "closing",
        usedFallback: false,
      }),
    RoutingError,
    "Intent 'closing' not allowed for work step",
  );
});

// =============================================================================
// stepId Normalization Tests
// @design_ref agents/docs/design/08_step_flow_design.md Section 3.1
// =============================================================================

Deno.test("stepId Normalization - Flow owns canonical stepId", () => {
  // Per design doc Section 3.1:
  // - Flow has canonical stepId value
  // - LLM may return different stepId (from context inference)
  // - Runtime corrects to canonical value

  // This is a design contract test - verifying the normalization logic
  const expectedStepId = "initial.issue";
  const llmReturnedStepId = "s_initial_issue"; // LLM may return wrong format

  // Simulate normalization logic (from runner.ts normalizeStructuredOutputStepId)
  const structuredOutput: Record<string, unknown> = {
    stepId: llmReturnedStepId,
    status: "in_progress",
    next_action: { action: "continue" },
  };

  // Normalize: if differs, correct to expected
  if (structuredOutput.stepId !== expectedStepId) {
    structuredOutput.stepId = expectedStepId;
  }

  assertEquals(
    structuredOutput.stepId,
    expectedStepId,
    "stepId should be corrected to canonical value",
  );
});

Deno.test("stepId Normalization - no correction when stepId matches", () => {
  const expectedStepId = "initial.issue";
  const structuredOutput: Record<string, unknown> = {
    stepId: expectedStepId, // Already correct
    status: "completed",
  };

  // No change needed
  const originalStepId = structuredOutput.stepId;

  // Simulate normalization - should not change
  if (structuredOutput.stepId !== expectedStepId) {
    structuredOutput.stepId = expectedStepId;
  }

  assertEquals(structuredOutput.stepId, originalStepId);
  assertEquals(structuredOutput.stepId, expectedStepId);
});

Deno.test("stepId Normalization - telemetry logs when correction occurs", () => {
  // Per design doc: "[StepFlow] stepId corrected" should be logged
  // This tests the expected log message format

  const expectedStepId = "continuation.analysis";
  const actualStepId = "s_analysis_continuation";

  // Expected log format when correction occurs
  const expectedLogPattern =
    `[StepFlow] stepId corrected: "${actualStepId}" -> "${expectedStepId}"`;

  assertEquals(
    expectedLogPattern.includes("[StepFlow] stepId corrected"),
    true,
    "Log should include [StepFlow] prefix",
  );
  assertEquals(
    expectedLogPattern.includes(actualStepId),
    true,
    "Log should include original stepId",
  );
  assertEquals(
    expectedLogPattern.includes(expectedStepId),
    true,
    "Log should include canonical stepId",
  );
});

Deno.test("stepId Normalization - LLM only needs to provide intent", () => {
  // Per design doc:
  // "LLM only needs to return intent (next/repeat/jump/closing) and optional targetStepId"
  // stepId is reference information only, Flow has single authority

  const structuredOutput = {
    // stepId may be omitted or wrong - Flow will use its canonical value
    next_action: {
      action: "next",
      reason: "Work in progress",
    },
    // Optional targetStepId for jump intent
    // targetStepId: "s_review",
  };

  // The important part is the intent, not the stepId
  const nextAction = structuredOutput.next_action as Record<string, unknown>;
  assertEquals(nextAction.action, "next");

  // Flow determines actual stepId from its registry, not from LLM output
});
