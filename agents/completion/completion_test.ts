/**
 * Completion Handler Tests
 *
 * Tests for the completion module including:
 * - Factory functions
 * - IssueCompletionHandler (contract-compliant)
 * - CompositeCompletionHandler (AND/OR logic)
 * - IterateCompletionHandler
 * - ManualCompletionHandler
 * - CheckBudgetCompletionHandler
 * - StructuredSignalCompletionHandler
 * - MockStateChecker
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { createRegistryCompletionHandler } from "./factory.ts";
import { ExternalStateCompletionAdapter } from "./external-state-adapter.ts";
import { IssueCompletionHandler } from "./issue.ts";
import { CompositeCompletionHandler } from "./composite.ts";
import { IterateCompletionHandler } from "./iterate.ts";
import { ManualCompletionHandler } from "./manual.ts";
import { CheckBudgetCompletionHandler } from "./check-budget.ts";
import { StructuredSignalCompletionHandler } from "./structured-signal.ts";
import { MockStateChecker } from "./external-state-checker.ts";
import { StepMachineCompletionHandler } from "./step-machine.ts";
import type { IterationSummary } from "./types.ts";
import type { AgentDefinition } from "../src_common/types.ts";
import type { ExtendedStepsRegistry } from "../common/completion-types.ts";

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a mock iteration summary for testing
 */
function createMockIterationSummary(
  options: Partial<IterationSummary> = {},
): IterationSummary {
  return {
    iteration: options.iteration ?? 1,
    assistantResponses: options.assistantResponses ?? [],
    toolsUsed: options.toolsUsed ?? [],
    errors: options.errors ?? [],
    structuredOutput: options.structuredOutput,
  };
}

/**
 * Create a minimal mock agent definition
 *
 * Uses type assertions for testing purposes - the tests only need
 * the runner.completion fields, not the full definition.
 */
function createMockAgentDefinition(
  overrides: {
    completion?: Partial<AgentDefinition["runner"]["completion"]>;
  } = {},
): AgentDefinition {
  const baseCompletion = {
    type: "iterationBudget" as const,
    config: {
      maxIterations: 10,
    },
  };

  const completion = overrides.completion
    ? { ...baseCompletion, ...overrides.completion }
    : baseCompletion;

  return {
    name: "test-agent",
    description: "Test agent",
    runner: {
      flow: {
        systemPromptPath: "prompts/system.md",
        prompts: {
          registry: "prompts/registry.md",
          fallbackDir: "prompts",
        },
      },
      completion,
      boundaries: {
        allowedTools: ["Bash", "Read", "Write"],
        permissionMode: "plan",
      },
      execution: {},
      telemetry: {
        logging: { directory: "/tmp/claude/test-logs", format: "jsonl" },
      },
    },
  } as AgentDefinition;
}

// =============================================================================
// IssueCompletionHandler Tests
// =============================================================================

Deno.test("IssueCompletionHandler - check without cached state returns incomplete", () => {
  const mockChecker = new MockStateChecker();
  const handler = new IssueCompletionHandler(
    { issueNumber: 123 },
    mockChecker,
  );

  const result = handler.check({ iteration: 1 });
  assertEquals(result.complete, false);
});

Deno.test("IssueCompletionHandler - check with cached open state returns incomplete", async () => {
  const mockChecker = new MockStateChecker();
  mockChecker.setIssueState(123, false);

  const handler = new IssueCompletionHandler(
    { issueNumber: 123 },
    mockChecker,
  );

  await handler.forceRefreshState();
  const result = handler.check({ iteration: 1 });
  assertEquals(result.complete, false);
});

Deno.test("IssueCompletionHandler - check with cached closed state returns complete", async () => {
  const mockChecker = new MockStateChecker();
  mockChecker.setIssueState(123, true);

  const handler = new IssueCompletionHandler(
    { issueNumber: 123 },
    mockChecker,
  );

  await handler.forceRefreshState();
  const result = handler.check({ iteration: 1 });
  assertEquals(result.complete, true);
  assertEquals(result.reason?.includes("123"), true);
});

Deno.test("IssueCompletionHandler - refreshState respects interval", async () => {
  const mockChecker = new MockStateChecker();
  mockChecker.setIssueState(123, false);

  const handler = new IssueCompletionHandler(
    { issueNumber: 123, checkInterval: 60000 },
    mockChecker,
  );

  await handler.forceRefreshState();
  assertEquals(handler.needsRefresh(), false);

  // Calling refreshState should not update due to interval
  mockChecker.setIssueState(123, true);
  await handler.refreshState();

  const result = handler.check({ iteration: 1 });
  // Still false because refresh was skipped
  assertEquals(result.complete, false);
});

Deno.test("IssueCompletionHandler - forceRefreshState ignores interval", async () => {
  const mockChecker = new MockStateChecker();
  mockChecker.setIssueState(123, false);

  const handler = new IssueCompletionHandler(
    { issueNumber: 123, checkInterval: 60000 },
    mockChecker,
  );

  await handler.forceRefreshState();

  mockChecker.setIssueState(123, true);
  await handler.forceRefreshState();

  const result = handler.check({ iteration: 1 });
  assertEquals(result.complete, true);
});

