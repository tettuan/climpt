/**
 * Runner Loop Integration Tests
 *
 * Tests 3 high-risk behaviors of AgentRunner.run() by injecting fake
 * dependencies (logger, verdictHandler, promptResolver factories) and
 * replacing QueryExecutor.executeQuery with a stub that returns
 * controlled IterationSummary objects.
 *
 * The closureManager.initializeValidation is overridden to install a
 * minimal stepsRegistry so FlowOrchestrator can resolve entry steps
 * without hitting the filesystem.
 *
 * Scenarios tested:
 * 1. pendingRetryPrompt: validation failure sets retry prompt, next iteration uses it
 * 2. schema-resolution skip: schemaResolutionFailed short-circuits routing/schema
 * 3. max-iteration breach: exceeding maxIterations emits AgentMaxIterationsError
 */

import { assertEquals, assertExists } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";

import { AgentRunner } from "./runner.ts";
import { AgentMaxIterationsError } from "./errors.ts";
import type { AgentDependencies } from "./builder.ts";
import type {
  IterationSummary,
  ResolvedAgentDefinition,
  RuntimeContext,
} from "../src_common/types.ts";
import type { VerdictHandler } from "../verdict/types.ts";
import type { ExtendedStepsRegistry } from "../common/validation-types.ts";
import type { QueryExecutor } from "./query-executor.ts";

const logger = new BreakdownLogger("runner-loop");

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Minimal ResolvedAgentDefinition that satisfies runner.ts requirements.
 */
function createTestDefinition(
  overrides: { maxIterations?: number } = {},
): ResolvedAgentDefinition {
  return {
    name: "test-loop",
    displayName: "Test Loop Agent",
    description: "Integration test agent for runner loop",
    version: "1.0.0",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "./prompts/system.md",
        prompts: { registry: "steps_registry.json", fallbackDir: "./prompts" },
      },
      verdict: {
        type: "count:iteration",
        config: {
          maxIterations: overrides.maxIterations ?? 20,
        },
      },
      boundaries: {
        allowedTools: [],
        permissionMode: "plan",
      },
      execution: {},
      logging: {
        directory: "/tmp/claude/test-runner-loop-logs",
        format: "jsonl",
      },
    },
  };
}

/**
 * Create a mock Logger that satisfies RuntimeContext["logger"].
 */
function createMockLogger() {
  const logs: Array<{ level: string; message: string }> = [];
  return {
    _logs: logs,
    debug: (msg: string) => logs.push({ level: "debug", message: msg }),
    info: (msg: string) => logs.push({ level: "info", message: msg }),
    warn: (msg: string) => logs.push({ level: "warn", message: msg }),
    error: (msg: string) => logs.push({ level: "error", message: msg }),
    log: () => Promise.resolve(),
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
    addContext: () => {},
    getLogPath: () => "/tmp/claude/mock.log",
    logSdkMessage: () => {},
    setToolContext: () => {},
    clearToolContext: () => {},
  } as unknown as RuntimeContext["logger"] & {
    _logs: Array<{ level: string; message: string }>;
  };
}

/**
 * Create a mock VerdictHandler with controllable behavior.
 */
function createMockVerdictHandler(
  options: {
    /** Sequence of isFinished() return values per call */
    finishedSequence?: boolean[];
    verdictDescription?: string;
  } = {},
): VerdictHandler {
  const finishedSeq = options.finishedSequence ?? [true];
  const desc = options.verdictDescription ?? "Test verdict";
  let finishedCallIndex = 0;

  return {
    type: "count:iteration",
    buildInitialPrompt: () => Promise.resolve("Test initial prompt"),
    buildContinuationPrompt: () => Promise.resolve("Test continuation prompt"),
    buildVerdictCriteria: () => ({
      short: "Test criteria",
      detailed: "Detailed test criteria for system prompt",
    }),
    isFinished: () => {
      const val =
        finishedSeq[Math.min(finishedCallIndex, finishedSeq.length - 1)];
      finishedCallIndex++;
      return Promise.resolve(val);
    },
    getVerdictDescription: () => Promise.resolve(desc),
    getLastVerdict: () => undefined,
    setCurrentSummary: () => {},
  };
}

/**
 * Create fake AgentDependencies for injection into AgentRunner.
 */
