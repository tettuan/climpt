/**
 * Verdict Handler Tests
 *
 * Tests for the completion module including:
 * - Factory functions
 * - IssueVerdictHandler (contract-compliant)
 * - CompositeVerdictHandler (AND/OR logic)
 * - IterationBudgetVerdictHandler
 * - KeywordSignalVerdictHandler
 * - CheckBudgetVerdictHandler
 * - StructuredSignalVerdictHandler
 * - MockStateChecker
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { createRegistryVerdictHandler } from "./factory.ts";

const logger = new BreakdownLogger("handler");
import { ExternalStateVerdictAdapter } from "./external-state-adapter.ts";
import { IssueVerdictHandler } from "./issue.ts";
import { CompositeVerdictHandler } from "./composite.ts";
import { IterationBudgetVerdictHandler } from "./iteration-budget.ts";
import { KeywordSignalVerdictHandler } from "./keyword-signal.ts";
import { CheckBudgetVerdictHandler } from "./check-budget.ts";
import { StructuredSignalVerdictHandler } from "./structured-signal.ts";
import { MockStateChecker } from "./external-state-checker.ts";
import { StepMachineVerdictHandler } from "./step-machine.ts";
import type { IterationSummary } from "./types.ts";
import type { AgentDefinition } from "../src_common/types.ts";
import type { ExtendedStepsRegistry } from "../common/validation-types.ts";

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
 * the runner.verdict fields, not the full definition.
 */
function createMockAgentDefinition(
  overrides: {
    verdict?: Partial<AgentDefinition["runner"]["verdict"]>;
  } = {},
): AgentDefinition {
  const baseVerdict = {
    type: "iterationBudget" as const,
    config: {
      maxIterations: 10,
    },
  };

  const verdict = overrides.verdict
    ? { ...baseVerdict, ...overrides.verdict }
    : baseVerdict;

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
      verdict,
      boundaries: {
        allowedTools: ["Bash", "Read", "Write"],
        permissionMode: "plan",
      },
      execution: {},
      logging: { directory: "/tmp/claude/test-logs", format: "jsonl" },
    },
  } as AgentDefinition;
}

// =============================================================================
// IssueVerdictHandler Tests
// =============================================================================

Deno.test("IssueVerdictHandler - check without cached state returns incomplete", () => {
  const mockChecker = new MockStateChecker();
  const handler = new IssueVerdictHandler(
    { issueNumber: 123 },
    mockChecker,
  );

  const result = handler.check({ iteration: 1 });
  assertEquals(result.complete, false);
});

Deno.test("IssueVerdictHandler - check with cached open state returns incomplete", async () => {
  const mockChecker = new MockStateChecker();
  mockChecker.setIssueState(123, false);

  const handler = new IssueVerdictHandler(
    { issueNumber: 123 },
    mockChecker,
  );

  await handler.forceRefreshState();
  const result = handler.check({ iteration: 1 });
  assertEquals(result.complete, false);
});

Deno.test("IssueVerdictHandler - check with cached closed state returns complete", async () => {
  const mockChecker = new MockStateChecker();
  mockChecker.setIssueState(123, true);

  const handler = new IssueVerdictHandler(
    { issueNumber: 123 },
    mockChecker,
  );

  await handler.forceRefreshState();
  logger.debug("handler check input", { iteration: 1, issueNumber: 123 });
  const result = handler.check({ iteration: 1 });
  logger.debug("handler check result", {
    complete: result.complete,
    reason: result.reason,
  });
  assertEquals(result.complete, true);
  assertEquals(result.reason?.includes("123"), true);
});