Deno.test("IssueCompletionHandler - buildPrompt initial phase", () => {
  const mockChecker = new MockStateChecker();
  const handler = new IssueCompletionHandler(
    { issueNumber: 456 },
    mockChecker,
  );

  const prompt = handler.buildPrompt("initial", 1);
  assertEquals(prompt.includes("456"), true);
});

Deno.test("IssueCompletionHandler - buildPrompt continuation phase", () => {
  const mockChecker = new MockStateChecker();
  const handler = new IssueCompletionHandler(
    { issueNumber: 456 },
    mockChecker,
  );

  const prompt = handler.buildPrompt("continuation", 5);
  assertEquals(prompt.includes("456"), true);
  assertEquals(prompt.includes("5"), true);
});

Deno.test("IssueCompletionHandler - getCompletionCriteria", () => {
  const mockChecker = new MockStateChecker();
  const handler = new IssueCompletionHandler(
    { issueNumber: 789, repo: "test/repo" },
    mockChecker,
  );

  const criteria = handler.getCompletionCriteria();
  assertEquals(criteria.summary.includes("789"), true);
  assertEquals(criteria.detailed.includes("test/repo"), true);
});

Deno.test("IssueCompletionHandler - getCompletionCriteria with label-only", () => {
  const handler = new IssueCompletionHandler(
    { issueNumber: 42, closureAction: "label-only" },
    new MockStateChecker(),
  );
  const criteria = handler.getCompletionCriteria();
  assertEquals(criteria.summary, "Phase complete for Issue #42");
  assertStringIncludes(criteria.detailed, "Do NOT close");
  assertStringIncludes(criteria.detailed, "#42");
});

Deno.test("IssueCompletionHandler - getCompletionCriteria with label-and-close", () => {
  const handler = new IssueCompletionHandler(
    { issueNumber: 42, closureAction: "label-and-close" },
    new MockStateChecker(),
  );
  const criteria = handler.getCompletionCriteria();
  assertEquals(criteria.summary, "Issue #42 labeled and closed");
  assertStringIncludes(criteria.detailed, "close");
});

Deno.test("IssueCompletionHandler - getCompletionCriteria with close (explicit)", () => {
  const handler = new IssueCompletionHandler(
    { issueNumber: 42, closureAction: "close" },
    new MockStateChecker(),
  );
  const criteria = handler.getCompletionCriteria();
  assertEquals(criteria.summary, "Issue #42 closed");
  assertStringIncludes(criteria.detailed, "closed");
});

Deno.test("IssueCompletionHandler - getCompletionCriteria default (no closureAction)", () => {
  const handler = new IssueCompletionHandler(
    { issueNumber: 42 },
    new MockStateChecker(),
  );
  const criteria = handler.getCompletionCriteria();
  assertEquals(criteria.summary, "Issue #42 closed");
  assertStringIncludes(criteria.detailed, "closed");
});

Deno.test("IssueCompletionHandler - transition always returns closure", () => {
  const mockChecker = new MockStateChecker();
  const handler = new IssueCompletionHandler(
    { issueNumber: 123 },
    mockChecker,
  );

  // StepResult requires stepId and passed
  assertEquals(
    handler.transition({ stepId: "test", passed: true }),
    "closure",
  );
  assertEquals(
    handler.transition({ stepId: "test", passed: false }),
    "closure",
  );
});

Deno.test("IssueCompletionHandler - getCachedState returns undefined initially", () => {
  const mockChecker = new MockStateChecker();
  const handler = new IssueCompletionHandler(
    { issueNumber: 123 },
    mockChecker,
  );

  assertEquals(handler.getCachedState(), undefined);
});

// =============================================================================
// CompositeCompletionHandler Tests
// =============================================================================

Deno.test("CompositeCompletionHandler - AND logic - all incomplete", async () => {
  const definition = createMockAgentDefinition({
    completion: {
      type: "composite",
      config: {
        operator: "and",
        conditions: [
          { type: "iterationBudget", config: { maxIterations: 10 } },
          { type: "keywordSignal", config: { completionKeyword: "DONE" } },
        ],
      },
    },
  });

  const conditions = definition.runner.completion.config.conditions ?? [];
  const handler = new CompositeCompletionHandler(
    "and",
    conditions,
    {},
    "/test",
    definition,
  );

  const complete = await handler.isComplete();
  assertEquals(complete, false);
});

Deno.test("CompositeCompletionHandler - OR logic - one complete", async () => {
  const definition = createMockAgentDefinition({
    completion: {
      type: "composite",
      config: {
        operator: "or",
        conditions: [
          { type: "iterationBudget", config: { maxIterations: 1 } },
          { type: "keywordSignal", config: { completionKeyword: "DONE" } },
        ],
      },
    },
  });

  const handler = new CompositeCompletionHandler(
    "or",
    definition.runner.completion.config.conditions ?? [],
    {},
    "/test",
    definition,
  );

  // Access internal handlers to set iteration count
  // @ts-ignore - accessing private for testing
  const iterateHandler = handler.handlers[0] as IterateCompletionHandler;
  iterateHandler.setCurrentIteration(1);

  const complete = await handler.isComplete();
  assertEquals(complete, true);
});