function createFakeDependencies(
  mockLogger: RuntimeContext["logger"],
  verdictHandler: VerdictHandler,
): AgentDependencies {
  return {
    loggerFactory: {
      create: () => Promise.resolve(mockLogger),
    },
    verdictHandlerFactory: {
      create: () => Promise.resolve(verdictHandler),
    },
    promptResolverFactory: {
      create: () =>
        Promise.resolve(
          {
            resolve: () =>
              Promise.resolve({
                content: "fallback prompt",
                source: "user" as const,
                promptPath: "fallback",
              }),
          } as unknown as import("../common/prompt-resolver.ts").PromptResolver,
        ),
    },
  };
}

/**
 * Create an IterationSummary with defaults.
 */
function createSummary(
  overrides: Partial<IterationSummary> = {},
): IterationSummary {
  return {
    iteration: 1,
    // Default to a non-empty assistantResponses so tests that rely on the
    // happy-path success semantics (completedNormally && no errors &&
    // hasLlmResponses) do not have to opt in explicitly. Tests that need
    // to assert the "no response" failure path can override this to [].
    assistantResponses: ["stub assistant response"],
    toolsUsed: [],
    errors: [],
    ...overrides,
  };
}

/**
 * Create a minimal ExtendedStepsRegistry with an entryStep so
 * FlowOrchestrator.initializeStepContext() can resolve the first step.
 *
 * No structuredGate or transitions are defined so hasFlowRoutingEnabled()
 * returns false, preventing StepRoutingError on iteration > 1.
 */
function createMinimalRegistry(): ExtendedStepsRegistry {
  return {
    agentId: "test-loop",
    version: "1.0.0",
    c1: "steps",
    entryStep: "step.default",
    steps: {
      "step.default": {
        name: "Default Step",
        stepKind: "work",
        c2: "initial",
        c3: "default",
      },
    },
  } as unknown as ExtendedStepsRegistry;
}

/**
 * Replace QueryExecutor.executeQuery on a runner instance with a stub
 * that returns summaries from a provided factory function.
 *
 * Uses bracket notation to access the private queryExecutor field.
 */
function stubExecuteQuery(
  runner: AgentRunner,
  summaryFactory: (callIndex: number, prompt: string) => IterationSummary,
): void {
  let callIndex = 0;
  // deno-lint-ignore no-explicit-any
  const qe = (runner as any).queryExecutor as QueryExecutor;
  // deno-lint-ignore no-explicit-any
  (qe as any).executeQuery = (
    options: { prompt: string; iteration: number },
  ) => {
    const summary = summaryFactory(callIndex, options.prompt);
    callIndex++;
    return Promise.resolve(summary);
  };
}

/**
 * Override closureManager.initializeValidation to install a minimal
 * stepsRegistry without touching the filesystem. This prevents
 * FlowOrchestrator from throwing "No entry step configured".
 */
function stubInitializeValidation(runner: AgentRunner): void {
  // deno-lint-ignore no-explicit-any
  const cm = (runner as any).closureManager;
  cm.initializeValidation = () => {
    cm.stepsRegistry = createMinimalRegistry();
    // Leave stepGateInterpreter and workflowRouter null so
    // hasFlowRoutingEnabled() returns false.
    return Promise.resolve();
  };
}

/**
 * Stub resolveSystemPromptForIteration to avoid filesystem reads.
 * Without this stub, the runner tries to read prompts/system.md from
 * the test cwd (which doesn't exist) and throws PR-SYSTEM-002.
 */
function stubSystemPromptResolution(runner: AgentRunner): void {
  // deno-lint-ignore no-explicit-any
  (runner as any).resolveSystemPromptForIteration = () =>
    Promise.resolve({
      type: "preset",
      preset: "claude_code",
      append: "Stubbed system prompt for test",
    });
}

// =============================================================================
// Test 1: pendingRetryPrompt
// =============================================================================