Deno.test("IssueVerdictHandler - refreshState respects interval", async () => {
  const mockChecker = new MockStateChecker();
  mockChecker.setIssueState(123, false);

  const handler = new IssueVerdictHandler(
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

Deno.test("IssueVerdictHandler - forceRefreshState ignores interval", async () => {
  const mockChecker = new MockStateChecker();
  mockChecker.setIssueState(123, false);

  const handler = new IssueVerdictHandler(
    { issueNumber: 123, checkInterval: 60000 },
    mockChecker,
  );

  await handler.forceRefreshState();

  mockChecker.setIssueState(123, true);
  await handler.forceRefreshState();

  const result = handler.check({ iteration: 1 });
  assertEquals(result.complete, true);
});

Deno.test("IssueVerdictHandler - buildPrompt initial phase", () => {
  const mockChecker = new MockStateChecker();
  const handler = new IssueVerdictHandler(
    { issueNumber: 456 },
    mockChecker,
  );

  const prompt = handler.buildPrompt("initial", 1);
  assertEquals(prompt.includes("456"), true);
});

Deno.test("IssueVerdictHandler - buildPrompt continuation phase", () => {
  const mockChecker = new MockStateChecker();
  const handler = new IssueVerdictHandler(
    { issueNumber: 456 },
    mockChecker,
  );

  const prompt = handler.buildPrompt("continuation", 5);
  assertEquals(prompt.includes("456"), true);
  assertEquals(prompt.includes("5"), true);
});

Deno.test("IssueVerdictHandler - getVerdictCriteria", () => {
  const mockChecker = new MockStateChecker();
  const handler = new IssueVerdictHandler(
    { issueNumber: 789, repo: "test/repo" },
    mockChecker,
  );

  const criteria = handler.getVerdictCriteria();
  assertEquals(criteria.summary.includes("789"), true);
  assertEquals(criteria.detailed.includes("test/repo"), true);
});

Deno.test("IssueVerdictHandler - getVerdictCriteria with label-only", () => {
  const handler = new IssueVerdictHandler(
    { issueNumber: 42, closureAction: "label-only" },
    new MockStateChecker(),
  );
  const criteria = handler.getVerdictCriteria();
  assertEquals(criteria.summary, "Phase complete for Issue #42");
  assertStringIncludes(criteria.detailed, "Do NOT close");
  assertStringIncludes(criteria.detailed, "#42");
});

Deno.test("IssueVerdictHandler - getVerdictCriteria with label-and-close", () => {
  const handler = new IssueVerdictHandler(
    { issueNumber: 42, closureAction: "label-and-close" },
    new MockStateChecker(),
  );
  const criteria = handler.getVerdictCriteria();
  assertEquals(criteria.summary, "Issue #42 labeled and closed");
  assertStringIncludes(criteria.detailed, "close");
});

Deno.test("IssueVerdictHandler - getVerdictCriteria with close (explicit)", () => {
  const handler = new IssueVerdictHandler(
    { issueNumber: 42, closureAction: "close" },
    new MockStateChecker(),
  );
  const criteria = handler.getVerdictCriteria();
  assertEquals(criteria.summary, "Issue #42 closed");
  assertStringIncludes(criteria.detailed, "closed");
});

Deno.test("IssueVerdictHandler - getVerdictCriteria default (no closureAction)", () => {
  const handler = new IssueVerdictHandler(
    { issueNumber: 42 },
    new MockStateChecker(),
  );
  const criteria = handler.getVerdictCriteria();
  assertEquals(criteria.summary, "Issue #42 closed");
  assertStringIncludes(criteria.detailed, "closed");
});

Deno.test("IssueVerdictHandler - transition always returns closure", () => {
  const mockChecker = new MockStateChecker();
  const handler = new IssueVerdictHandler(
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

Deno.test("IssueVerdictHandler - getCachedState returns undefined initially", () => {
  const mockChecker = new MockStateChecker();
  const handler = new IssueVerdictHandler(
    { issueNumber: 123 },
    mockChecker,
  );

  assertEquals(handler.getCachedState(), undefined);
});

// =============================================================================
// CompositeVerdictHandler Tests
// =============================================================================

Deno.test("CompositeVerdictHandler - AND logic - all incomplete", async () => {
  const definition = createMockAgentDefinition({
    verdict: {
      type: "composite",
      config: {
        operator: "and",
        conditions: [
          { type: "iterationBudget", config: { maxIterations: 10 } },
          { type: "keywordSignal", config: { verdictKeyword: "DONE" } },
        ],
      },
    },
  });

  const conditions = definition.runner.verdict.config.conditions ?? [];
  const handler = new CompositeVerdictHandler(
    "and",
    conditions,
    {},
    "/test",
    definition,
  );

  const complete = await handler.isFinished();
  assertEquals(complete, false);
});

Deno.test("CompositeVerdictHandler - OR logic - one complete", async () => {
  const definition = createMockAgentDefinition({
    verdict: {
      type: "composite",
      config: {
        operator: "or",
        conditions: [
          { type: "iterationBudget", config: { maxIterations: 1 } },
          { type: "keywordSignal", config: { verdictKeyword: "DONE" } },
        ],
      },
    },
  });

  const handler = new CompositeVerdictHandler(
    "or",
    definition.runner.verdict.config.conditions ?? [],
    {},
    "/test",
    definition,
  );

  // Access internal handlers to set iteration count
  // @ts-ignore - accessing private for testing
  const iterateHandler = handler.handlers[0] as IterationBudgetVerdictHandler;
  iterateHandler.setCurrentIteration(1);

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

Deno.test("CompositeVerdictHandler - FIRST logic - tracks completed index", async () => {
  const definition = createMockAgentDefinition({
    verdict: {
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

  const handler = new CompositeVerdictHandler(
    "first",
    definition.runner.verdict.config.conditions ?? [],
    {},
    "/test",
    definition,
  );

  // Set second handler to complete
  // @ts-ignore - accessing private for testing
  const secondHandler = handler.handlers[1] as IterationBudgetVerdictHandler;
  secondHandler.setCurrentIteration(1);

  const complete = await handler.isFinished();
  assertEquals(complete, true);

  const desc = await handler.getVerdictDescription();
  assertEquals(desc.includes("condition 2"), true);
});

Deno.test("CompositeVerdictHandler - buildVerdictCriteria combines handlers", () => {
  const definition = createMockAgentDefinition({
    verdict: {
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

  const handler = new CompositeVerdictHandler(
    "and",
    definition.runner.verdict.config.conditions ?? [],
    {},
    "/test",
    definition,
  );

  const criteria = handler.buildVerdictCriteria();
  assertEquals(criteria.short.includes("AND"), true);
});

Deno.test("CompositeVerdictHandler - buildInitialPrompt uses first handler", async () => {
  const definition = createMockAgentDefinition({
    verdict: {
      type: "composite",
      config: {
        operator: "or",
        conditions: [
          { type: "iterationBudget", config: { maxIterations: 5 } },
        ],
      },
    },
  });

  const handler = new CompositeVerdictHandler(
    "or",
    definition.runner.verdict.config.conditions ?? [],
    {},
    "/test",
    definition,
  );

  const prompt = await handler.buildInitialPrompt();
  assertEquals(prompt.includes("iteration"), true);
});

Deno.test("CompositeVerdictHandler - throws on unsupported condition type", () => {
  const definition = createMockAgentDefinition();

  try {
    new CompositeVerdictHandler(
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
// IterationBudgetVerdictHandler Tests
// =============================================================================

Deno.test("IterationBudgetVerdictHandler - initialization", () => {
  const handler = new IterationBudgetVerdictHandler(100);

  assertEquals(handler.type, "iterationBudget");
});

Deno.test("IterationBudgetVerdictHandler - isFinishedbefore max", async () => {
  const handler = new IterationBudgetVerdictHandler(10);
  handler.setCurrentIteration(5);

  const complete = await handler.isFinished();
  assertEquals(complete, false);
});

Deno.test("IterationBudgetVerdictHandler - isFinishedat max", async () => {
  const handler = new IterationBudgetVerdictHandler(10);
  handler.setCurrentIteration(10);

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

Deno.test("IterationBudgetVerdictHandler - isFinishedafter max", async () => {
  const handler = new IterationBudgetVerdictHandler(10);
  handler.setCurrentIteration(15);

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

Deno.test("IterationBudgetVerdictHandler - buildVerdictCriteria", () => {
  const handler = new IterationBudgetVerdictHandler(25);
  const criteria = handler.buildVerdictCriteria();

  assertEquals(criteria.short, "25 iterations");
  assertEquals(criteria.detailed.includes("25"), true);
});

Deno.test("IterationBudgetVerdictHandler - getVerdictDescription", async () => {
  const handler = new IterationBudgetVerdictHandler(20);
  handler.setCurrentIteration(7);

  const desc = await handler.getVerdictDescription();
  assertEquals(desc.includes("7"), true);
  assertEquals(desc.includes("20"), true);
});

Deno.test("IterationBudgetVerdictHandler - buildInitialPrompt", async () => {
  const handler = new IterationBudgetVerdictHandler(50);
  const prompt = await handler.buildInitialPrompt();

  assertEquals(prompt.includes("50"), true);
  assertEquals(prompt.includes("iteration"), true);
});

Deno.test("IterationBudgetVerdictHandler - buildContinuationPrompt updates iteration", async () => {
  const handler = new IterationBudgetVerdictHandler(30);
  const prompt = await handler.buildContinuationPrompt(15);

  assertEquals(prompt.includes("15"), true);
  assertEquals(prompt.includes("30"), true);
  assertEquals(prompt.includes("15"), true); // remaining
});

// =============================================================================
// KeywordSignalVerdictHandler Tests
// =============================================================================

Deno.test("KeywordSignalVerdictHandler - initialization", () => {
  const handler = new KeywordSignalVerdictHandler("TASK_COMPLETE");

  assertEquals(handler.type, "keywordSignal");
});

Deno.test("KeywordSignalVerdictHandler - isFinishedwithout summary", async () => {
  const handler = new KeywordSignalVerdictHandler("DONE");

  const complete = await handler.isFinished();
  assertEquals(complete, false);
});

Deno.test("KeywordSignalVerdictHandler - isFinishedwith keyword in response", async () => {
  const handler = new KeywordSignalVerdictHandler("FINISHED");

  // Build continuation prompt stores the summary
  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      assistantResponses: ["Work completed. FINISHED"],
    }),
  );

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

Deno.test("KeywordSignalVerdictHandler - isFinishedwithout keyword", async () => {
  const handler = new KeywordSignalVerdictHandler("COMPLETE");

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      assistantResponses: ["Still working on it..."],
    }),
  );

  const complete = await handler.isFinished();
  assertEquals(complete, false);
});

Deno.test("KeywordSignalVerdictHandler - buildVerdictCriteria", () => {
  const handler = new KeywordSignalVerdictHandler("MY_KEYWORD");
  const criteria = handler.buildVerdictCriteria();

  assertEquals(criteria.short.includes("MY_KEYWORD"), true);
  assertEquals(criteria.detailed.includes("MY_KEYWORD"), true);
});

Deno.test("KeywordSignalVerdictHandler - getVerdictDescription when complete", async () => {
  const handler = new KeywordSignalVerdictHandler("DONE");

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      assistantResponses: ["Task is DONE"],
    }),
  );

  const desc = await handler.getVerdictDescription();
  assertEquals(desc.includes("detected"), true);
});

Deno.test("KeywordSignalVerdictHandler - getVerdictDescription when waiting", async () => {
  const handler = new KeywordSignalVerdictHandler("DONE");

  const desc = await handler.getVerdictDescription();
  assertEquals(desc.includes("Waiting"), true);
});

// =============================================================================
// CheckBudgetVerdictHandler Tests
// =============================================================================

Deno.test("CheckBudgetVerdictHandler - initialization", () => {
  const handler = new CheckBudgetVerdictHandler(10);

  assertEquals(handler.type, "checkBudget");
  assertEquals(handler.getCheckCount(), 0);
});

Deno.test("CheckBudgetVerdictHandler - incrementCheckCount", () => {
  const handler = new CheckBudgetVerdictHandler(5);

  handler.incrementCheckCount();
  assertEquals(handler.getCheckCount(), 1);

  handler.incrementCheckCount();
  handler.incrementCheckCount();
  assertEquals(handler.getCheckCount(), 3);
});

Deno.test("CheckBudgetVerdictHandler - isFinishedbefore max", async () => {
  const handler = new CheckBudgetVerdictHandler(10);

  handler.incrementCheckCount();
  handler.incrementCheckCount();

  const complete = await handler.isFinished();
  assertEquals(complete, false);
});

Deno.test("CheckBudgetVerdictHandler - isFinishedat max", async () => {
  const handler = new CheckBudgetVerdictHandler(3);

  handler.incrementCheckCount();
  handler.incrementCheckCount();
  handler.incrementCheckCount();

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

Deno.test("CheckBudgetVerdictHandler - buildVerdictCriteria", () => {
  const handler = new CheckBudgetVerdictHandler(15);
  const criteria = handler.buildVerdictCriteria();

  assertEquals(criteria.short, "15 checks");
  assertEquals(criteria.detailed.includes("15"), true);
});

Deno.test("CheckBudgetVerdictHandler - buildContinuationPrompt increments count", async () => {
  const handler = new CheckBudgetVerdictHandler(10);

  assertEquals(handler.getCheckCount(), 0);

  await handler.buildContinuationPrompt(1);
  assertEquals(handler.getCheckCount(), 1);

  await handler.buildContinuationPrompt(2);
  assertEquals(handler.getCheckCount(), 2);
});

Deno.test("CheckBudgetVerdictHandler - getVerdictDescription", async () => {
  const handler = new CheckBudgetVerdictHandler(5);

  handler.incrementCheckCount();
  handler.incrementCheckCount();

  const desc = await handler.getVerdictDescription();
  assertEquals(desc.includes("2"), true);
  assertEquals(desc.includes("5"), true);
});

// =============================================================================
// StructuredSignalVerdictHandler Tests
// =============================================================================

Deno.test("StructuredSignalVerdictHandler - initialization", () => {
  const handler = new StructuredSignalVerdictHandler("complete-signal");

  assertEquals(handler.type, "structuredSignal");
});

Deno.test("StructuredSignalVerdictHandler - isFinishedwithout summary", async () => {
  const handler = new StructuredSignalVerdictHandler("done");

  const complete = await handler.isFinished();
  assertEquals(complete, false);
});

Deno.test("StructuredSignalVerdictHandler - isFinishedwith matching signal type", async () => {
  const handler = new StructuredSignalVerdictHandler("task-complete");

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      structuredOutput: { signal: "task-complete", result: "done" },
    }),
  );

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

Deno.test("StructuredSignalVerdictHandler - isFinishedwithout matching signal", async () => {
  const handler = new StructuredSignalVerdictHandler("my-signal");

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      structuredOutput: { signal: "other-signal", data: "value" },
    }),
  );

  const complete = await handler.isFinished();
  assertEquals(complete, false);
});

Deno.test("StructuredSignalVerdictHandler - isFinishedwith status=completed", async () => {
  const handler = new StructuredSignalVerdictHandler("complete");

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      structuredOutput: { status: "completed", summary: "Task done" },
    }),
  );

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

Deno.test("StructuredSignalVerdictHandler - isFinishedwith required fields match", async () => {
  const handler = new StructuredSignalVerdictHandler("complete", {
    status: "success",
    code: 0,
  });

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      structuredOutput: { signal: "complete", status: "success", code: 0 },
    }),
  );

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

Deno.test("StructuredSignalVerdictHandler - isFinishedwith required fields mismatch", async () => {
  const handler = new StructuredSignalVerdictHandler("complete", {
    status: "success",
  });

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      structuredOutput: { signal: "complete", status: "failure" },
    }),
  );

  const complete = await handler.isFinished();
  assertEquals(complete, false);
});

Deno.test("StructuredSignalVerdictHandler - buildVerdictCriteria without fields", () => {
  const handler = new StructuredSignalVerdictHandler("done-signal");
  const criteria = handler.buildVerdictCriteria();

  assertEquals(criteria.short.includes("done-signal"), true);
});

Deno.test("StructuredSignalVerdictHandler - buildVerdictCriteria with fields", () => {
  const handler = new StructuredSignalVerdictHandler("done-signal", {
    status: "ok",
  });
  const criteria = handler.buildVerdictCriteria();

  assertEquals(criteria.detailed.includes("status"), true);
});

Deno.test("StructuredSignalVerdictHandler - getVerdictDescription", async () => {
  const handler = new StructuredSignalVerdictHandler("test-signal");

  let desc = await handler.getVerdictDescription();
  assertEquals(desc.includes("Waiting"), true);

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      structuredOutput: { signal: "test-signal" },
    }),
  );

  desc = await handler.getVerdictDescription();
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
// StepMachineVerdictHandler Tests
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

Deno.test("StepMachineVerdictHandler - initialization", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  assertEquals(handler.type, "stepMachine");

  const state = handler.getState();
  assertEquals(state.currentStepId, "initial.test");
  assertEquals(state.stepIteration, 0);
  assertEquals(state.totalIterations, 0);
  assertEquals(state.retryCount, 0);
  assertEquals(state.isComplete, false);
});

Deno.test("StepMachineVerdictHandler - initialization with entry step", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(
    registry,
    "continuation.test",
  );

  const state = handler.getState();
  assertEquals(state.currentStepId, "continuation.test");
});

Deno.test("StepMachineVerdictHandler - getStepContext returns context", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  const context = handler.getStepContext();
  assertExists(context);
  assertExists(context.outputs);
});

Deno.test("StepMachineVerdictHandler - recordStepOutput stores data", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  handler.recordStepOutput("step1", { result: "success", value: 42 });

  const context = handler.getStepContext();
  assertEquals(context.get("step1", "result"), "success");
  assertEquals(context.get("step1", "value"), 42);
});

Deno.test("StepMachineVerdictHandler - getNextStep initial to continuation", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  const transition = handler.getNextStep({
    stepId: "initial.test",
    passed: true,
  });

  assertEquals(transition.nextStep, "continuation.test");
  assertEquals(transition.passed, true);
});

Deno.test("StepMachineVerdictHandler - getNextStep single step to complete", () => {
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
  const handler = new StepMachineVerdictHandler(registry, "initial.single");

  const transition = handler.getNextStep({
    stepId: "initial.single",
    passed: true,
  });

  assertEquals(transition.nextStep, "closure");
});

Deno.test("StepMachineVerdictHandler - transition updates state", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  const nextStep = handler.transition({
    stepId: "initial.test",
    passed: true,
  });

  assertEquals(nextStep, "continuation.test");

  const state = handler.getState();
  assertEquals(state.currentStepId, "continuation.test");
  assertEquals(state.retryCount, 0);
});

Deno.test("StepMachineVerdictHandler - transition to complete", () => {
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
  const handler = new StepMachineVerdictHandler(registry, "initial.only");

  const nextStep = handler.transition({
    stepId: "initial.only",
    passed: true,
  });

  assertEquals(nextStep, "closure");

  const state = handler.getState();
  assertEquals(state.isComplete, true);
  assertExists(state.verdictReason);
});

Deno.test("StepMachineVerdictHandler - isFinishedfalse initially", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  const complete = await handler.isFinished();
  assertEquals(complete, false);
});