Deno.test("CompositeCompletionHandler - FIRST logic - tracks completed index", async () => {
  const definition = createMockAgentDefinition({
    completion: {
      type: "composite",
      config: {
        operator: "first",
        conditions: [
          { type: "iterationBudget", config: { maxIterations: 10 } },
          { type: "iterationBudget", config: { maxIterations: 1 } },
        ],
      },
    },
  });

  const handler = new CompositeCompletionHandler(
    "first",
    definition.runner.completion.config.conditions ?? [],
    {},
    "/test",
    definition,
  );

  // Set second handler to complete
  // @ts-ignore - accessing private for testing
  const secondHandler = handler.handlers[1] as IterateCompletionHandler;
  secondHandler.setCurrentIteration(1);

  const complete = await handler.isComplete();
  assertEquals(complete, true);

  const desc = await handler.getCompletionDescription();
  assertEquals(desc.includes("condition 2"), true);
});

Deno.test("CompositeCompletionHandler - buildCompletionCriteria combines handlers", () => {
  const definition = createMockAgentDefinition({
    completion: {
      type: "composite",
      config: {
        operator: "and",
        conditions: [
          { type: "iterationBudget", config: { maxIterations: 5 } },
          { type: "iterationBudget", config: { maxIterations: 10 } },
        ],
      },
    },
  });

  const handler = new CompositeCompletionHandler(
    "and",
    definition.runner.completion.config.conditions ?? [],
    {},
    "/test",
    definition,
  );

  const criteria = handler.buildCompletionCriteria();
  assertEquals(criteria.short.includes("AND"), true);
});

Deno.test("CompositeCompletionHandler - buildInitialPrompt uses first handler", async () => {
  const definition = createMockAgentDefinition({
    completion: {
      type: "composite",
      config: {
        operator: "or",
        conditions: [
          { type: "iterationBudget", config: { maxIterations: 5 } },
        ],
      },
    },
  });

  const handler = new CompositeCompletionHandler(
    "or",
    definition.runner.completion.config.conditions ?? [],
    {},
    "/test",
    definition,
  );

  const prompt = await handler.buildInitialPrompt();
  assertEquals(prompt.includes("iteration"), true);
});

Deno.test("CompositeCompletionHandler - throws on unsupported condition type", () => {
  const definition = createMockAgentDefinition();

  try {
    new CompositeCompletionHandler(
      "and",
      // deno-lint-ignore no-explicit-any
      [{ type: "custom" as any, config: {} }],
      {},
      "/test",
      definition,
    );
    throw new Error("Should have thrown");
  } catch (error) {
    assertEquals((error as Error).message.includes("Unsupported"), true);
  }
});

// =============================================================================
// IterateCompletionHandler Tests
// =============================================================================

Deno.test("IterateCompletionHandler - initialization", () => {
  const handler = new IterateCompletionHandler(100);

  assertEquals(handler.type, "iterationBudget");
});

Deno.test("IterateCompletionHandler - isComplete before max", async () => {
  const handler = new IterateCompletionHandler(10);
  handler.setCurrentIteration(5);

  const complete = await handler.isComplete();
  assertEquals(complete, false);
});

Deno.test("IterateCompletionHandler - isComplete at max", async () => {
  const handler = new IterateCompletionHandler(10);
  handler.setCurrentIteration(10);

  const complete = await handler.isComplete();
  assertEquals(complete, true);
});

Deno.test("IterateCompletionHandler - isComplete after max", async () => {
  const handler = new IterateCompletionHandler(10);
  handler.setCurrentIteration(15);

  const complete = await handler.isComplete();
  assertEquals(complete, true);
});

Deno.test("IterateCompletionHandler - buildCompletionCriteria", () => {
  const handler = new IterateCompletionHandler(25);
  const criteria = handler.buildCompletionCriteria();

  assertEquals(criteria.short, "25 iterations");
  assertEquals(criteria.detailed.includes("25"), true);
});

Deno.test("IterateCompletionHandler - getCompletionDescription", async () => {
  const handler = new IterateCompletionHandler(20);
  handler.setCurrentIteration(7);

  const desc = await handler.getCompletionDescription();
  assertEquals(desc.includes("7"), true);
  assertEquals(desc.includes("20"), true);
});

Deno.test("IterateCompletionHandler - buildInitialPrompt", async () => {
  const handler = new IterateCompletionHandler(50);
  const prompt = await handler.buildInitialPrompt();

  assertEquals(prompt.includes("50"), true);
  assertEquals(prompt.includes("iteration"), true);
});

Deno.test("IterateCompletionHandler - buildContinuationPrompt updates iteration", async () => {
  const handler = new IterateCompletionHandler(30);
  const prompt = await handler.buildContinuationPrompt(15);

  assertEquals(prompt.includes("15"), true);
  assertEquals(prompt.includes("30"), true);
  assertEquals(prompt.includes("15"), true); // remaining
});

// =============================================================================
// ManualCompletionHandler Tests
// =============================================================================

Deno.test("ManualCompletionHandler - initialization", () => {
  const handler = new ManualCompletionHandler("TASK_COMPLETE");

  assertEquals(handler.type, "keywordSignal");
});

Deno.test("ManualCompletionHandler - isComplete without summary", async () => {
  const handler = new ManualCompletionHandler("DONE");

  const complete = await handler.isComplete();
  assertEquals(complete, false);
});

Deno.test("ManualCompletionHandler - isComplete with keyword in response", async () => {
  const handler = new ManualCompletionHandler("FINISHED");

  // Build continuation prompt stores the summary
  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      assistantResponses: ["Work completed. FINISHED"],
    }),
  );

  const complete = await handler.isComplete();
  assertEquals(complete, true);
});

