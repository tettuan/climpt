/**
 * Dry-Run Integration Test
 *
 * Exercises the full runner orchestration loop (FlowOrchestrator +
 * CompletionManager) over a converted iterator config without hitting
 * real SDK calls. Mocks are injected at the component boundary so the
 * coordination between entry step selection, structured gate routing,
 * completion detection, and step context accumulation is all real.
 *
 * This provides a regression net for schema/config restructurings
 * while keeping tests hermetic and fast.
 *
 * @design_ref tmp/agent_runner_tests/evaluation.md (End-to-end dry run row)
 */

import { assertEquals } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { FlowOrchestrator } from "./flow-orchestrator.ts";

const logger = new BreakdownLogger("integration");
import { CompletionManager } from "./completion-manager.ts";
import { StepGateInterpreter } from "./step-gate-interpreter.ts";
import { WorkflowRouter } from "./workflow-router.ts";
import { CompletionChain } from "./completion-chain.ts";
import type { ExtendedStepsRegistry } from "../common/completion-types.ts";
import type { StepRegistry } from "../common/step-registry.ts";
import type {
  AgentDefinition,
  IterationSummary,
  RuntimeContext,
} from "../src_common/types.ts";
import type { CompletionType } from "../src_common/types/completion.ts";
import type { AgentDependencies } from "./builder.ts";

// =============================================================================
// Fixtures
// =============================================================================

async function loadFixtureRegistry(): Promise<ExtendedStepsRegistry> {
  const raw = await Deno.readTextFile(
    "agents/test-artifacts/responsibility-fixtures/test-steps-registry.json",
  );
  return JSON.parse(raw) as ExtendedStepsRegistry;
}

function createTestDefinition(
  completionType: CompletionType = "externalState",
): AgentDefinition {
  return {
    name: "test-flow",
    displayName: "Test Flow Agent",
    description: "Dry-run integration test agent",
    version: "1.0.0",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "./prompts/system.md",
        prompts: { registry: "steps_registry.json", fallbackDir: "./prompts" },
      },
      completion: {
        type: completionType,
        config: { maxIterations: 20 },
      },
      boundaries: {
        allowedTools: [],
        permissionMode: "plan",
      },
      execution: {},
      logging: { directory: "/tmp/claude/test-logs", format: "jsonl" },
    },
  };
}

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