Deno.test("StepMachineVerdictHandler - isFinishedtrue after transition to complete", async () => {
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
  const handler = new StepMachineVerdictHandler(registry, "initial.final");

  handler.transition({ stepId: "initial.final", passed: true });

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

Deno.test("StepMachineVerdictHandler - isFinishedwith structured output status=completed", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  const summary = createMockIterationSummary({
    structuredOutput: { status: "completed" },
  });
  handler.setCurrentSummary(summary);

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

Deno.test("StepMachineVerdictHandler - isFinishedwith next_action.action=complete", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  const summary = createMockIterationSummary({
    structuredOutput: { next_action: { action: "complete", reason: "done" } },
  });
  handler.setCurrentSummary(summary);

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

Deno.test("StepMachineVerdictHandler - buildVerdictCriteria", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  const criteria = handler.buildVerdictCriteria();

  assertEquals(criteria.short.includes("Step machine"), true);
  assertEquals(criteria.detailed.includes("initial.test"), true);
});

Deno.test("StepMachineVerdictHandler - buildInitialPrompt", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  const prompt = await handler.buildInitialPrompt();

  assertEquals(prompt.includes("initial.test"), true);
});

Deno.test("StepMachineVerdictHandler - buildContinuationPrompt updates state", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  await handler.buildContinuationPrompt(5);

  const state = handler.getState();
  assertEquals(state.totalIterations, 5);
  assertEquals(state.stepIteration, 1);
});

Deno.test("StepMachineVerdictHandler - getVerdictDescription not complete", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  const desc = await handler.getVerdictDescription();

  assertEquals(desc.includes("initial.test"), true);
  assertEquals(desc.includes("Step"), true);
});