Deno.test("AgentRunner.run - pendingRetryPrompt is included in next iteration prompt", async () => {
  logger.debug("pendingRetryPrompt test start");

  // Setup: verdictHandler says "not finished" for 3 calls, then "finished"
  const mockLog = createMockLogger();
  const verdictHandler = createMockVerdictHandler({
    finishedSequence: [false, false, true],
    verdictDescription: "retry test complete",
  });
  const deps = createFakeDependencies(mockLog, verdictHandler);
  const definition = createTestDefinition({ maxIterations: 10 });
  const runner = new AgentRunner(definition, deps);

  // Install minimal registry so flow orchestrator can resolve steps
  stubInitializeValidation(runner);
  stubSystemPromptResolution(runner);

  // Stub stepPromptResolver so resolveFlowStepPrompt() returns a prompt
  // (required when stepsRegistry exists, after Phase C C3L-only enforcement)
  // deno-lint-ignore no-explicit-any
  (runner as any).closureManager.stepPromptResolver = {
    resolve: () =>
      Promise.resolve({
        content: "stub flow prompt",
        source: "user" as const,
        promptPath: "stub",
      }),
  };

  // Track prompts received by executeQuery
  const receivedPrompts: string[] = [];
  const retryPromptText = "Validation failed: git is dirty. Please fix.";

  stubExecuteQuery(runner, (callIndex, prompt) => {
    receivedPrompts.push(prompt);

    if (callIndex === 0) {
      // Iteration 1: Return structured output that declares "closing"
      // This triggers hasAIVerdictDeclaration -> validateConditions
      return createSummary({
        iteration: 1,
        sessionId: "sess-retry",
        structuredOutput: {
          stepId: "step.default",
          status: "completed",
          next_action: { action: "closing", reason: "Done" },
        },
      });
    }
    if (callIndex === 1) {
      // Iteration 2: receives the retry prompt, returns simple summary
      return createSummary({
        iteration: 2,
        sessionId: "sess-retry",
      });
    }
    // Iteration 3: final
    return createSummary({
      iteration: 3,
      sessionId: "sess-retry",
    });
  });

  // Override closureManager.validateConditions: first call fails, rest succeed
  let validateCallIndex = 0;
  // deno-lint-ignore no-explicit-any
  const cm = (runner as any).closureManager;
  cm.validateConditions = (
    _stepId: string,
    _summary: IterationSummary,
    _logger: unknown,
  ) => {
    validateCallIndex++;
    if (validateCallIndex === 1) {
      return Promise.resolve({
        valid: false,
        retryPrompt: retryPromptText,
      });
    }
    return Promise.resolve({ valid: true });
  };

  const result = await runner.run({
    args: {},
    cwd: "/tmp/claude/test-retry",
  });

  logger.debug("pendingRetryPrompt test result", {
    iterations: result.iterations,
    promptCount: receivedPrompts.length,
  });

  // Assert: at least 2 iterations executed
  assertEquals(
    receivedPrompts.length >= 2,
    true,
    "Should have at least 2 iterations",
  );

  // The second prompt (iteration 2) should be the retry prompt text
  assertEquals(
    receivedPrompts[1],
    retryPromptText,
    "Second iteration prompt should be the pendingRetryPrompt text",
  );

  assertEquals(result.success, true);
});

// =============================================================================
// Test 2: schema-resolution skip
// =============================================================================

Deno.test("AgentRunner.run - schemaResolutionFailed skips step gate routing", async () => {
  logger.debug("schema-resolution skip test start");

  const mockLog = createMockLogger();
  // Finish after 1 iteration via verdictHandler
  const verdictHandler = createMockVerdictHandler({
    finishedSequence: [true],
    verdictDescription: "schema skip test complete",
  });
  const deps = createFakeDependencies(mockLog, verdictHandler);
  const definition = createTestDefinition({ maxIterations: 5 });
  const runner = new AgentRunner(definition, deps);

  // Install minimal registry
  stubInitializeValidation(runner);
  stubSystemPromptResolution(runner);

  // Stub stepPromptResolver (C3L-only enforcement)
  // deno-lint-ignore no-explicit-any
  (runner as any).closureManager.stepPromptResolver = {
    resolve: () =>
      Promise.resolve({
        content: "stub flow prompt",
        source: "user" as const,
        promptPath: "stub",
      }),
  };

  stubExecuteQuery(runner, () => {
    return createSummary({
      iteration: 1,
      sessionId: "sess-schema",
      schemaResolutionFailed: true,
      errors: ["Schema resolution failed for step"],
    });
  });

  // Override schemaManager.schemaResolutionFailed getter to return true
  // deno-lint-ignore no-explicit-any
  const sm = (runner as any).schemaManager;
  Object.defineProperty(sm, "schemaResolutionFailed", {
    get: () => true,
    configurable: true,
  });

  // Track if flowOrchestrator.setSchemaResolutionFailed was called with true
  let schemaResolutionFailedSet = false;
  // deno-lint-ignore no-explicit-any
  const fo = (runner as any).flowOrchestrator;
  const originalSetFn = fo.setSchemaResolutionFailed.bind(fo);
  fo.setSchemaResolutionFailed = (failed: boolean) => {
    if (failed) schemaResolutionFailedSet = true;
    originalSetFn(failed);
  };

  const result = await runner.run({
    args: {},
    cwd: "/tmp/claude/test-schema-skip",
  });

  logger.debug("schema-resolution skip test result", {
    iterations: result.iterations,
    schemaResolutionFailedSet,
  });

  assertEquals(
    schemaResolutionFailedSet,
    true,
    "flowOrchestrator.setSchemaResolutionFailed(true) should have been called",
  );

  // Verify runner logged the skip message
  const infoLogs = mockLog._logs.filter((l) => l.level === "info");
  const skipLog = infoLogs.find((l) =>
    l.message.includes("Skipping StepGate routing")
  );
  assertExists(
    skipLog,
    "Should log info about skipping StepGate due to StructuredOutputUnavailable",
  );

  // The run completes in 1 iteration because verdictHandler.isFinished()
  // returns true. However, success=false is expected because the summary
  // carries an accumulated error (the new runner success condition requires
  // completedNormally && no errors && hasLlmResponses).
  assertEquals(result.iterations, 1);
  assertEquals(
    result.success,
    false,
    "success must be false when summary.errors is non-empty, even if the verdict handler reports done",
  );
});

