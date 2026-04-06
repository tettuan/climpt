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
import type { IterationSummary, VerdictStepIds } from "./types.ts";
import type { AgentDefinition } from "../src_common/types.ts";
import type { ExtendedStepsRegistry } from "../common/validation-types.ts";
import type { PromptResolver } from "../common/prompt-resolver.ts";
import type { PromptResolutionResult } from "../common/prompt-resolver.ts";

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
    type: "count:iteration" as const,
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
  assertStringIncludes(result.reason ?? "", "123");
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
  assertStringIncludes(prompt, "456");
});

Deno.test("IssueVerdictHandler - buildPrompt continuation phase", () => {
  const mockChecker = new MockStateChecker();
  const handler = new IssueVerdictHandler(
    { issueNumber: 456 },
    mockChecker,
  );

  const prompt = handler.buildPrompt("continuation", 5);
  assertStringIncludes(prompt, "456");
  assertStringIncludes(prompt, "5");
});

Deno.test("IssueVerdictHandler - getVerdictCriteria", () => {
  const mockChecker = new MockStateChecker();
  const handler = new IssueVerdictHandler(
    { issueNumber: 789, repo: "test/repo" },
    mockChecker,
  );

  const criteria = handler.getVerdictCriteria();
  assertStringIncludes(criteria.summary, "789");
  assertStringIncludes(criteria.detailed, "test/repo");
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
      type: "meta:composite",
      config: {
        operator: "and",
        conditions: [
          { type: "count:iteration", config: { maxIterations: 10 } },
          { type: "detect:keyword", config: { verdictKeyword: "DONE" } },
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
      type: "meta:composite",
      config: {
        operator: "or",
        conditions: [
          { type: "count:iteration", config: { maxIterations: 1 } },
          { type: "detect:keyword", config: { verdictKeyword: "DONE" } },
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
      type: "meta:composite",
      config: {
        operator: "first",
        conditions: [
          { type: "count:iteration", config: { maxIterations: 10 } },
          { type: "count:iteration", config: { maxIterations: 1 } },
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
  assertStringIncludes(desc, "condition 2");
});

Deno.test("CompositeVerdictHandler - buildVerdictCriteria combines handlers", () => {
  const definition = createMockAgentDefinition({
    verdict: {
      type: "meta:composite",
      config: {
        operator: "and",
        conditions: [
          { type: "count:iteration", config: { maxIterations: 5 } },
          { type: "count:iteration", config: { maxIterations: 10 } },
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
  assertStringIncludes(criteria.short, "AND");
});

Deno.test("CompositeVerdictHandler - buildInitialPrompt uses first handler", async () => {
  const definition = createMockAgentDefinition({
    verdict: {
      type: "meta:composite",
      config: {
        operator: "or",
        conditions: [
          { type: "count:iteration", config: { maxIterations: 5 } },
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
  assertStringIncludes(prompt, "iteration");
});

Deno.test("CompositeVerdictHandler - throws on unsupported condition type", () => {
  const definition = createMockAgentDefinition();

  try {
    new CompositeVerdictHandler(
      "and",
      // deno-lint-ignore no-explicit-any
      [{ type: "meta:custom" as any, config: {} }],
      {},
      "/test",
      definition,
    );
    throw new Error("Should have thrown");
  } catch (error) {
    assertStringIncludes((error as Error).message, "Unsupported");
  }
});

Deno.test("CompositeVerdictHandler - stepIds propagation to sub-handlers", () => {
  const customStepIds: VerdictStepIds = {
    initial: "initial.custom",
    continuation: "continuation.custom",
  };

  const definition = createMockAgentDefinition({
    verdict: {
      type: "meta:composite",
      config: {
        operator: "and",
        conditions: [
          { type: "count:iteration", config: { maxIterations: 5 } },
          { type: "detect:keyword", config: { verdictKeyword: "DONE" } },
          { type: "count:check", config: { maxChecks: 3 } },
          { type: "detect:structured", config: { signalType: "test-signal" } },
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
    customStepIds,
  );

  // Access internal handlers to verify stepIds propagation
  // @ts-ignore - accessing private for testing
  const handlers = handler.handlers;
  assertEquals(handlers.length, 4);

  // Each handler should have received the custom stepIds
  for (const h of handlers) {
    // @ts-ignore - accessing private stepIds
    const ids = h.stepIds;
    assertEquals(
      ids.initial,
      "initial.custom",
      `${h.type} should receive custom initial stepId`,
    );
    assertEquals(
      ids.continuation,
      "continuation.custom",
      `${h.type} should receive custom continuation stepId`,
    );
  }
});

// =============================================================================
// IterationBudgetVerdictHandler Tests
// =============================================================================

Deno.test("IterationBudgetVerdictHandler - initialization", () => {
  const handler = new IterationBudgetVerdictHandler(100);

  assertEquals(handler.type, "count:iteration");
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
  assertStringIncludes(criteria.detailed, "25");
});

Deno.test("IterationBudgetVerdictHandler - getVerdictDescription", async () => {
  const handler = new IterationBudgetVerdictHandler(20);
  handler.setCurrentIteration(7);

  const desc = await handler.getVerdictDescription();
  assertStringIncludes(desc, "7");
  assertStringIncludes(desc, "20");
});

Deno.test("IterationBudgetVerdictHandler - buildInitialPrompt", async () => {
  const handler = new IterationBudgetVerdictHandler(50);
  const prompt = await handler.buildInitialPrompt();

  assertStringIncludes(prompt, "50");
  assertStringIncludes(prompt, "iteration");
});

Deno.test("IterationBudgetVerdictHandler - buildContinuationPrompt updates iteration", async () => {
  const handler = new IterationBudgetVerdictHandler(30);
  const prompt = await handler.buildContinuationPrompt(15);

  assertStringIncludes(prompt, "15");
  assertStringIncludes(prompt, "30");
  assertStringIncludes(prompt, "15"); // remaining
});

// =============================================================================
// KeywordSignalVerdictHandler Tests
// =============================================================================

Deno.test("KeywordSignalVerdictHandler - initialization", () => {
  const handler = new KeywordSignalVerdictHandler("TASK_COMPLETE");

  assertEquals(handler.type, "detect:keyword");
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

  assertStringIncludes(criteria.short, "MY_KEYWORD");
  assertStringIncludes(criteria.detailed, "MY_KEYWORD");
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
  assertStringIncludes(desc, "detected");
});

Deno.test("KeywordSignalVerdictHandler - getVerdictDescription when waiting", async () => {
  const handler = new KeywordSignalVerdictHandler("DONE");

  const desc = await handler.getVerdictDescription();
  assertStringIncludes(desc, "Waiting");
});

// =============================================================================
// CheckBudgetVerdictHandler Tests
// =============================================================================

Deno.test("CheckBudgetVerdictHandler - initialization", () => {
  const handler = new CheckBudgetVerdictHandler(10);

  assertEquals(handler.type, "count:check");
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
  assertStringIncludes(criteria.detailed, "15");
});

Deno.test("CheckBudgetVerdictHandler - buildContinuationPrompt does NOT increment count", async () => {
  const handler = new CheckBudgetVerdictHandler(10);

  assertEquals(handler.getCheckCount(), 0);

  await handler.buildContinuationPrompt(1);
  assertEquals(handler.getCheckCount(), 0);

  await handler.buildContinuationPrompt(2);
  assertEquals(handler.getCheckCount(), 0);
});

Deno.test("CheckBudgetVerdictHandler - getVerdictDescription", async () => {
  const handler = new CheckBudgetVerdictHandler(5);

  handler.incrementCheckCount();
  handler.incrementCheckCount();

  const desc = await handler.getVerdictDescription();
  assertStringIncludes(desc, "2");
  assertStringIncludes(desc, "5");
});

// =============================================================================
// IterationBudgetVerdictHandler - setCurrentSummary Tests
// =============================================================================

Deno.test("IterationBudgetVerdictHandler - setCurrentSummary stores summary", () => {
  const handler = new IterationBudgetVerdictHandler(10);
  const summary = createMockIterationSummary({ iteration: 3 });

  // Should not throw
  handler.setCurrentSummary(summary);
});

// =============================================================================
// CheckBudgetVerdictHandler - setCurrentSummary Tests
// =============================================================================

Deno.test("CheckBudgetVerdictHandler - setCurrentSummary stores summary and increments checkCount", () => {
  const handler = new CheckBudgetVerdictHandler(10);

  assertEquals(handler.getCheckCount(), 0);

  const summary1 = createMockIterationSummary({ iteration: 1 });
  handler.setCurrentSummary(summary1);
  assertEquals(handler.getCheckCount(), 1);

  const summary2 = createMockIterationSummary({ iteration: 2 });
  handler.setCurrentSummary(summary2);
  assertEquals(handler.getCheckCount(), 2);
});

Deno.test("CheckBudgetVerdictHandler - checkCount increments via setCurrentSummary not buildContinuationPrompt", async () => {
  const handler = new CheckBudgetVerdictHandler(10);

  assertEquals(handler.getCheckCount(), 0);

  // buildContinuationPrompt alone should NOT increment
  await handler.buildContinuationPrompt(1);
  assertEquals(handler.getCheckCount(), 0);

  // setCurrentSummary SHOULD increment
  const summary = createMockIterationSummary({ iteration: 1 });
  handler.setCurrentSummary(summary);
  assertEquals(handler.getCheckCount(), 1);

  // Another buildContinuationPrompt should still NOT increment
  await handler.buildContinuationPrompt(2);
  assertEquals(handler.getCheckCount(), 1);
});

Deno.test("CheckBudgetVerdictHandler - isFinished after setCurrentSummary reaches max", async () => {
  const handler = new CheckBudgetVerdictHandler(2);

  handler.setCurrentSummary(createMockIterationSummary({ iteration: 1 }));
  assertEquals(await handler.isFinished(), false);

  handler.setCurrentSummary(createMockIterationSummary({ iteration: 2 }));
  assertEquals(await handler.isFinished(), true);
});

// =============================================================================
// StructuredSignalVerdictHandler Tests
// =============================================================================

Deno.test("StructuredSignalVerdictHandler - initialization", () => {
  const handler = new StructuredSignalVerdictHandler("complete-signal");

  assertEquals(handler.type, "detect:structured");
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

  assertStringIncludes(criteria.short, "done-signal");
});

Deno.test("StructuredSignalVerdictHandler - buildVerdictCriteria with fields", () => {
  const handler = new StructuredSignalVerdictHandler("done-signal", {
    status: "ok",
  });
  const criteria = handler.buildVerdictCriteria();

  assertStringIncludes(criteria.detailed, "status");
});

Deno.test("StructuredSignalVerdictHandler - getVerdictDescription", async () => {
  const handler = new StructuredSignalVerdictHandler("test-signal");

  let desc = await handler.getVerdictDescription();
  assertStringIncludes(desc, "Waiting");

  await handler.buildContinuationPrompt(
    1,
    createMockIterationSummary({
      structuredOutput: { signal: "test-signal" },
    }),
  );

  desc = await handler.getVerdictDescription();
  assertStringIncludes(desc, "detected");
});

// =============================================================================
// StructuredSignalVerdictHandler - Path 2 (code fence parsing) Tests
// =============================================================================

Deno.test("StructuredSignalVerdictHandler - Path 2 - code fence signal without required fields → COMPLETE", async () => {
  const handler = new StructuredSignalVerdictHandler("task-done");

  handler.setCurrentSummary(
    createMockIterationSummary({
      structuredOutput: undefined,
      assistantResponses: [
        'Here is my result:\n```task-done\n{"status": "ok"}\n```\nDone.',
      ],
    }),
  );

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

Deno.test("StructuredSignalVerdictHandler - Path 2 - code fence signal with matching required fields → COMPLETE", async () => {
  const handler = new StructuredSignalVerdictHandler("review", {
    status: "approved",
  });

  handler.setCurrentSummary(
    createMockIterationSummary({
      structuredOutput: undefined,
      assistantResponses: [
        '```review\n{"status": "approved", "notes": "LGTM"}\n```',
      ],
    }),
  );

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

Deno.test("StructuredSignalVerdictHandler - Path 2 - code fence signal with mismatched required fields → INCOMPLETE", async () => {
  const handler = new StructuredSignalVerdictHandler("review", {
    status: "approved",
  });

  handler.setCurrentSummary(
    createMockIterationSummary({
      structuredOutput: undefined,
      assistantResponses: [
        '```review\n{"status": "rejected"}\n```',
      ],
    }),
  );

  const complete = await handler.isFinished();
  assertEquals(complete, false);
});

Deno.test("StructuredSignalVerdictHandler - Path 2 - code fence signal with unparseable JSON, no required fields → COMPLETE", async () => {
  const handler = new StructuredSignalVerdictHandler("done");

  handler.setCurrentSummary(
    createMockIterationSummary({
      structuredOutput: undefined,
      assistantResponses: [
        "```done\nnot valid json\n```",
      ],
    }),
  );

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

Deno.test("StructuredSignalVerdictHandler - Path 2 - code fence signal with unparseable JSON, with required fields → INCOMPLETE", async () => {
  const handler = new StructuredSignalVerdictHandler("done", {
    status: "ok",
  });

  handler.setCurrentSummary(
    createMockIterationSummary({
      structuredOutput: undefined,
      assistantResponses: [
        "```done\nnot valid json\n```",
      ],
    }),
  );

  const complete = await handler.isFinished();
  assertEquals(complete, false);
});

Deno.test("StructuredSignalVerdictHandler - Path 2 - no code fence in responses → INCOMPLETE", async () => {
  const handler = new StructuredSignalVerdictHandler("my-signal");

  handler.setCurrentSummary(
    createMockIterationSummary({
      structuredOutput: undefined,
      assistantResponses: ["no signal here"],
    }),
  );

  const complete = await handler.isFinished();
  assertEquals(complete, false);
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

  assertEquals(handler.type, "detect:graph");

  const state = handler.getState();
  assertEquals(state.currentStepId, "initial.test");
  assertEquals(state.stepIteration, 0);
  assertEquals(state.totalIterations, 0);
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

Deno.test("StepMachineVerdictHandler - isFinishedfalse initially", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  const complete = await handler.isFinished();
  assertEquals(complete, false);
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

Deno.test("StepMachineVerdictHandler - isFinished rejects next_action.action=complete", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  const summary = createMockIterationSummary({
    structuredOutput: { next_action: { action: "complete", reason: "done" } },
  });
  handler.setCurrentSummary(summary);

  const complete = await handler.isFinished();
  assertEquals(complete, false);
});

Deno.test("StepMachineVerdictHandler - buildVerdictCriteria", () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  const criteria = handler.buildVerdictCriteria();

  assertStringIncludes(criteria.short, "Step machine");
  assertStringIncludes(criteria.detailed, "initial.test");
});

Deno.test("StepMachineVerdictHandler - buildInitialPrompt", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  const prompt = await handler.buildInitialPrompt();

  assertStringIncludes(prompt, "initial.test");
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

  assertStringIncludes(desc, "initial.test");
  assertStringIncludes(desc, "Step");
});

Deno.test("StepMachineVerdictHandler - getVerdictDescription when complete via structured output", async () => {
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);

  const summary = createMockIterationSummary({
    structuredOutput: { status: "completed" },
  });
  handler.setCurrentSummary(summary);

  const desc = await handler.getVerdictDescription();

  // Description should indicate AI declared completion
  assertEquals(
    desc.includes("completion") || desc.includes("complete"),
    true,
  );
});

// =============================================================================
// createRegistryVerdictHandler Tests
// =============================================================================

Deno.test("createRegistryVerdictHandler - poll:state with args.issue returns adapter", async () => {
  logger.debug("factory input", { type: "poll:state", issue: 123 });
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
        type: "poll:state",
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
  assertEquals(result.type, "poll:state");
  // Verify it's an ExternalStateVerdictAdapter by checking adapter-specific method
  assertEquals(
    typeof (result as ExternalStateVerdictAdapter).buildInitialPrompt,
    "function",
  );
  assertEquals(result instanceof ExternalStateVerdictAdapter, true);
});

Deno.test("createRegistryVerdictHandler - poll:state without args.issue throws", async () => {
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
        type: "poll:state",
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
      (error as Error).message.includes("AC-VERDICT-001"),
      true,
    );
  }
});

Deno.test("createRegistryVerdictHandler - count:iteration creates handler", async () => {
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
        type: "count:iteration",
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
  assertEquals(result.type, "count:iteration");
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
  assertStringIncludes(criteria.short, "77");
  assertStringIncludes(criteria.detailed, "77");
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
  assertStringIncludes(desc, "99");
  assertStringIncludes(desc, "closed");
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
  assertStringIncludes(desc, "Waiting");
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
  assertStringIncludes(prompt, "55");
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
  assertStringIncludes(prompt, "55");
});

Deno.test("ExternalStateVerdictAdapter - type is poll:state", () => {
  const mockChecker = new MockStateChecker();
  const issueHandler = new IssueVerdictHandler(
    { issueNumber: 1 },
    mockChecker,
  );
  const adapter = new ExternalStateVerdictAdapter(issueHandler, {
    issueNumber: 1,
  });

  assertEquals(adapter.type, "poll:state");
});

// =============================================================================
// PromptResolver Integration Tests
// =============================================================================

const STEP_ID_PATTERN = /^(initial|continuation|closure)\.[a-zA-Z]+$/;

class MockPromptResolver {
  readonly calls: Array<{
    stepId: string;
    variables?: import("../common/prompt-resolver.ts").PromptVariables;
  }> = [];

  async resolve(
    stepId: string,
    variables?: import("../common/prompt-resolver.ts").PromptVariables,
  ): Promise<PromptResolutionResult> {
    this.calls.push({ stepId, variables });
    return {
      content: `RICH_PROMPT_CONTENT_FOR_${stepId}`,
      stepId,
      source: "user",
    };
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
    mock as unknown as PromptResolver,
  );

  const prompt = await adapter.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.polling");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(prompt, "RICH_PROMPT_CONTENT_FOR_initial.polling");
});

Deno.test("ExternalStateVerdictAdapter + resolver - buildContinuationPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const adapter = new ExternalStateVerdictAdapter(
    new IssueVerdictHandler({ issueNumber: 1 }, new MockStateChecker()),
    { issueNumber: 1 },
  );
  adapter.setPromptResolver(
    mock as unknown as PromptResolver,
  );

  const prompt = await adapter.buildContinuationPrompt(3);

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "continuation.polling");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(
    prompt,
    "RICH_PROMPT_CONTENT_FOR_continuation.polling",
  );
});

// --- IterationBudgetVerdictHandler + resolver ---

Deno.test("IterationBudgetVerdictHandler + resolver - buildInitialPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new IterationBudgetVerdictHandler(10);
  handler.setPromptResolver(
    mock as unknown as PromptResolver,
  );

  const prompt = await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.iteration");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(prompt, "RICH_PROMPT_CONTENT_FOR_initial.iteration");
});

Deno.test("IterationBudgetVerdictHandler + resolver - buildContinuationPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new IterationBudgetVerdictHandler(10);
  handler.setPromptResolver(
    mock as unknown as PromptResolver,
  );

  const prompt = await handler.buildContinuationPrompt(5);

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "continuation.iteration");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(
    prompt,
    "RICH_PROMPT_CONTENT_FOR_continuation.iteration",
  );
});

// --- CheckBudgetVerdictHandler + resolver ---

Deno.test("CheckBudgetVerdictHandler + resolver - buildInitialPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new CheckBudgetVerdictHandler(5);
  handler.setPromptResolver(
    mock as unknown as PromptResolver,
  );

  const prompt = await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.check");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(prompt, "RICH_PROMPT_CONTENT_FOR_initial.check");
});

Deno.test("CheckBudgetVerdictHandler + resolver - buildContinuationPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new CheckBudgetVerdictHandler(5);
  handler.setPromptResolver(
    mock as unknown as PromptResolver,
  );

  const prompt = await handler.buildContinuationPrompt(2);

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "continuation.check");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(
    prompt,
    "RICH_PROMPT_CONTENT_FOR_continuation.check",
  );
});

// --- KeywordSignalVerdictHandler + resolver ---

Deno.test("KeywordSignalVerdictHandler + resolver - buildInitialPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new KeywordSignalVerdictHandler("DONE");
  handler.setPromptResolver(
    mock as unknown as PromptResolver,
  );

  const prompt = await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.keyword");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(prompt, "RICH_PROMPT_CONTENT_FOR_initial.keyword");
});

Deno.test("KeywordSignalVerdictHandler + resolver - buildContinuationPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new KeywordSignalVerdictHandler("DONE");
  handler.setPromptResolver(
    mock as unknown as PromptResolver,
  );

  const prompt = await handler.buildContinuationPrompt(2);

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "continuation.keyword");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(
    prompt,
    "RICH_PROMPT_CONTENT_FOR_continuation.keyword",
  );
});

// --- StructuredSignalVerdictHandler + resolver ---

Deno.test("StructuredSignalVerdictHandler + resolver - buildInitialPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new StructuredSignalVerdictHandler("complete");
  handler.setPromptResolver(
    mock as unknown as PromptResolver,
  );

  const prompt = await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.structured");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(
    prompt,
    "RICH_PROMPT_CONTENT_FOR_initial.structured",
  );
});

Deno.test("StructuredSignalVerdictHandler + resolver - buildContinuationPrompt uses dot-format stepId", async () => {
  const mock = new MockPromptResolver();
  const handler = new StructuredSignalVerdictHandler("complete");
  handler.setPromptResolver(
    mock as unknown as PromptResolver,
  );

  const prompt = await handler.buildContinuationPrompt(3);

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "continuation.structured");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(
    prompt,
    "RICH_PROMPT_CONTENT_FOR_continuation.structured",
  );
});

// --- StepMachineVerdictHandler + resolver ---

Deno.test("StepMachineVerdictHandler + resolver - buildInitialPrompt resolves via currentStepId", async () => {
  const mock = new MockPromptResolver();
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(registry);
  handler.setPromptResolver(
    mock as unknown as PromptResolver,
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
    mock as unknown as PromptResolver,
  );

  const prompt = await handler.buildContinuationPrompt(2);

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.test");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(prompt, "RICH_PROMPT_CONTENT_FOR_initial.test");
});

Deno.test("StepMachineVerdictHandler + resolver - entryStep determines initial stepId", async () => {
  const mock = new MockPromptResolver();
  const registry = createMockStepsRegistry();
  const handler = new StepMachineVerdictHandler(
    registry,
    "continuation.test",
  );
  handler.setPromptResolver(
    mock as unknown as PromptResolver,
  );

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
      type: "meta:composite",
      config: {
        operator: "or",
        conditions: [
          { type: "count:iteration", config: { maxIterations: 5 } },
          { type: "detect:keyword", config: { verdictKeyword: "DONE" } },
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
    mock as unknown as PromptResolver,
  );

  const prompt = await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.iteration");
  assertEquals(STEP_ID_PATTERN.test(mock.lastStepId()!), true);
  assertStringIncludes(prompt, "RICH_PROMPT_CONTENT_FOR_initial.iteration");
});

Deno.test("CompositeVerdictHandler - stepIds propagate to sub-handlers", async () => {
  const mock = new MockPromptResolver();
  const customStepIds: VerdictStepIds = {
    initial: "initial.custom",
    continuation: "continuation.custom",
  };
  const definition = createMockAgentDefinition({
    verdict: {
      type: "meta:composite",
      config: {
        operator: "or",
        conditions: [
          { type: "count:iteration", config: { maxIterations: 5 } },
          { type: "detect:keyword", config: { verdictKeyword: "DONE" } },
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
    customStepIds,
  );
  handler.setPromptResolver(mock as unknown as PromptResolver);

  // buildInitialPrompt delegates to the first sub-handler (IterationBudget)
  const prompt = await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "initial.custom");
  assertStringIncludes(prompt, "RICH_PROMPT_CONTENT_FOR_initial.custom");

  // Verify continuation also uses the custom stepId
  mock.reset();
  const contPrompt = await handler.buildContinuationPrompt(2);

  assertEquals(mock.calls.length, 1);
  assertEquals(mock.lastStepId(), "continuation.custom");
  assertStringIncludes(
    contPrompt,
    "RICH_PROMPT_CONTENT_FOR_continuation.custom",
  );
});

// --- Contract: all handler stepIds match dot-format ---

Deno.test("Contract - all handler stepIds use dot-format (phase.type)", async () => {
  const mock = new MockPromptResolver();
  const cast = mock as unknown as PromptResolver;

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
// Composite with poll:state Tests
// =============================================================================

Deno.test("CompositeVerdictHandler - poll:state condition with issue", async () => {
  const definition = createMockAgentDefinition({
    verdict: {
      type: "meta:composite",
      config: {
        operator: "or",
        conditions: [
          { type: "poll:state", config: { maxIterations: 10 } },
          { type: "count:iteration", config: { maxIterations: 1 } },
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

  // The poll:state handler uses GitHubStateChecker which will fail gracefully
  // (returns closed: false). Set the count:iteration handler's iteration to 1
  // to make it complete.
  // @ts-ignore - accessing private for testing
  const iterateHandler = handler.handlers[1] as IterationBudgetVerdictHandler;
  iterateHandler.setCurrentIteration(1);

  const complete = await handler.isFinished();
  assertEquals(complete, true);
});

// =============================================================================
// setUvVariables Tests
// =============================================================================

Deno.test("setUvVariables - base UV variables appear in resolved prompt", async () => {
  const mock = new MockPromptResolver();
  const handler = new IterationBudgetVerdictHandler(5);
  handler.setPromptResolver(mock as unknown as PromptResolver);

  handler.setUvVariables({ issue: "42", repository: "owner/repo" });
  await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  const passedUv = mock.calls[0].variables?.uv;
  assertEquals(passedUv?.issue, "42");
  assertEquals(passedUv?.repository, "owner/repo");
  // Handler-specific UV should also be present
  assertEquals(passedUv?.max_iterations, "5");
});

Deno.test("setUvVariables - handler-specific UV takes precedence over base UV", async () => {
  const mock = new MockPromptResolver();
  const handler = new KeywordSignalVerdictHandler("DONE");
  handler.setPromptResolver(mock as unknown as PromptResolver);

  // Set base UV with a completion_keyword value that should be overridden
  handler.setUvVariables({
    issue: "42",
    completion_keyword: "SHOULD_BE_OVERRIDDEN",
  });
  await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  const passedUv = mock.calls[0].variables?.uv;
  // Base UV should appear
  assertEquals(passedUv?.issue, "42");
  // Handler-specific completion_keyword must override base UV
  assertEquals(passedUv?.completion_keyword, "DONE");
});

Deno.test("setUvVariables - existing behavior preserved when setUvVariables not called", async () => {
  const mock = new MockPromptResolver();
  const handler = new IterationBudgetVerdictHandler(3);
  handler.setPromptResolver(mock as unknown as PromptResolver);

  // Do NOT call setUvVariables — default empty should not break anything
  await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  const passedUv = mock.calls[0].variables?.uv;
  assertEquals(passedUv?.max_iterations, "3");
  // No base UV should be present
  assertEquals(passedUv?.issue, undefined);
});

Deno.test("setUvVariables - continuation prompt also receives base UV", async () => {
  const mock = new MockPromptResolver();
  const handler = new CheckBudgetVerdictHandler(10);
  handler.setPromptResolver(mock as unknown as PromptResolver);

  handler.setUvVariables({ issue: "99" });
  await handler.buildContinuationPrompt(2);

  assertEquals(mock.calls.length, 1);
  const passedUv = mock.calls[0].variables?.uv;
  assertEquals(passedUv?.issue, "99");
  assertEquals(passedUv?.max_checks, "10");
});

Deno.test("setUvVariables - ExternalStateVerdictAdapter config issue overrides base UV issue", async () => {
  const mock = new MockPromptResolver();
  const adapter = new ExternalStateVerdictAdapter(
    new IssueVerdictHandler({ issueNumber: 100 }, new MockStateChecker()),
    { issueNumber: 100 },
  );
  adapter.setPromptResolver(mock as unknown as PromptResolver);

  // Base UV has issue=42 from CLI, but config.issueNumber=100 must win
  adapter.setUvVariables({ issue: "42", iteration: "1" });
  await adapter.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  const passedUv = mock.calls[0].variables?.uv;
  // Config-derived issue must take precedence over base UV
  assertEquals(passedUv?.issue, "100");
  // Base UV should still be present for non-conflicting keys
  assertEquals(passedUv?.iteration, "1");
});

Deno.test("setUvVariables - CompositeVerdictHandler forwards to sub-handlers", async () => {
  const definition = createMockAgentDefinition({
    verdict: {
      type: "meta:composite",
      config: {
        operator: "or",
        conditions: [
          { type: "count:iteration", config: { maxIterations: 5 } },
          { type: "detect:keyword", config: { verdictKeyword: "DONE" } },
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

  const mock = new MockPromptResolver();
  handler.setPromptResolver(mock as unknown as PromptResolver);
  handler.setUvVariables({ issue: "77" });

  // Build initial prompt uses first sub-handler
  await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  const passedUv = mock.calls[0].variables?.uv;
  // Base UV should have been forwarded to sub-handler
  assertEquals(passedUv?.issue, "77");
});

Deno.test("setUvVariables - StepMachineVerdictHandler merges base UV in initial prompt", async () => {
  const registry: ExtendedStepsRegistry = {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    entryStep: "work.analyze",
    steps: {
      "work.analyze": {
        name: "Analyze",
        stepId: "work.analyze",
        c2: "work",
        c3: "analyze",
        edition: "default",
        fallbackKey: "work.analyze",
        uvVariables: [],
        usesStdin: false,
      },
    },
  };

  const mock = new MockPromptResolver();
  const handler = new StepMachineVerdictHandler(registry, "work.analyze");
  handler.setPromptResolver(mock as unknown as PromptResolver);

  handler.setUvVariables({ issue: "55", repository: "org/repo" });
  await handler.buildInitialPrompt();

  assertEquals(mock.calls.length, 1);
  const passedUv = mock.calls[0].variables?.uv;
  assertEquals(passedUv?.issue, "55");
  assertEquals(passedUv?.repository, "org/repo");
  // Handler-specific UV should also be present
  assertEquals(passedUv?.step_id, "work.analyze");
  assertEquals(passedUv?.step_name, "Analyze");
});

Deno.test("setUvVariables - StructuredSignalVerdictHandler merges base UV", async () => {
  const mock = new MockPromptResolver();
  const handler = new StructuredSignalVerdictHandler("completion_signal");
  handler.setPromptResolver(mock as unknown as PromptResolver);

  handler.setUvVariables({ issue: "33" });
  await handler.buildContinuationPrompt(2);

  assertEquals(mock.calls.length, 1);
  const passedUv = mock.calls[0].variables?.uv;
  assertEquals(passedUv?.issue, "33");
  assertEquals(passedUv?.signal_type, "completion_signal");
  assertEquals(passedUv?.iteration, "2");
});