Deno.test("StepMachineVerdictHandler - getVerdictDescription when complete", async () => {
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
  const handler = new StepMachineVerdictHandler(registry, "initial.end");

  handler.transition({ stepId: "initial.end", passed: true });

  const desc = await handler.getVerdictDescription();

  // Description should indicate completion via transition
  assertEquals(
    desc.includes("Transition") ||
      desc.includes("complete") ||
      desc.includes("intent"),
    true,
  );
});

Deno.test("StepMachineVerdictHandler - step context toUV converts outputs", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

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
// createRegistryVerdictHandler Tests
// =============================================================================

Deno.test("createRegistryVerdictHandler - externalState with args.issue returns adapter", async () => {
  logger.debug("factory input", { type: "externalState", issue: 123 });
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
      verdict: {
        type: "externalState",
        config: { maxIterations: 10 },
      },
      boundaries: {
        allowedTools: ["Bash", "Read"],
        permissionMode: "default",
      },
      integrations: {
        github: {
          enabled: true,
          labels: {},
          defaultClosureAction: "label-only",
        },
      },
      execution: {},
      logging: { directory: "/tmp/claude/test-logs", format: "jsonl" },
    },
  };

  const result = await createRegistryVerdictHandler(
    definition,
    { issue: 123, repository: "owner/repo" },
    "/tmp/claude/test-agent",
  );
  logger.debug("factory result", { type: result?.type });

  assertExists(result);
  assertEquals(result.type, "externalState");
  // Verify it's an ExternalStateVerdictAdapter by checking adapter-specific method
  assertEquals(
    typeof (result as ExternalStateVerdictAdapter).buildInitialPrompt,
    "function",
  );
  assertEquals(result instanceof ExternalStateVerdictAdapter, true);
});