// =============================================================================
// Test 3: max-iteration breach
// =============================================================================

Deno.test("AgentRunner.run - max-iteration breach emits error and stops", async () => {
  logger.debug("max-iteration breach test start");

  const mockLog = createMockLogger();
  // verdictHandler always says "not finished"
  const verdictHandler = createMockVerdictHandler({
    finishedSequence: [false, false, false, false, false],
    verdictDescription: "never finishes",
  });
  const deps = createFakeDependencies(mockLog, verdictHandler);
  // Set maxIterations to 2 so we breach quickly
  const definition = createTestDefinition({ maxIterations: 2 });
  const runner = new AgentRunner(definition, deps);

  // Install minimal registry
  stubInitializeValidation(runner);
  stubSystemPromptResolution(runner);

  // Stub stepPromptResolver (C3L-only enforcement)
  // deno-lint-ignore no-explicit-any
  (runner as any).closureManager.stepPromptResolver = {
    resolve: () =>
      Promise.resolve({
        content: "stub flow prompt",
        source: "user" as const,
        promptPath: "stub",
      }),
  };

  stubExecuteQuery(runner, (callIndex) => {
    return createSummary({
      iteration: callIndex + 1,
      sessionId: "sess-max-iter",
      // No structured output. Since hasFlowRoutingEnabled() is false
      // (no stepGateInterpreter/workflowRouter), the iteration > 1 guard
      // that throws AgentStepRoutingError is skipped.
    });
  });

  // Track emitted error events
  const emittedErrors: Error[] = [];
  runner.on("error", (payload) => {
    emittedErrors.push(payload.error);
  });

  const result = await runner.run({
    args: {},
    cwd: "/tmp/claude/test-max-iter",
  });

  logger.debug("max-iteration breach test result", {
    iterations: result.iterations,
    success: result.success,
    errorCount: emittedErrors.length,
  });

  // AgentMaxIterationsError is NOT thrown - the loop breaks and returns.
  // result.success is false because max iterations was reached without completion.
  assertEquals(result.iterations, 2, "Should have run exactly 2 iterations");
  assertEquals(
    result.success,
    false,
    "Max iterations without completion is a failure",
  );

  // Verify that an AgentMaxIterationsError was emitted via event
  assertEquals(emittedErrors.length, 1, "Should emit exactly one error event");
  const emittedError = emittedErrors[0];
  assertExists(emittedError);
  assertEquals(
    emittedError instanceof AgentMaxIterationsError,
    true,
    "Emitted error should be AgentMaxIterationsError",
  );
  assertEquals(
    (emittedError as AgentMaxIterationsError).maxIterations,
    2,
    "Error should reference maxIterations=2",
  );

  // Verify the warning was logged
  const warnLogs = mockLog._logs.filter((l) => l.level === "warn");
  const maxIterWarn = warnLogs.find((l) =>
    l.message.includes("Maximum iterations")
  );
  assertExists(maxIterWarn, "Should log a warning about max iterations");
});