Deno.test("ManualCompletionHandler - isComplete without keyword", async () => {
  const handler = new ManualCompletionHandler("COMPLETE");

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      assistantResponses: ["Still working on it..."],
    }),
  );

  const complete = await handler.isComplete();
  assertEquals(complete, false);
});

Deno.test("ManualCompletionHandler - buildCompletionCriteria", () => {
  const handler = new ManualCompletionHandler("MY_KEYWORD");
  const criteria = handler.buildCompletionCriteria();

  assertEquals(criteria.short.includes("MY_KEYWORD"), true);
  assertEquals(criteria.detailed.includes("MY_KEYWORD"), true);
});

Deno.test("ManualCompletionHandler - getCompletionDescription when complete", async () => {
  const handler = new ManualCompletionHandler("DONE");

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      assistantResponses: ["Task is DONE"],
    }),
  );

  const desc = await handler.getCompletionDescription();
  assertEquals(desc.includes("detected"), true);
});

Deno.test("ManualCompletionHandler - getCompletionDescription when waiting", async () => {
  const handler = new ManualCompletionHandler("DONE");

  const desc = await handler.getCompletionDescription();
  assertEquals(desc.includes("Waiting"), true);
});

// =============================================================================
// CheckBudgetCompletionHandler Tests
// =============================================================================

Deno.test("CheckBudgetCompletionHandler - initialization", () => {
  const handler = new CheckBudgetCompletionHandler(10);

  assertEquals(handler.type, "checkBudget");
  assertEquals(handler.getCheckCount(), 0);
});

Deno.test("CheckBudgetCompletionHandler - incrementCheckCount", () => {
  const handler = new CheckBudgetCompletionHandler(5);

  handler.incrementCheckCount();
  assertEquals(handler.getCheckCount(), 1);

  handler.incrementCheckCount();
  handler.incrementCheckCount();
  assertEquals(handler.getCheckCount(), 3);
});

Deno.test("CheckBudgetCompletionHandler - isComplete before max", async () => {
  const handler = new CheckBudgetCompletionHandler(10);

  handler.incrementCheckCount();
  handler.incrementCheckCount();

  const complete = await handler.isComplete();
  assertEquals(complete, false);
});

Deno.test("CheckBudgetCompletionHandler - isComplete at max", async () => {
  const handler = new CheckBudgetCompletionHandler(3);

  handler.incrementCheckCount();
  handler.incrementCheckCount();
  handler.incrementCheckCount();

  const complete = await handler.isComplete();
  assertEquals(complete, true);
});

Deno.test("CheckBudgetCompletionHandler - buildCompletionCriteria", () => {
  const handler = new CheckBudgetCompletionHandler(15);
  const criteria = handler.buildCompletionCriteria();

  assertEquals(criteria.short, "15 checks");
  assertEquals(criteria.detailed.includes("15"), true);
});

Deno.test("CheckBudgetCompletionHandler - buildContinuationPrompt increments count", async () => {
  const handler = new CheckBudgetCompletionHandler(10);

  assertEquals(handler.getCheckCount(), 0);

  await handler.buildContinuationPrompt(1);
  assertEquals(handler.getCheckCount(), 1);

  await handler.buildContinuationPrompt(2);
  assertEquals(handler.getCheckCount(), 2);
});

Deno.test("CheckBudgetCompletionHandler - getCompletionDescription", async () => {
  const handler = new CheckBudgetCompletionHandler(5);

  handler.incrementCheckCount();
  handler.incrementCheckCount();

  const desc = await handler.getCompletionDescription();
  assertEquals(desc.includes("2"), true);
  assertEquals(desc.includes("5"), true);
});

// =============================================================================
// StructuredSignalCompletionHandler Tests
// =============================================================================

Deno.test("StructuredSignalCompletionHandler - initialization", () => {
  const handler = new StructuredSignalCompletionHandler("complete-signal");

  assertEquals(handler.type, "structuredSignal");
});

Deno.test("StructuredSignalCompletionHandler - isComplete without summary", async () => {
  const handler = new StructuredSignalCompletionHandler("done");

  const complete = await handler.isComplete();
  assertEquals(complete, false);
});

Deno.test("StructuredSignalCompletionHandler - isComplete with matching signal type", async () => {
  const handler = new StructuredSignalCompletionHandler("task-complete");

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      structuredOutput: { signal: "task-complete", result: "done" },
    }),
  );

  const complete = await handler.isComplete();
  assertEquals(complete, true);
});

Deno.test("StructuredSignalCompletionHandler - isComplete without matching signal", async () => {
  const handler = new StructuredSignalCompletionHandler("my-signal");

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      structuredOutput: { signal: "other-signal", data: "value" },
    }),
  );

  const complete = await handler.isComplete();
  assertEquals(complete, false);
});

Deno.test("StructuredSignalCompletionHandler - isComplete with status=completed", async () => {
  const handler = new StructuredSignalCompletionHandler("complete");

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      structuredOutput: { status: "completed", summary: "Task done" },
    }),
  );

  const complete = await handler.isComplete();
  assertEquals(complete, true);
});

Deno.test("StructuredSignalCompletionHandler - isComplete with required fields match", async () => {
  const handler = new StructuredSignalCompletionHandler("complete", {
    status: "success",
    code: 0,
  });

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      structuredOutput: { signal: "complete", status: "success", code: 0 },
    }),
  );

  const complete = await handler.isComplete();
  assertEquals(complete, true);
});