Deno.test("createRegistryVerdictHandler - externalState without args.issue throws", async () => {
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
      verdict: {
        type: "externalState",
        config: {
          maxIterations: 10,
        },
      },
      boundaries: {
        allowedTools: ["Bash", "Read"],
        permissionMode: "default",
      },
      integrations: {
        github: {
          enabled: true,
          labels: {},
          defaultClosureAction: "label-only",
        },
      },
      execution: {},
      logging: {
        directory: "/tmp/claude/test-logs",
        format: "jsonl",
      },
    },
  };

  try {
    await createRegistryVerdictHandler(
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

Deno.test("createRegistryVerdictHandler - iterationBudget creates handler", async () => {
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
      verdict: {
        type: "iterationBudget",
        config: {
          maxIterations: 5,
        },
      },
      boundaries: {
        allowedTools: ["Bash", "Read"],
        permissionMode: "default",
      },
      integrations: {
        github: {
          enabled: true,
          labels: {},
          defaultClosureAction: "label-only",
        },
      },
      execution: {},
      logging: {
        directory: "/tmp/claude/test-logs",
        format: "jsonl",
      },
    },
  };

  const result = await createRegistryVerdictHandler(
    definition,
    {},
    "/tmp/claude/test-agent",
  );

  assertExists(result);
  assertEquals(result.type, "iterationBudget");
});