// =============================================================================
// Test 4: setCurrentSummary receives IterationSummary from QueryExecutor
// =============================================================================

/**
 * Create a capturing VerdictHandler that records each IterationSummary
 * passed to setCurrentSummary(), then finishes after the first iteration.
 */
function createCapturingVerdictHandler(): VerdictHandler & {
  captured: IterationSummary[];
} {
  const captured: IterationSummary[] = [];
  return {
    type: "count:iteration",
    buildInitialPrompt: () => Promise.resolve("Test initial prompt"),
    buildContinuationPrompt: () => Promise.resolve("Test continuation prompt"),
    buildVerdictCriteria: () => ({
      short: "Test criteria",
      detailed: "Detailed test criteria",
    }),
    isFinished: () => Promise.resolve(true), // finish after 1 iteration
    getVerdictDescription: () => Promise.resolve("Test verdict"),
    getLastVerdict: () => undefined,
    setCurrentSummary: (summary: IterationSummary) => {
      captured.push(summary);
    },
    captured,
  };
}

Deno.test("AgentRunner.run - setCurrentSummary receives IterationSummary from QueryExecutor", async () => {
  logger.debug("setCurrentSummary capture test start");

  const mockLog = createMockLogger();
  const handler = createCapturingVerdictHandler();
  const deps = createFakeDependencies(mockLog, handler);
  const definition = createTestDefinition({ maxIterations: 5 });
  const runner = new AgentRunner(definition, deps);

  // Install minimal registry so flow orchestrator can resolve steps
  stubInitializeValidation(runner);
  stubSystemPromptResolution(runner);

  // Stub stepPromptResolver on closureManager so resolveFlowStepPrompt()
  // returns a prompt instead of null (which would throw when stepsRegistry exists).
  // deno-lint-ignore no-explicit-any
  const cm = (runner as any).closureManager;
  cm.stepPromptResolver = {
    resolve: () =>
      Promise.resolve({
        content: "stub flow prompt",
        source: "user" as const,
        promptPath: "stub",
      }),
  };

  // Prepare the summary that QueryExecutor will return
  const expectedAssistantResponses = [
    'I have completed the task.\n```test-signal\n{"status": "done"}\n```',
  ];
  const expectedStructuredOutput = {
    signal: "test-signal",
    status: "done",
  };

  stubExecuteQuery(runner, () => {
    return createSummary({
      iteration: 1,
      sessionId: "sess-capture",
      assistantResponses: expectedAssistantResponses,
      toolsUsed: ["Bash", "Read"],
      structuredOutput: expectedStructuredOutput,
    });
  });

  const result = await runner.run({
    args: {},
    cwd: "/tmp/claude/test-capture-summary",
  });

  logger.debug("setCurrentSummary capture test result", {
    iterations: result.iterations,
    capturedCount: handler.captured.length,
  });

  // Assert: handler received at least one summary
  assertEquals(
    handler.captured.length >= 1,
    true,
    "VerdictHandler.setCurrentSummary should have been called at least once",
  );

  // Assert: the captured summary contains the assistantResponses from QueryExecutor
  assertEquals(
    handler.captured[0].assistantResponses,
    expectedAssistantResponses,
    "Captured summary should contain the assistantResponses returned by QueryExecutor",
  );

  // Assert: the captured summary contains the structuredOutput from QueryExecutor
  assertEquals(
    handler.captured[0].structuredOutput,
    expectedStructuredOutput,
    "Captured summary should contain the structuredOutput returned by QueryExecutor",
  );

  assertEquals(result.success, true);
  assertEquals(result.iterations, 1);
});

// =============================================================================
// Test 5: getLastVerdict -> AgentResult.verdict propagation
// =============================================================================

/**
 * Create a VerdictHandler that includes getLastVerdict() returning a fixed
 * verdict string. This simulates adapter-specific behavior (e.g.,
 * ExternalStateVerdictAdapter) where the handler exposes getLastVerdict
 * via duck-typing rather than the VerdictHandler interface.
 */