Deno.test("StructuredSignalCompletionHandler - isComplete with required fields mismatch", async () => {
  const handler = new StructuredSignalCompletionHandler("complete", {
    status: "success",
  });

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      structuredOutput: { signal: "complete", status: "failure" },
    }),
  );

  const complete = await handler.isComplete();
  assertEquals(complete, false);
});

Deno.test("StructuredSignalCompletionHandler - buildCompletionCriteria without fields", () => {
  const handler = new StructuredSignalCompletionHandler("done-signal");
  const criteria = handler.buildCompletionCriteria();

  assertEquals(criteria.short.includes("done-signal"), true);
});

Deno.test("StructuredSignalCompletionHandler - buildCompletionCriteria with fields", () => {
  const handler = new StructuredSignalCompletionHandler("done-signal", {
    status: "ok",
  });
  const criteria = handler.buildCompletionCriteria();

  assertEquals(criteria.detailed.includes("status"), true);
});

Deno.test("StructuredSignalCompletionHandler - getCompletionDescription", async () => {
  const handler = new StructuredSignalCompletionHandler("test-signal");

  let desc = await handler.getCompletionDescription();
  assertEquals(desc.includes("Waiting"), true);

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      structuredOutput: { signal: "test-signal" },
    }),
  );

  desc = await handler.getCompletionDescription();
  assertEquals(desc.includes("detected"), true);
});

// =============================================================================
// MockStateChecker Tests
// =============================================================================

Deno.test("MockStateChecker - default state is open", async () => {
  const checker = new MockStateChecker();
  const state = await checker.checkIssueState(999);

  assertEquals(state.number, 999);
  assertEquals(state.closed, false);
});

Deno.test("MockStateChecker - setIssueState sets closed state", async () => {
  const checker = new MockStateChecker();
  checker.setIssueState(123, true);

  const state = await checker.checkIssueState(123);
  assertEquals(state.closed, true);
});

Deno.test("MockStateChecker - setIssueStateDetailed sets full state", async () => {
  const checker = new MockStateChecker();
  checker.setIssueStateDetailed({
    number: 456,
    closed: true,
    title: "Test Issue",
    state: "CLOSED",
    labels: ["bug", "urgent"],
    lastChecked: new Date(),
  });

  const state = await checker.checkIssueState(456);
  assertEquals(state.number, 456);
  assertEquals(state.closed, true);
  assertEquals(state.title, "Test Issue");
  assertEquals(state.labels?.length, 2);
});

Deno.test("MockStateChecker - clear removes all states", async () => {
  const checker = new MockStateChecker();
  checker.setIssueState(111, true);
  checker.setIssueState(222, true);

  checker.clear();

  const state1 = await checker.checkIssueState(111);
  const state2 = await checker.checkIssueState(222);

  assertEquals(state1.closed, false);
  assertEquals(state2.closed, false);
});

Deno.test("MockStateChecker - retrieves state by issue number", async () => {
  const checker = new MockStateChecker();
  checker.setIssueState(789, true);

  // MockStateChecker only uses issueNumber, repo is not needed for testing
  const state = await checker.checkIssueState(789);
  assertEquals(state.closed, true);
});

// =============================================================================
// StepMachineCompletionHandler Tests
// =============================================================================

/**
 * Create a mock steps registry for testing
 *
 * All Flow steps must have:
 * - structuredGate: defines how to extract intent from AI response
 * - transitions: maps intents to next steps
 */
function createMockStepsRegistry(
  overrides: Partial<ExtendedStepsRegistry> = {},
): ExtendedStepsRegistry {
  const base: ExtendedStepsRegistry = {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    entryStep: "initial.test",
    steps: {
      "initial.test": {
        stepId: "initial.test",
        name: "Initial Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "initial_test",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["next", "repeat", "closing"],
          intentField: "next_action.action",
          intentSchemaRef: "#/test",
          fallbackIntent: "next",
        },
        transitions: {
          next: { target: "continuation.test" },
          repeat: { target: "initial.test" },
          closing: { target: "closure" },
        },
      },
      "continuation.test": {
        stepId: "continuation.test",
        name: "Continuation Test Step",
        c2: "continuation",
        c3: "test",
        edition: "default",
        fallbackKey: "continuation_test",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["next", "repeat", "closing"],
          intentField: "next_action.action",
          intentSchemaRef: "#/test",
          fallbackIntent: "next",
        },
        transitions: {
          next: { target: "continuation.test" },
          repeat: { target: "continuation.test" },
          closing: { target: "closure" },
        },
      },
    },
  };

  return { ...base, ...overrides };
}

Deno.test("StepMachineCompletionHandler - initialization", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineCompletionHandler(registry);

  assertEquals(handler.type, "stepMachine");

  const state = handler.getState();
  assertEquals(state.currentStepId, "initial.test");
  assertEquals(state.stepIteration, 0);
  assertEquals(state.totalIterations, 0);
  assertEquals(state.retryCount, 0);
  assertEquals(state.isComplete, false);
});

Deno.test("StepMachineCompletionHandler - initialization with entry step", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineCompletionHandler(
    registry,
    "continuation.test",
  );

  const state = handler.getState();
  assertEquals(state.currentStepId, "continuation.test");
});