// =============================================================================
// ExternalStateVerdictAdapter Tests
// =============================================================================

Deno.test("ExternalStateVerdictAdapter - isFinishedbridges refreshState and check", async () => {
  const mockChecker = new MockStateChecker();
  mockChecker.setIssueState(42, true);

  const issueHandler = new IssueVerdictHandler(
    { issueNumber: 42 },
    mockChecker,
  );
  const adapter = new ExternalStateVerdictAdapter(issueHandler, {
    issueNumber: 42,
  });

  const complete = await adapter.isFinished();
  assertEquals(complete, true);
});

Deno.test("ExternalStateVerdictAdapter - isFinishedreturns false for open issue", async () => {
  const mockChecker = new MockStateChecker();
  // Issue 42 defaults to open (closed: false)

  const issueHandler = new IssueVerdictHandler(
    { issueNumber: 42 },
    mockChecker,
  );
  const adapter = new ExternalStateVerdictAdapter(issueHandler, {
    issueNumber: 42,
  });

  const complete = await adapter.isFinished();
  assertEquals(complete, false);
});

Deno.test("ExternalStateVerdictAdapter - buildVerdictCriteria maps fields", () => {
  const mockChecker = new MockStateChecker();
  const issueHandler = new IssueVerdictHandler(
    { issueNumber: 77 },
    mockChecker,
  );
  const adapter = new ExternalStateVerdictAdapter(issueHandler, {
    issueNumber: 77,
  });

  const criteria = adapter.buildVerdictCriteria();
  assertExists(criteria.short);
  assertExists(criteria.detailed);
  assertEquals(criteria.short.includes("77"), true);
  assertEquals(criteria.detailed.includes("77"), true);
});

Deno.test("ExternalStateVerdictAdapter - getVerdictDescription when complete", async () => {
  const mockChecker = new MockStateChecker();
  mockChecker.setIssueState(99, true);

  const issueHandler = new IssueVerdictHandler(
    { issueNumber: 99 },
    mockChecker,
  );
  const adapter = new ExternalStateVerdictAdapter(issueHandler, {
    issueNumber: 99,
  });

  // Populate cached state via isFinished (which calls refreshState + check)
  await adapter.isFinished();

  const desc = await adapter.getVerdictDescription();
  assertEquals(desc.includes("99"), true);
  assertEquals(desc.includes("closed"), true);
});

Deno.test("ExternalStateVerdictAdapter - getVerdictDescription when not complete", async () => {
  const mockChecker = new MockStateChecker();
  // Issue 99 defaults to open

  const issueHandler = new IssueVerdictHandler(
    { issueNumber: 99 },
    mockChecker,
  );
  const adapter = new ExternalStateVerdictAdapter(issueHandler, {
    issueNumber: 99,
  });

  const desc = await adapter.getVerdictDescription();
  assertEquals(desc.includes("Waiting"), true);
});

Deno.test("ExternalStateVerdictAdapter - buildInitialPrompt fallback", async () => {
  const mockChecker = new MockStateChecker();
  const issueHandler = new IssueVerdictHandler(
    { issueNumber: 55 },
    mockChecker,
  );
  // No promptResolver set - should fall back to handler.buildPrompt
  const adapter = new ExternalStateVerdictAdapter(issueHandler, {
    issueNumber: 55,
  });

  const prompt = await adapter.buildInitialPrompt();
  assertEquals(prompt.includes("55"), true);
});