function createVerdictProvidingHandler(verdict: string): VerdictHandler {
  return {
    type: "count:iteration",
    buildInitialPrompt: () => Promise.resolve("Test initial prompt"),
    buildContinuationPrompt: () => Promise.resolve("Test continuation prompt"),
    buildVerdictCriteria: () => ({
      short: "Test criteria",
      detailed: "Detailed test criteria",
    }),
    isFinished: () => Promise.resolve(true), // finish after 1 iteration
    getVerdictDescription: () => Promise.resolve("Verdict provided"),
    setCurrentSummary: () => {},
    getLastVerdict: () => verdict,
  };
}

Deno.test("AgentRunner.run - getLastVerdict propagates to AgentResult.verdict", async () => {
  logger.debug("getLastVerdict propagation test start");

  const mockLog = createMockLogger();
  const handler = createVerdictProvidingHandler("approved");
  const deps = createFakeDependencies(mockLog, handler);
  const definition = createTestDefinition({ maxIterations: 5 });
  const runner = new AgentRunner(definition, deps);

  // Install minimal registry so flow orchestrator can resolve steps
  stubInitializeValidation(runner);
  stubSystemPromptResolution(runner);

  // Stub stepPromptResolver (C3L-only enforcement)
  // deno-lint-ignore no-explicit-any
  (runner as any).closureManager.stepPromptResolver = {
    resolve: () =>
      Promise.resolve({
        content: "stub flow prompt",
        source: "user" as const,
        promptPath: "stub",
      }),
  };

  stubExecuteQuery(runner, () => {
    return createSummary({
      iteration: 1,
      sessionId: "sess-verdict",
    });
  });

  const result = await runner.run({
    args: {},
    cwd: "/tmp/claude/test-verdict-propagation",
  });

  logger.debug("getLastVerdict propagation test result", {
    iterations: result.iterations,
    verdict: result.verdict,
  });

  // Assert: verdict from getLastVerdict() propagated to AgentResult.verdict
  assertEquals(
    result.verdict,
    "approved",
    "AgentResult.verdict should be 'approved' from getLastVerdict()",
  );
  assertEquals(result.success, true);
  assertEquals(result.iterations, 1);
});

// =============================================================================
// Test 6: result.verdict is undefined when handler has no getLastVerdict
// =============================================================================

// =============================================================================
// Test: setCurrentIteration is invoked at each Flow Loop entry (B2 regression)
// =============================================================================

/**
 * Create a VerdictHandler that captures the sequence of iteration numbers
 * passed to setCurrentIteration(). Used to assert that the runner
 * propagates the loop counter on every iteration entry.
 */
function createIterationCapturingHandler(
  finishedSequence: boolean[],
): VerdictHandler & { capturedIterations: number[] } {
  const capturedIterations: number[] = [];
  let finishedIndex = 0;
  return {
    type: "count:iteration",
    buildInitialPrompt: () => Promise.resolve("Test initial prompt"),
    buildContinuationPrompt: () => Promise.resolve("Test continuation prompt"),
    buildVerdictCriteria: () => ({
      short: "Test criteria",
      detailed: "Detailed test criteria",
    }),
    isFinished: () => {
      const v = finishedSequence[
        Math.min(finishedIndex, finishedSequence.length - 1)
      ];
      finishedIndex++;
      return Promise.resolve(v);
    },
    getVerdictDescription: () => Promise.resolve("Test verdict"),
    getLastVerdict: () => undefined,
    setCurrentSummary: () => {},
    setCurrentIteration: (iteration: number) => {
      capturedIterations.push(iteration);
    },
    capturedIterations,
  };
}