function createMockContext(
  logger: RuntimeContext["logger"],
): RuntimeContext {
  return {
    completionHandler: {} as RuntimeContext["completionHandler"],
    promptResolver: {} as RuntimeContext["promptResolver"],
    logger,
    cwd: "/tmp/claude/test",
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

/**
 * Simulated SDK responses for a 3-iteration flow:
 *   initial -> continuation -> closure
 */
function createMockSdkResponses(): IterationSummary[] {
  return [
    // Iteration 1: initial.test -> next -> continuation.test
    createSummary({
      iteration: 1,
      sessionId: "sess-dry-run",
      structuredOutput: {
        stepId: "initial.test",
        status: "in_progress",
        next_action: { action: "next", reason: "Analysis complete" },
        analysis: { summary: "Codebase reviewed" },
      },
    }),
    // Iteration 2: continuation.test -> handoff -> closure.test
    createSummary({
      iteration: 2,
      sessionId: "sess-dry-run",
      structuredOutput: {
        stepId: "continuation.test",
        status: "in_progress",
        next_action: { action: "handoff", reason: "Implementation done" },
        progress: { files: ["src/main.ts", "src/lib.ts"] },
      },
    }),
    // Iteration 3: closure.test -> closing -> complete
    createSummary({
      iteration: 3,
      sessionId: "sess-dry-run",
      structuredOutput: {
        stepId: "closure.test",
        status: "completed",
        next_action: { action: "closing", reason: "All checks pass" },
      },
    }),
  ];
}

// =============================================================================
// Dry-Run Runner Loop
// =============================================================================

/**
 * Simulate the runner's flow loop using real FlowOrchestrator +
 * CompletionManager but mocked SDK responses.
 *
 * This mirrors the logic in runner.ts:run() without QueryExecutor.
 */
async function runDryLoop(
  registry: ExtendedStepsRegistry,
  completionType: CompletionType,
  mockResponses: IterationSummary[],
): Promise<{
  iterations: number;
  completed: boolean;
  completionReason: string;
  stepSequence: string[];
  pendingRetryPrompt: string | null;
}> {
  const definition = createTestDefinition(completionType);
  const logger = createMockLogger();
  const ctx = createMockContext(logger);

  // Wire CompletionManager (matches runner.ts constructor)
  const completionManager = new CompletionManager({
    definition,
    dependencies: {
      loggerFactory: { create: () => Promise.resolve({} as never) },
      completionHandlerFactory: { create: () => Promise.resolve({} as never) },
      promptResolverFactory: { create: () => Promise.resolve({} as never) },
    } as AgentDependencies,
  });

  // Manually set up registry and components (simulates initializeCompletionValidation)
  completionManager.stepsRegistry = registry;
  completionManager.stepGateInterpreter = new StepGateInterpreter();
  completionManager.workflowRouter = new WorkflowRouter(
    registry as unknown as StepRegistry,
  );
  completionManager.completionChain = new CompletionChain({
    workingDir: "/tmp/claude/test",
    logger: logger as unknown as import("../src_common/logger.ts").Logger,
    stepsRegistry: registry,
    completionValidator: null,
    retryHandler: null,
    agentId: definition.name,
  });

  // Wire FlowOrchestrator (matches runner.ts constructor)
  const flowOrchestrator = new FlowOrchestrator({
    definition,
    args: {},
    getStepsRegistry: () => completionManager.stepsRegistry,
    getStepGateInterpreter: () => completionManager.stepGateInterpreter,
    getWorkflowRouter: () => completionManager.workflowRouter,
    hasFlowRoutingEnabled: () => completionManager.hasFlowRoutingEnabled(),
  });

  // Initialize step context (matches runner.ts:run())
  flowOrchestrator.initializeStepContext();

  const stepSequence: string[] = [];
  let pendingRetryPrompt: string | null = null;
  let completed = false;
  let completionReason = "";
  let iteration = 0;

  // --- Flow loop (mirrors runner.ts while-true loop) ---
  for (const mockSummary of mockResponses) {
    iteration++;

    const stepId = flowOrchestrator.getStepIdForIteration(iteration);
    stepSequence.push(stepId);

    // Normalize stepId
    flowOrchestrator.normalizeStructuredOutputStepId(
      stepId,
      mockSummary,
      ctx,
    );

    // Record step output
    flowOrchestrator.recordStepOutput(stepId, mockSummary, ctx);

    // Check AI completion declaration
    if (completionManager.hasAICompletionDeclaration(mockSummary)) {
      const completionStepId = completionManager.getCompletionStepId();
      const validation = await completionManager.validateCompletionConditions(
        completionStepId,
        mockSummary,
        logger as unknown as import("../src_common/logger.ts").Logger,
      );

      if (!validation.valid) {
        pendingRetryPrompt = validation.retryPrompt ?? null;
      }
    }

    // Step transition
    const routingResult = flowOrchestrator.handleStepTransition(
      stepId,
      mockSummary,
      ctx,
    );

    // Check completion
    if (pendingRetryPrompt) {
      // Retry - not complete
      continue;
    }

    if (routingResult?.signalCompletion) {
      completed = true;
      completionReason = routingResult.reason;
      break;
    }
  }

  return {
    iterations: iteration,
    completed,
    completionReason,
    stepSequence,
    pendingRetryPrompt,
  };
}

// =============================================================================
// Integration Tests
// =============================================================================

Deno.test("Dry-run integration - 3-step issue flow completes in 3 iterations", async () => {
  const registry = await loadFixtureRegistry();
  const responses = createMockSdkResponses();

  logger.debug("dry-run loop input", {
    completionType: "externalState",
    responseCount: responses.length,
  });
  const result = await runDryLoop(registry, "externalState", responses);
  logger.debug("dry-run loop result", {
    iterations: result.iterations,
    completed: result.completed,
    stepSequence: result.stepSequence,
  });

  assertEquals(result.iterations, 3);
  assertEquals(result.completed, true);
  assertEquals(result.completionReason, "All checks pass");
  assertEquals(result.stepSequence, [
    "initial.test",
    "continuation.test",
    "closure.test",
  ]);
  assertEquals(result.pendingRetryPrompt, null);
});

Deno.test("Dry-run integration - iterationBudget completionType uses same entry step", async () => {
  const registry = await loadFixtureRegistry();
  const responses = createMockSdkResponses();

  const result = await runDryLoop(registry, "iterationBudget", responses);

  assertEquals(result.iterations, 3);
  assertEquals(result.completed, true);
  assertEquals(result.stepSequence[0], "initial.test");
});

Deno.test("Dry-run integration - repeat iteration stays on same step", async () => {
  const registry = await loadFixtureRegistry();

  const responses = [
    // Iteration 1: initial.test -> next
    createSummary({
      iteration: 1,
      sessionId: "sess-repeat",
      structuredOutput: {
        next_action: { action: "next", reason: "ok" },
      },
    }),
    // Iteration 2: continuation.test -> repeat (retry same step)
    createSummary({
      iteration: 2,
      sessionId: "sess-repeat",
      structuredOutput: {
        next_action: { action: "repeat", reason: "Not done yet" },
      },
    }),
    // Iteration 3: continuation.test -> handoff (proceed to closure)
    createSummary({
      iteration: 3,
      sessionId: "sess-repeat",
      structuredOutput: {
        next_action: { action: "handoff", reason: "Now done" },
        progress: { files: ["a.ts"] },
      },
    }),
    // Iteration 4: closure.test -> closing
    createSummary({
      iteration: 4,
      sessionId: "sess-repeat",
      structuredOutput: {
        next_action: { action: "closing", reason: "Pass" },
      },
    }),
  ];

  const result = await runDryLoop(registry, "externalState", responses);

  assertEquals(result.iterations, 4);
  assertEquals(result.completed, true);
  assertEquals(result.stepSequence, [
    "initial.test",
    "continuation.test",
    "continuation.test", // repeat kept it on same step
    "closure.test",
  ]);
});

Deno.test("Dry-run integration - closure repeat delays completion", async () => {
  const registry = await loadFixtureRegistry();

  const responses = [
    // Iteration 1: initial.test -> next
    createSummary({
      iteration: 1,
      structuredOutput: { next_action: { action: "next", reason: "ok" } },
    }),
    // Iteration 2: continuation.test -> handoff
    createSummary({
      iteration: 2,
      structuredOutput: {
        next_action: { action: "handoff", reason: "done" },
      },
    }),
    // Iteration 3: closure.test -> repeat (not ready)
    createSummary({
      iteration: 3,
      structuredOutput: {
        next_action: { action: "repeat", reason: "Checks not ready" },
      },
    }),
    // Iteration 4: closure.test -> closing (now ready)
    createSummary({
      iteration: 4,
      structuredOutput: {
        next_action: { action: "closing", reason: "All clear" },
      },
    }),
  ];

  const result = await runDryLoop(registry, "externalState", responses);

  assertEquals(result.iterations, 4);
  assertEquals(result.completed, true);
  assertEquals(result.stepSequence, [
    "initial.test",
    "continuation.test",
    "closure.test",
    "closure.test", // repeat on closure
  ]);
  assertEquals(result.completionReason, "All clear");
});

Deno.test("Dry-run integration - step context accumulates across steps", async () => {
  const registry = await loadFixtureRegistry();
  const definition = createTestDefinition("externalState");
  const logger = createMockLogger();
  const ctx = createMockContext(logger);

  const completionManager = new CompletionManager({
    definition,
    dependencies: {
      loggerFactory: { create: () => Promise.resolve({} as never) },
      completionHandlerFactory: { create: () => Promise.resolve({} as never) },
      promptResolverFactory: { create: () => Promise.resolve({} as never) },
    } as AgentDependencies,
  });
  completionManager.stepsRegistry = registry;
  completionManager.stepGateInterpreter = new StepGateInterpreter();
  completionManager.workflowRouter = new WorkflowRouter(
    registry as unknown as StepRegistry,
  );

  const flowOrchestrator = new FlowOrchestrator({
    definition,
    args: { issue: 42 },
    getStepsRegistry: () => completionManager.stepsRegistry,
    getStepGateInterpreter: () => completionManager.stepGateInterpreter,
    getWorkflowRouter: () => completionManager.workflowRouter,
    hasFlowRoutingEnabled: () => completionManager.hasFlowRoutingEnabled(),
  });

  flowOrchestrator.initializeStepContext();

  // Record outputs for each step
  const s1 = createSummary({
    iteration: 1,
    sessionId: "sess-ctx",
    structuredOutput: { analysis: { summary: "found 3 issues" } },
  });
  flowOrchestrator.recordStepOutput("initial.test", s1, ctx);

  const s2 = createSummary({
    iteration: 2,
    sessionId: "sess-ctx",
    structuredOutput: { progress: { files: ["a.ts", "b.ts"] } },
  });
  flowOrchestrator.recordStepOutput("continuation.test", s2, ctx);

  // Verify step context accumulated outputs via the Map interface
  const stepContext = flowOrchestrator.getStepContext()!;
  const initialData = stepContext.outputs.get("initial.test");
  const contData = stepContext.outputs.get("continuation.test");

  assertEquals(initialData?.analysis, { summary: "found 3 issues" });
  assertEquals(initialData?.iteration, 1);
  assertEquals(contData?.progress, { files: ["a.ts", "b.ts"] });
  assertEquals(contData?.iteration, 2);
});

Deno.test("Dry-run integration - stepId normalization corrects LLM-returned stepId", async () => {
  const registry = await loadFixtureRegistry();
  const logger = createMockLogger();
  const ctx = createMockContext(logger);

  const completionManager = new CompletionManager({
    definition: createTestDefinition("externalState"),
    dependencies: {
      loggerFactory: { create: () => Promise.resolve({} as never) },
      completionHandlerFactory: { create: () => Promise.resolve({} as never) },
      promptResolverFactory: { create: () => Promise.resolve({} as never) },
    } as AgentDependencies,
  });
  completionManager.stepsRegistry = registry;

  const flowOrchestrator = new FlowOrchestrator({
    definition: createTestDefinition("externalState"),
    args: {},
    getStepsRegistry: () => completionManager.stepsRegistry,
    getStepGateInterpreter: () => null,
    getWorkflowRouter: () => null,
    hasFlowRoutingEnabled: () => false,
  });

  // LLM returns wrong stepId
  const summary = createSummary({
    structuredOutput: {
      stepId: "s_initial_test", // Wrong format from LLM
      next_action: { action: "next" },
    },
  });

  flowOrchestrator.normalizeStructuredOutputStepId(
    "initial.test",
    summary,
    ctx,
  );

  // Flow corrected the stepId
  assertEquals(
    (summary.structuredOutput as Record<string, unknown>).stepId,
    "initial.test",
  );
});

Deno.test("Dry-run integration - incomplete flow (no closing) does not complete", async () => {
  const registry = await loadFixtureRegistry();

  // Only 2 iterations - never reaches closure
  const responses = [
    createSummary({
      iteration: 1,
      structuredOutput: { next_action: { action: "next", reason: "ok" } },
    }),
    createSummary({
      iteration: 2,
      structuredOutput: { next_action: { action: "next", reason: "more" } },
    }),
  ];

  const result = await runDryLoop(registry, "externalState", responses);

  assertEquals(result.iterations, 2);
  assertEquals(result.completed, false);
  assertEquals(result.stepSequence, ["initial.test", "continuation.test"]);
});