Deno.test("ExternalStateVerdictAdapter - buildContinuationPrompt fallback", async () => {
  const mockChecker = new MockStateChecker();
  const issueHandler = new IssueVerdictHandler(
    { issueNumber: 55 },
    mockChecker,
  );
  // No promptResolver set - should fall back to handler.buildPrompt
  const adapter = new ExternalStateVerdictAdapter(issueHandler, {
    issueNumber: 55,
  });

  const prompt = await adapter.buildContinuationPrompt(3);
  assertEquals(prompt.includes("55"), true);
});

Deno.test("ExternalStateVerdictAdapter - type is externalState", () => {
  const mockChecker = new MockStateChecker();
  const issueHandler = new IssueVerdictHandler(
    { issueNumber: 1 },
    mockChecker,
  );
  const adapter = new ExternalStateVerdictAdapter(issueHandler, {
    issueNumber: 1,
  });

  assertEquals(adapter.type, "externalState");
});

// =============================================================================
// PromptResolver Integration Tests
// =============================================================================

const STEP_ID_PATTERN = /^(initial|continuation|closure)\.[a-zA-Z]+$/;

class MockPromptResolver {
  readonly calls: Array<{
    stepId: string;
    variables: Record<string, string>;
  }> = [];

  async resolve(
    stepId: string,
    variables: Record<string, string>,
  ): Promise<string> {
    this.calls.push({ stepId, variables });
    return `RICH_PROMPT_CONTENT_FOR_${stepId}`;
  }

  lastStepId(): string | undefined {
    return this.calls[this.calls.length - 1]?.stepId;
  }

  reset(): void {
    this.calls.length = 0;
  }
}

// --- ExternalStateVerdictAdapter + resolver ---

Deno.test("ExternalStateVerdictAdapter + resolver - buildInitialPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const adapter = new ExternalStateVerdictAdapter(
    new IssueVerdictHandler({ issueNumber: 1 }, new MockStateChecker()),
    { issueNumber: 1 },
  );
  adapter.setPromptResolver(
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter,
  );

  const prompt = await adapter.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.externalState");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(prompt, "RICH_PROMPT_CONTENT_FOR_initial.externalState");
});

Deno.test("ExternalStateVerdictAdapter + resolver - buildContinuationPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const adapter = new ExternalStateVerdictAdapter(
    new IssueVerdictHandler({ issueNumber: 1 }, new MockStateChecker()),
    { issueNumber: 1 },
  );
  adapter.setPromptResolver(
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter,
  );

  const prompt = await adapter.buildContinuationPrompt(3);

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "continuation.externalState");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(
    prompt,
    "RICH_PROMPT_CONTENT_FOR_continuation.externalState",
  );
});

// --- IterationBudgetVerdictHandler + resolver ---

Deno.test("IterationBudgetVerdictHandler + resolver - buildInitialPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new IterationBudgetVerdictHandler(10);
  handler.setPromptResolver(
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter,
  );

  const prompt = await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.iterate");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(prompt, "RICH_PROMPT_CONTENT_FOR_initial.iterate");
});

Deno.test("IterationBudgetVerdictHandler + resolver - buildContinuationPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new IterationBudgetVerdictHandler(10);
  handler.setPromptResolver(
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter,
  );

  const prompt = await handler.buildContinuationPrompt(5);

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "continuation.iterate");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(
    prompt,
    "RICH_PROMPT_CONTENT_FOR_continuation.iterate",
  );
});

// --- CheckBudgetVerdictHandler + resolver ---

Deno.test("CheckBudgetVerdictHandler + resolver - buildInitialPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new CheckBudgetVerdictHandler(5);
  handler.setPromptResolver(
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter,
  );

  const prompt = await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.checkBudget");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(prompt, "RICH_PROMPT_CONTENT_FOR_initial.checkBudget");
});

Deno.test("CheckBudgetVerdictHandler + resolver - buildContinuationPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new CheckBudgetVerdictHandler(5);
  handler.setPromptResolver(
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter,
  );

  const prompt = await handler.buildContinuationPrompt(2);

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "continuation.checkBudget");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(
    prompt,
    "RICH_PROMPT_CONTENT_FOR_continuation.checkBudget",
  );
});

// --- KeywordSignalVerdictHandler + resolver ---

Deno.test("KeywordSignalVerdictHandler + resolver - buildInitialPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new KeywordSignalVerdictHandler("DONE");
  handler.setPromptResolver(
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter,
  );

  const prompt = await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.manual");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(prompt, "RICH_PROMPT_CONTENT_FOR_initial.manual");
});

Deno.test("KeywordSignalVerdictHandler + resolver - buildContinuationPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new KeywordSignalVerdictHandler("DONE");
  handler.setPromptResolver(
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter,
  );

  const prompt = await handler.buildContinuationPrompt(2);

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "continuation.manual");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(
    prompt,
    "RICH_PROMPT_CONTENT_FOR_continuation.manual",
  );
});

// --- StructuredSignalVerdictHandler + resolver ---

Deno.test("StructuredSignalVerdictHandler + resolver - buildInitialPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new StructuredSignalVerdictHandler("complete");
  handler.setPromptResolver(
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter,
  );

  const prompt = await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.structuredSignal");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(
    prompt,
    "RICH_PROMPT_CONTENT_FOR_initial.structuredSignal",
  );
});