Deno.test("AgentRunner.run - setCurrentIteration is called with 1-based iteration at each Flow Loop entry", async () => {
  logger.debug("setCurrentIteration propagation test start");

  const mockLog = createMockLogger();
  // Let the loop run 3 iterations before finishing.
  const handler = createIterationCapturingHandler([false, false, true]);
  const deps = createFakeDependencies(mockLog, handler);
  const definition = createTestDefinition({ maxIterations: 10 });
  const runner = new AgentRunner(definition, deps);

  stubInitializeValidation(runner);
  stubSystemPromptResolution(runner);

  // deno-lint-ignore no-explicit-any
  (runner as any).closureManager.stepPromptResolver = {
    resolve: () =>
      Promise.resolve({
        content: "stub flow prompt",
        source: "user" as const,
        promptPath: "stub",
      }),
  };

  stubExecuteQuery(runner, (callIndex) => {
    return createSummary({
      iteration: callIndex + 1,
      sessionId: "sess-iter-propagate",
    });
  });

  const result = await runner.run({
    args: {},
    cwd: "/tmp/claude/test-iter-propagate",
  });

  logger.debug("setCurrentIteration propagation test result", {
    capturedIterations: handler.capturedIterations,
    iterations: result.iterations,
  });

  // Assert: setCurrentIteration was called at least once with 1
  // (first Flow Loop entry must propagate iteration=1 so count:iteration
  // handlers can evaluate isFinished() correctly).
  assertEquals(
    handler.capturedIterations.length >= 1,
    true,
    "setCurrentIteration should have been called at least once",
  );
  assertEquals(
    handler.capturedIterations[0],
    1,
    "First setCurrentIteration call must be with iteration=1 (1-based)",
  );

  // Assert: the propagated sequence is strictly 1,2,3,... matching the
  // loop counter.
  for (let i = 0; i < handler.capturedIterations.length; i++) {
    assertEquals(
      handler.capturedIterations[i],
      i + 1,
      `Iteration ${i + 1} must receive iteration=${
        i + 1
      } via setCurrentIteration`,
    );
  }
});

// =============================================================================
// Test: count:iteration + maxIterations=1 reports done:true on normal completion
// (B2 end-to-end regression)
// =============================================================================

Deno.test("AgentRunner.run - count:iteration with maxIterations=1 reports success on normal completion", async () => {
  logger.debug("count:iteration maxIterations=1 test start");

  const mockLog = createMockLogger();
  // Use the real IterationBudgetVerdictHandler via a thin wrapper around
  // its public API, so isFinished() depends on setCurrentIteration.
  const { IterationBudgetVerdictHandler } = await import(
    "../verdict/iteration-budget.ts"
  );
  const realHandler = new IterationBudgetVerdictHandler(1);
  const deps = createFakeDependencies(mockLog, realHandler);
  const definition = createTestDefinition({ maxIterations: 1 });
  const runner = new AgentRunner(definition, deps);

  stubInitializeValidation(runner);
  stubSystemPromptResolution(runner);

  // deno-lint-ignore no-explicit-any
  (runner as any).closureManager.stepPromptResolver = {
    resolve: () =>
      Promise.resolve({
        content: "stub flow prompt",
        source: "user" as const,
        promptPath: "stub",
      }),
  };

  stubExecuteQuery(runner, () => {
    return createSummary({
      iteration: 1,
      sessionId: "sess-b2",
    });
  });

  const result = await runner.run({
    args: {},
    cwd: "/tmp/claude/test-b2-maxiter-1",
  });

  logger.debug("count:iteration maxIterations=1 test result", {
    iterations: result.iterations,
    success: result.success,
  });

  // B2 regression: before the fix, the handler's currentIteration stayed at 0
  // and isFinished() returned false, causing a "Maximum iterations" warn and
  // result.success=false. After the fix, iteration=1 is propagated so
  // isFinished() returns true and the run completes successfully in one
  // iteration.
  assertEquals(
    result.iterations,
    1,
    "Should complete in exactly 1 iteration",
  );
  assertEquals(
    result.success,
    true,
    "count:iteration with maxIterations=1 must succeed on normal completion",
  );

  // There must be no "Maximum iterations" warning.
  const warnLogs = mockLog._logs.filter((l) => l.level === "warn");
  const maxIterWarn = warnLogs.find((l) =>
    l.message.includes("Maximum iterations")
  );
  assertEquals(
    maxIterWarn,
    undefined,
    "Must not emit 'Maximum iterations reached' warning when handler finishes naturally",
  );
});

Deno.test("AgentRunner.run - result.verdict is undefined when handler has no getLastVerdict", async () => {
  logger.debug("no getLastVerdict test start");

  const mockLog = createMockLogger();
  // Standard mock handler does NOT have getLastVerdict
  const handler = createMockVerdictHandler({
    finishedSequence: [true],
    verdictDescription: "No verdict handler",
  });
  const deps = createFakeDependencies(mockLog, handler);
  const definition = createTestDefinition({ maxIterations: 5 });
  const runner = new AgentRunner(definition, deps);

  // Install minimal registry so flow orchestrator can resolve steps
  stubInitializeValidation(runner);
  stubSystemPromptResolution(runner);

  // Stub stepPromptResolver (C3L-only enforcement)
  // deno-lint-ignore no-explicit-any
  (runner as any).closureManager.stepPromptResolver = {
    resolve: () =>
      Promise.resolve({
        content: "stub flow prompt",
        source: "user" as const,
        promptPath: "stub",
      }),
  };

  stubExecuteQuery(runner, () => {
    return createSummary({
      iteration: 1,
      sessionId: "sess-no-verdict",
    });
  });

  const result = await runner.run({
    args: {},
    cwd: "/tmp/claude/test-no-verdict",
  });

  logger.debug("no getLastVerdict test result", {
    iterations: result.iterations,
    verdict: result.verdict,
  });

  // Assert: verdict is undefined when handler lacks getLastVerdict
  assertEquals(
    result.verdict,
    undefined,
    "AgentResult.verdict should be undefined when handler has no getLastVerdict",
  );
  assertEquals(result.success, true);
});