Deno.test("StepMachineCompletionHandler - getStepContext returns context", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineCompletionHandler(registry);

  const context = handler.getStepContext();
  assertExists(context);
  assertExists(context.outputs);
});

Deno.test("StepMachineCompletionHandler - recordStepOutput stores data", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineCompletionHandler(registry);

  handler.recordStepOutput("step1", { result: "success", value: 42 });

  const context = handler.getStepContext();
  assertEquals(context.get("step1", "result"), "success");
  assertEquals(context.get("step1", "value"), 42);
});

Deno.test("StepMachineCompletionHandler - getNextStep initial to continuation", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineCompletionHandler(registry);

  const transition = handler.getNextStep({
    stepId: "initial.test",
    passed: true,
  });

  assertEquals(transition.nextStep, "continuation.test");
  assertEquals(transition.passed, true);
});

Deno.test("StepMachineCompletionHandler - getNextStep single step to complete", () => {
  const registry = createMockStepsRegistry({
    entryStep: "initial.single",
    steps: {
      "initial.single": {
        stepId: "initial.single",
        name: "Single Step",
        c2: "initial",
        c3: "single",
        edition: "default",
        fallbackKey: "initial_single",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["next", "closing"],
          intentField: "next_action.action",
          intentSchemaRef: "#/test",
          fallbackIntent: "closing",
        },
        transitions: {
          next: { target: "closure" },
          closing: { target: "closure" },
        },
      },
    },
  });
  const handler = new StepMachineCompletionHandler(registry, "initial.single");

  const transition = handler.getNextStep({
    stepId: "initial.single",
    passed: true,
  });

  assertEquals(transition.nextStep, "closure");
});

Deno.test("StepMachineCompletionHandler - transition updates state", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineCompletionHandler(registry);

  const nextStep = handler.transition({
    stepId: "initial.test",
    passed: true,
  });

  assertEquals(nextStep, "continuation.test");

  const state = handler.getState();
  assertEquals(state.currentStepId, "continuation.test");
  assertEquals(state.retryCount, 0);
});

Deno.test("StepMachineCompletionHandler - transition to complete", () => {
  const registry = createMockStepsRegistry({
    entryStep: "initial.only",
    steps: {
      "initial.only": {
        stepId: "initial.only",
        name: "Only Step",
        c2: "initial",
        c3: "only",
        edition: "default",
        fallbackKey: "initial_only",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["next", "closing"],
          intentField: "next_action.action",
          intentSchemaRef: "#/test",
          fallbackIntent: "closing",
        },
        transitions: {
          next: { target: "closure" },
          closing: { target: "closure" },
        },
      },
    },
  });
  const handler = new StepMachineCompletionHandler(registry, "initial.only");

  const nextStep = handler.transition({
    stepId: "initial.only",
    passed: true,
  });

  assertEquals(nextStep, "closure");

  const state = handler.getState();
  assertEquals(state.isComplete, true);
  assertExists(state.completionReason);
});

Deno.test("StepMachineCompletionHandler - isComplete false initially", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineCompletionHandler(registry);

  const complete = await handler.isComplete();
  assertEquals(complete, false);
});

Deno.test("StepMachineCompletionHandler - isComplete true after transition to complete", async () => {
  const registry = createMockStepsRegistry({
    entryStep: "initial.final",
    steps: {
      "initial.final": {
        stepId: "initial.final",
        name: "Final Step",
        c2: "initial",
        c3: "final",
        edition: "default",
        fallbackKey: "initial_final",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["next", "closing"],
          intentField: "next_action.action",
          intentSchemaRef: "#/test",
          fallbackIntent: "closing",
        },
        transitions: {
          next: { target: "closure" },
          closing: { target: "closure" },
        },
      },
    },
  });
  const handler = new StepMachineCompletionHandler(registry, "initial.final");

  handler.transition({ stepId: "initial.final", passed: true });

  const complete = await handler.isComplete();
  assertEquals(complete, true);
});

Deno.test("StepMachineCompletionHandler - isComplete with structured output status=completed", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineCompletionHandler(registry);

  const summary = createMockIterationSummary({
    structuredOutput: { status: "completed" },
  });
  handler.setCurrentSummary(summary);

  const complete = await handler.isComplete();
  assertEquals(complete, true);
});

Deno.test("StepMachineCompletionHandler - isComplete with next_action.action=complete", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineCompletionHandler(registry);

  const summary = createMockIterationSummary({
    structuredOutput: { next_action: { action: "complete", reason: "done" } },
  });
  handler.setCurrentSummary(summary);

  const complete = await handler.isComplete();
  assertEquals(complete, true);
});

Deno.test("StepMachineCompletionHandler - buildCompletionCriteria", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineCompletionHandler(registry);

  const criteria = handler.buildCompletionCriteria();

  assertEquals(criteria.short.includes("Step machine"), true);
  assertEquals(criteria.detailed.includes("initial.test"), true);
});

Deno.test("StepMachineCompletionHandler - buildInitialPrompt", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineCompletionHandler(registry);

  const prompt = await handler.buildInitialPrompt();

  assertEquals(prompt.includes("initial.test"), true);
});