Deno.test("StructuredSignalVerdictHandler + resolver - buildContinuationPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new StructuredSignalVerdictHandler("complete");
  handler.setPromptResolver(
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter,
  );

  const prompt = await handler.buildContinuationPrompt(3);

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "continuation.structuredSignal");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(
    prompt,
    "RICH_PROMPT_CONTENT_FOR_continuation.structuredSignal",
  );
});

// --- StepMachineVerdictHandler + resolver ---

Deno.test("StepMachineVerdictHandler + resolver - buildInitialPrompt resolves via currentStepId", async () => {
  const mock = new MockPromptResolver();
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);
  handler.setPromptResolver(
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter,
  );

  const prompt = await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.test");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(prompt, "RICH_PROMPT_CONTENT_FOR_initial.test");
});

Deno.test("StepMachineVerdictHandler + resolver - buildContinuationPrompt resolves via currentStepId", async () => {
  const mock = new MockPromptResolver();
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);
  handler.setPromptResolver(
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter,
  );

  const prompt = await handler.buildContinuationPrompt(2);

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.test");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(prompt, "RICH_PROMPT_CONTENT_FOR_initial.test");
});

Deno.test("StepMachineVerdictHandler + resolver - stepId changes after transition", async () => {
  const mock = new MockPromptResolver();
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);
  handler.setPromptResolver(
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter,
  );

  handler.transition({ stepId: "initial.test", passed: true });

  const prompt = await handler.buildContinuationPrompt(2);

  assertEquals(mock.lastStepId(), "continuation.test");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(
    prompt,
    "RICH_PROMPT_CONTENT_FOR_continuation.test",
  );
});

// --- CompositeVerdictHandler + resolver ---

Deno.test("CompositeVerdictHandler + resolver - propagates resolver to sub-handlers", async () => {
  const mock = new MockPromptResolver();
  const definition = createMockAgentDefinition({
    verdict: {
      type: "composite",
      config: {
        operator: "or",
        conditions: [
          { type: "iterationBudget", config: { maxIterations: 5 } },
          { type: "keywordSignal", config: { verdictKeyword: "DONE" } },
        ],
      },
    },
  });

  const handler = new CompositeVerdictHandler(
    "or",
    definition.runner.verdict.config.conditions ?? [],
    {},
    "/test",
    definition,
  );
  handler.setPromptResolver(
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter,
  );

  const prompt = await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.iterate");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(prompt, "RICH_PROMPT_CONTENT_FOR_initial.iterate");
});

// --- Contract: all handler stepIds match dot-format ---

Deno.test("Contract - all handler stepIds use dot-format (phase.type)", async () => {
  const mock = new MockPromptResolver();
  const cast =
    mock as unknown as import("../prompts/resolver-adapter.ts").PromptResolverAdapter;

  const handlers: Array<{
    name: string;
    handler: {
      setPromptResolver: (r: typeof cast) => void;
      buildInitialPrompt: () => Promise<string>;
      buildContinuationPrompt: (n: number) => Promise<string>;
    };
  }> = [
    {
      name: "ExternalStateVerdictAdapter",
      handler: new ExternalStateVerdictAdapter(
        new IssueVerdictHandler({ issueNumber: 1 }, new MockStateChecker()),
        { issueNumber: 1 },
      ),
    },
    {
      name: "IterationBudgetVerdictHandler",
      handler: new IterationBudgetVerdictHandler(5),
    },
    {
      name: "CheckBudgetVerdictHandler",
      handler: new CheckBudgetVerdictHandler(5),
    },
    {
      name: "KeywordSignalVerdictHandler",
      handler: new KeywordSignalVerdictHandler("DONE"),
    },
    {
      name: "StructuredSignalVerdictHandler",
      handler: new StructuredSignalVerdictHandler("sig"),
    },
  ];

  for (const { name, handler } of handlers) {
    mock.reset();
    handler.setPromptResolver(cast);

    await handler.buildInitialPrompt();
    const initialId = mock.lastStepId()!;
    assertEquals(
      STEP_ID_PATTERN.test(initialId),
      true,
      `${name} initial stepId "${initialId}" does not match pattern`,
    );

    mock.reset();
    await handler.buildContinuationPrompt(1);
    const contId = mock.lastStepId()!;
    assertEquals(
      STEP_ID_PATTERN.test(contId),
      true,
      `${name} continuation stepId "${contId}" does not match pattern`,
    );
  }
});

// =============================================================================
// Composite with externalState Tests
// =============================================================================

Deno.test("CompositeVerdictHandler - externalState condition with issue", async () => {
  const definition = createMockAgentDefinition({
    verdict: {
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

  const handler = new CompositeVerdictHandler(
    "or",
    definition.runner.verdict.config.conditions ?? [],
    { issue: 42 },
    "/test",
    definition,
  );

  // The externalState handler uses GitHubStateChecker which will fail gracefully
  // (returns closed: false). Set the iterationBudget handler's iteration to 1
  // to make it complete.
  // @ts-ignore - accessing private for testing
  const iterateHandler = handler.handlers[1] as IterationBudgetVerdictHandler;
  iterateHandler.setCurrentIteration(1);

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});