// =============================================================================
// Test: SDK failure with 0 LLM responses must result in success=false
// (Regression for framework-fix-no-response: handler done + 0 response ->
//  success was incorrectly true before the fix.)
// =============================================================================

Deno.test("AgentRunner.run - SDK failure with 0 LLM responses returns success=false", async () => {
  logger.debug("SDK failure 0 response test start");

  const mockLog = createMockLogger();
  const verdictHandler = createMockVerdictHandler({
    finishedSequence: [true],
    verdictDescription: "Completed after 1 iteration",
  });
  const deps = createFakeDependencies(mockLog, verdictHandler);
  const definition = createTestDefinition({ maxIterations: 1 });
  const runner = new AgentRunner(definition, deps);

  stubInitializeValidation(runner);
  stubSystemPromptResolution(runner);
  // deno-lint-ignore no-explicit-any
  (runner as any).closureManager.stepPromptResolver = {
    resolve: () =>
      Promise.resolve({
        content: "stub flow prompt",
        source: "user" as const,
        promptPath: "stub",
      }),
  };

  stubExecuteQuery(runner, () => {
    return createSummary({
      iteration: 1,
      sessionId: "sess-sdk-fail",
      assistantResponses: [],
      errors: ["Query execution failed: API unavailable"],
    });
  });

  const result = await runner.run({
    args: {},
    cwd: "/tmp/claude/test-sdk-failure",
  });

  logger.debug("SDK failure 0 response test result", {
    success: result.success,
    iterations: result.iterations,
    error: result.error,
  });

  assertEquals(
    result.success,
    false,
    "SDK failure with 0 responses must result in success=false despite handler done=true",
  );
  assertEquals(
    result.iterations,
    1,
    "Iteration count must be accurate despite failure",
  );
  // error field should surface the accumulated error
  assertEquals(
    typeof result.error,
    "string",
    "result.error should be a string when errors accumulated",
  );
});

// =============================================================================
// Test: Normal LLM response with handler done=true must still succeed
// (Regression guard: the stricter success condition must not break the
//  happy path.)
// =============================================================================

Deno.test("AgentRunner.run - normal LLM response with handler done=true returns success=true", async () => {
  logger.debug("normal response success test start");

  const mockLog = createMockLogger();
  const verdictHandler = createMockVerdictHandler({
    finishedSequence: [true],
    verdictDescription: "Completed normally",
  });
  const deps = createFakeDependencies(mockLog, verdictHandler);
  const definition = createTestDefinition({ maxIterations: 1 });
  const runner = new AgentRunner(definition, deps);

  stubInitializeValidation(runner);
  stubSystemPromptResolution(runner);
  // deno-lint-ignore no-explicit-any
  (runner as any).closureManager.stepPromptResolver = {
    resolve: () =>
      Promise.resolve({
        content: "stub flow prompt",
        source: "user" as const,
        promptPath: "stub",
      }),
  };

  stubExecuteQuery(runner, () => {
    return createSummary({
      iteration: 1,
      sessionId: "sess-normal",
      assistantResponses: ["Successfully completed the task"],
      errors: [],
    });
  });

  const result = await runner.run({
    args: {},
    cwd: "/tmp/claude/test-normal-response",
  });

  logger.debug("normal response success test result", {
    success: result.success,
    iterations: result.iterations,
  });

  assertEquals(
    result.success,
    true,
    "Normal completion with LLM response must succeed",
  );
  assertEquals(result.iterations, 1);
  assertEquals(
    result.error,
    undefined,
    "No error field when everything succeeds",
  );
});