Deno.test("StepMachineCompletionHandler - buildContinuationPrompt updates state", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineCompletionHandler(registry);

  await handler.buildContinuationPrompt(5);

  const state = handler.getState();
  assertEquals(state.totalIterations, 5);
  assertEquals(state.stepIteration, 1);
});

Deno.test("StepMachineCompletionHandler - getCompletionDescription not complete", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineCompletionHandler(registry);

  const desc = await handler.getCompletionDescription();

  assertEquals(desc.includes("initial.test"), true);
  assertEquals(desc.includes("Step"), true);
});

Deno.test("StepMachineCompletionHandler - getCompletionDescription when complete", async () => {
  const registry = createMockStepsRegistry({
    entryStep: "initial.end",
    steps: {
      "initial.end": {
        stepId: "initial.end",
        name: "End Step",
        c2: "initial",
        c3: "end",
        edition: "default",
        fallbackKey: "initial_end",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["next", "closing"],
          intentField: "next_action.action",
          intentSchemaRef: "#/test",
          fallbackIntent: "closing",
        },
        transitions: {
          next: { target: "closure" },
          closing: { target: "closure" },
        },
      },
    },
  });
  const handler = new StepMachineCompletionHandler(registry, "initial.end");

  handler.transition({ stepId: "initial.end", passed: true });

  const desc = await handler.getCompletionDescription();

  // Description should indicate completion via transition
  assertEquals(
    desc.includes("Transition") ||
      desc.includes("complete") ||
      desc.includes("intent"),
    true,
  );
});

Deno.test("StepMachineCompletionHandler - step context toUV converts outputs", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineCompletionHandler(registry);

  handler.recordStepOutput("step1", { result: "success", count: 10 });

  const context = handler.getStepContext();
  const uvVars = context.toUV({
    result: { from: "step1.result" },
    count: { from: "step1.count" },
  });

  assertEquals(uvVars["uv-result"], "success");
  assertEquals(uvVars["uv-count"], "10");
});

// =============================================================================
// createRegistryCompletionHandler Tests
// =============================================================================

Deno.test("createRegistryCompletionHandler - externalState with args.issue returns adapter", async () => {
  const definition: AgentDefinition = {
    name: "test-agent",
    displayName: "Test",
    description: "Test",
    version: "1.0.0",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "prompts/system.md",
        prompts: { registry: "steps_registry.json", fallbackDir: "prompts/" },
      },
      completion: {
        type: "externalState",
        config: { maxIterations: 10 },
      },
      boundaries: {
        allowedTools: ["Bash", "Read"],
        permissionMode: "default",
        github: {
          enabled: true,
          labels: {},
          defaultClosureAction: "label-only",
        },
      },
      execution: {},
      telemetry: {
        logging: { directory: "/tmp/claude/test-logs", format: "jsonl" },
      },
    },
  };

  const result = await createRegistryCompletionHandler(
    definition,
    { issue: 123, repository: "owner/repo" },
    "/tmp/claude/test-agent",
  );

  assertExists(result);
  assertEquals(result.type, "externalState");
  // Verify it's an ExternalStateCompletionAdapter by checking adapter-specific method
  assertEquals(
    typeof (result as ExternalStateCompletionAdapter).buildInitialPrompt,
    "function",
  );
  assertEquals(result instanceof ExternalStateCompletionAdapter, true);
});

Deno.test("createRegistryCompletionHandler - externalState without args.issue throws", async () => {
  const definition: AgentDefinition = {
    name: "test-agent",
    displayName: "Test",
    description: "Test",
    version: "1.0.0",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "prompts/system.md",
        prompts: {
          registry: "steps_registry.json",
          fallbackDir: "prompts/",
        },
      },
      completion: {
        type: "externalState",
        config: {
          maxIterations: 10,
        },
      },
      boundaries: {
        allowedTools: ["Bash", "Read"],
        permissionMode: "default",
        github: {
          enabled: true,
          labels: {},
          defaultClosureAction: "label-only",
        },
      },
      execution: {},
      telemetry: {
        logging: {
          directory: "/tmp/claude/test-logs",
          format: "jsonl",
        },
      },
    },
  };

  try {
    await createRegistryCompletionHandler(
      definition,
      {},
      "/tmp/claude/test-agent",
    );
    throw new Error("Should have thrown");
  } catch (error) {
    assertEquals(
      (error as Error).message.includes("requires --issue"),
      true,
    );
  }
});

Deno.test("createRegistryCompletionHandler - iterationBudget creates handler", async () => {
  const definition: AgentDefinition = {
    name: "test-agent",
    displayName: "Test",
    description: "Test",
    version: "1.0.0",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "prompts/system.md",
        prompts: {
          registry: "steps_registry.json",
          fallbackDir: "prompts/",
        },
      },
      completion: {
        type: "iterationBudget",
        config: {
          maxIterations: 5,
        },
      },
      boundaries: {
        allowedTools: ["Bash", "Read"],
        permissionMode: "default",
        github: {
          enabled: true,
          labels: {},
          defaultClosureAction: "label-only",
        },
      },
      execution: {},
      telemetry: {
        logging: {
          directory: "/tmp/claude/test-logs",
          format: "jsonl",
        },
      },
    },
  };

  const result = await createRegistryCompletionHandler(
    definition,
    {},
    "/tmp/claude/test-agent",
  );

  assertExists(result);
  assertEquals(result.type, "iterationBudget");
});

// =============================================================================
// ExternalStateCompletionAdapter Tests
// =============================================================================

Deno.test("ExternalStateCompletionAdapter - isComplete bridges refreshState and check", async () => {
  const mockChecker = new MockStateChecker();
  mockChecker.setIssueState(42, true);

  const issueHandler = new IssueCompletionHandler(
    { issueNumber: 42 },
    mockChecker,
  );
  const adapter = new ExternalStateCompletionAdapter(issueHandler, {
    issueNumber: 42,
  });

  const complete = await adapter.isComplete();
  assertEquals(complete, true);
});

Deno.test("ExternalStateCompletionAdapter - isComplete returns false for open issue", async () => {
  const mockChecker = new MockStateChecker();
  // Issue 42 defaults to open (closed: false)

  const issueHandler = new IssueCompletionHandler(
    { issueNumber: 42 },
    mockChecker,
  );
  const adapter = new ExternalStateCompletionAdapter(issueHandler, {
    issueNumber: 42,
  });

  const complete = await adapter.isComplete();
  assertEquals(complete, false);
});

Deno.test("ExternalStateCompletionAdapter - buildCompletionCriteria maps fields", () => {
  const mockChecker = new MockStateChecker();
  const issueHandler = new IssueCompletionHandler(
    { issueNumber: 77 },
    mockChecker,
  );
  const adapter = new ExternalStateCompletionAdapter(issueHandler, {
    issueNumber: 77,
  });

  const criteria = adapter.buildCompletionCriteria();
  assertExists(criteria.short);
  assertExists(criteria.detailed);
  assertEquals(criteria.short.includes("77"), true);
  assertEquals(criteria.detailed.includes("77"), true);
});

Deno.test("ExternalStateCompletionAdapter - getCompletionDescription when complete", async () => {
  const mockChecker = new MockStateChecker();
  mockChecker.setIssueState(99, true);

  const issueHandler = new IssueCompletionHandler(
    { issueNumber: 99 },
    mockChecker,
  );
  const adapter = new ExternalStateCompletionAdapter(issueHandler, {
    issueNumber: 99,
  });

  // Populate cached state via isComplete (which calls refreshState + check)
  await adapter.isComplete();

  const desc = await adapter.getCompletionDescription();
  assertEquals(desc.includes("99"), true);
  assertEquals(desc.includes("closed"), true);
});

Deno.test("ExternalStateCompletionAdapter - getCompletionDescription when not complete", async () => {
  const mockChecker = new MockStateChecker();
  // Issue 99 defaults to open

  const issueHandler = new IssueCompletionHandler(
    { issueNumber: 99 },
    mockChecker,
  );
  const adapter = new ExternalStateCompletionAdapter(issueHandler, {
    issueNumber: 99,
  });

  const desc = await adapter.getCompletionDescription();
  assertEquals(desc.includes("Waiting"), true);
});

Deno.test("ExternalStateCompletionAdapter - buildInitialPrompt fallback", async () => {
  const mockChecker = new MockStateChecker();
  const issueHandler = new IssueCompletionHandler(
    { issueNumber: 55 },
    mockChecker,
  );
  // No promptResolver set - should fall back to handler.buildPrompt
  const adapter = new ExternalStateCompletionAdapter(issueHandler, {
    issueNumber: 55,
  });

  const prompt = await adapter.buildInitialPrompt();
  assertEquals(prompt.includes("55"), true);
});

Deno.test("ExternalStateCompletionAdapter - buildContinuationPrompt fallback", async () => {
  const mockChecker = new MockStateChecker();
  const issueHandler = new IssueCompletionHandler(
    { issueNumber: 55 },
    mockChecker,
  );
  // No promptResolver set - should fall back to handler.buildPrompt
  const adapter = new ExternalStateCompletionAdapter(issueHandler, {
    issueNumber: 55,
  });

  const prompt = await adapter.buildContinuationPrompt(3);
  assertEquals(prompt.includes("55"), true);
});

Deno.test("ExternalStateCompletionAdapter - type is externalState", () => {
  const mockChecker = new MockStateChecker();
  const issueHandler = new IssueCompletionHandler(
    { issueNumber: 1 },
    mockChecker,
  );
  const adapter = new ExternalStateCompletionAdapter(issueHandler, {
    issueNumber: 1,
  });

  assertEquals(adapter.type, "externalState");
});

// =============================================================================
// Composite with externalState Tests
// =============================================================================

Deno.test("CompositeCompletionHandler - externalState condition with issue", async () => {
  const definition = createMockAgentDefinition({
    completion: {
      type: "composite",
      config: {
        operator: "or",
        conditions: [
          { type: "externalState", config: { maxIterations: 10 } },
          { type: "iterationBudget", config: { maxIterations: 1 } },
        ],
      },
    },
  });

  const handler = new CompositeCompletionHandler(
    "or",
    definition.runner.completion.config.conditions ?? [],
    { issue: 42 },
    "/test",
    definition,
  );

  // The externalState handler uses GitHubStateChecker which will fail gracefully
  // (returns closed: false). Set the iterationBudget handler's iteration to 1
  // to make it complete.
  // @ts-ignore - accessing private for testing
  const iterateHandler = handler.handlers[1] as IterateCompletionHandler;
  iterateHandler.setCurrentIteration(1);

  const complete = await handler.isComplete();
  assertEquals(complete, true);
});
