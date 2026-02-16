/**
 * FlowOrchestrator Unit Tests
 *
 * Fixture-based tests for step flow routing and transition management.
 * Validates entry step selection, stepId normalization, step output recording,
 * step transitions, and schema-failure skip behavior.
 *
 * @design_ref agents/docs/design/08_step_flow_design.md
 * @design_ref tmp/agent_runner_tests/evaluation.md (Flow orchestration row)
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  FlowOrchestrator,
  type FlowOrchestratorDeps,
} from "./flow-orchestrator.ts";
import { StepGateInterpreter } from "./step-gate-interpreter.ts";
import { WorkflowRouter } from "./workflow-router.ts";
import type { ExtendedStepsRegistry } from "../common/completion-types.ts";
import type {
  PromptStepDefinition,
  StepRegistry,
} from "../common/step-registry.ts";
import type {
  AgentDefinition,
  IterationSummary,
  RuntimeContext,
} from "../src_common/types.ts";
import type { CompletionType } from "../src_common/types/completion.ts";

// =============================================================================
// Shared Fixtures
// =============================================================================

/** Load the responsibility fixture registry. */
async function loadFixtureRegistry(): Promise<ExtendedStepsRegistry> {
  const raw = await Deno.readTextFile(
    "agents/test-artifacts/responsibility-fixtures/test-steps-registry.json",
  );
  return JSON.parse(raw) as ExtendedStepsRegistry;
}

/** Create a minimal AgentDefinition. completionType must be a valid CompletionType. */
function createTestDefinition(
  completionType: CompletionType = "externalState",
): AgentDefinition {
  return {
    name: "test-flow",
    displayName: "Test Flow Agent",
    description: "Fixture agent for FlowOrchestrator tests",
    version: "1.0.0",
    behavior: {
      systemPromptPath: "./prompts/system.md",
      completionType,
      completionConfig: { maxIterations: 10 },
      allowedTools: [],
      permissionMode: "plan",
    },
    parameters: {},
    prompts: { registry: "steps_registry.json", fallbackDir: "./prompts" },
    logging: { directory: "/tmp/claude/test-logs", format: "jsonl" },
  };
}

/** Build FlowOrchestratorDeps with registry and optional routing components. */
function buildDeps(
  registry: ExtendedStepsRegistry | null,
  options: {
    completionType?: CompletionType;
    withRouting?: boolean;
    args?: Record<string, unknown>;
  } = {},
): FlowOrchestratorDeps {
  const definition = createTestDefinition(
    options.completionType ?? "externalState",
  );
  const interpreter = options.withRouting ? new StepGateInterpreter() : null;
  const router = options.withRouting && registry
    ? new WorkflowRouter(registry as unknown as StepRegistry)
    : null;

  return {
    definition,
    args: options.args ?? {},
    getStepsRegistry: () => registry,
    getStepGateInterpreter: () => interpreter,
    getWorkflowRouter: () => router,
    hasFlowRoutingEnabled: () => interpreter !== null && router !== null,
  };
}

/** Create a minimal RuntimeContext with a no-op logger. */
function createMockContext(): RuntimeContext {
  const noopLogger = {
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
  return {
    completionHandler: {} as RuntimeContext["completionHandler"],
    promptResolver: {} as RuntimeContext["promptResolver"],
    logger: noopLogger as unknown as RuntimeContext["logger"],
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

// =============================================================================
// Entry Step Selection
// =============================================================================

Deno.test("FlowOrchestrator - entry step via entryStepMapping for externalState", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry, { completionType: "externalState" });
  const orchestrator = new FlowOrchestrator(deps);

  const stepId = orchestrator.getStepIdForIteration(1);
  assertEquals(stepId, "initial.test");
});

Deno.test("FlowOrchestrator - entry step via entryStepMapping for iterationBudget", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry, { completionType: "iterationBudget" });
  const orchestrator = new FlowOrchestrator(deps);

  const stepId = orchestrator.getStepIdForIteration(1);
  assertEquals(stepId, "initial.test");
});

Deno.test("FlowOrchestrator - entry step falls back to generic entryStep", () => {
  const registry: ExtendedStepsRegistry = {
    agentId: "fallback-test",
    version: "1.0.0",
    c1: "steps",
    entryStep: "generic.entry",
    steps: {
      "generic.entry": {
        stepId: "generic.entry",
        name: "Generic Entry",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "generic_entry_default",
        uvVariables: [],
        usesStdin: false,
      },
    },
  };
  const deps = buildDeps(registry, { completionType: "custom" });
  const orchestrator = new FlowOrchestrator(deps);

  assertEquals(orchestrator.getStepIdForIteration(1), "generic.entry");
});

Deno.test("FlowOrchestrator - throws when no entry step configured", () => {
  const registry: ExtendedStepsRegistry = {
    agentId: "no-entry",
    version: "1.0.0",
    c1: "steps",
    steps: {},
  };
  const deps = buildDeps(registry, { completionType: "custom" });
  const orchestrator = new FlowOrchestrator(deps);

  assertThrows(
    () => orchestrator.getStepIdForIteration(1),
    Error,
    'No entry step configured for completionType "custom"',
  );
});

Deno.test("FlowOrchestrator - throws when no registry available", () => {
  const deps = buildDeps(null, { completionType: "externalState" });
  const orchestrator = new FlowOrchestrator(deps);

  assertThrows(
    () => orchestrator.getStepIdForIteration(1),
    Error,
    "No entry step configured",
  );
});

// =============================================================================
// Iteration > 1 Step Resolution
// =============================================================================

Deno.test("FlowOrchestrator - iteration > 1 uses currentStepId from routing", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry, { withRouting: true });
  const orchestrator = new FlowOrchestrator(deps);

  // Initialize sets currentStepId to entry step
  orchestrator.initializeStepContext();
  assertEquals(orchestrator.getStepIdForIteration(1), "initial.test");

  // Manually set currentStepId (simulating routing)
  orchestrator.currentStepId = "continuation.test";
  assertEquals(orchestrator.getStepIdForIteration(2), "continuation.test");
});

Deno.test("FlowOrchestrator - iteration > 1 throws when no routed step ID", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry);
  const orchestrator = new FlowOrchestrator(deps);

  // Clear currentStepId
  orchestrator.currentStepId = null;

  assertThrows(
    () => orchestrator.getStepIdForIteration(2),
    Error,
    "No routed step ID for iteration 2",
  );
});

// =============================================================================
// initializeStepContext
// =============================================================================

Deno.test("FlowOrchestrator - initializeStepContext creates context and sets entry step", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry, { completionType: "externalState" });
  const orchestrator = new FlowOrchestrator(deps);

  assertEquals(orchestrator.stepContext, null);
  assertEquals(orchestrator.currentStepId, null);

  orchestrator.initializeStepContext();

  assertEquals(orchestrator.stepContext !== null, true);
  assertEquals(orchestrator.currentStepId, "initial.test");
});

// =============================================================================
// stepId Normalization
// =============================================================================

Deno.test("FlowOrchestrator - normalizeStructuredOutputStepId corrects mismatched stepId", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry);
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  const summary = createSummary({
    structuredOutput: {
      stepId: "wrong_step_id",
      next_action: { action: "next" },
    },
  });

  orchestrator.normalizeStructuredOutputStepId("initial.test", summary, ctx);

  assertEquals(
    (summary.structuredOutput as Record<string, unknown>).stepId,
    "initial.test",
  );
});

Deno.test("FlowOrchestrator - normalizeStructuredOutputStepId no-op when stepId matches", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry);
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  const summary = createSummary({
    structuredOutput: {
      stepId: "initial.test",
      next_action: { action: "next" },
    },
  });

  orchestrator.normalizeStructuredOutputStepId("initial.test", summary, ctx);

  assertEquals(
    (summary.structuredOutput as Record<string, unknown>).stepId,
    "initial.test",
  );
});

Deno.test("FlowOrchestrator - normalizeStructuredOutputStepId skips when no structured output", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry);
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  const summary = createSummary(); // no structuredOutput

  // Should not throw
  orchestrator.normalizeStructuredOutputStepId("initial.test", summary, ctx);
  assertEquals(summary.structuredOutput, undefined);
});

Deno.test("FlowOrchestrator - normalizeStructuredOutputStepId skips when stepId not in output", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry);
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "next" },
      // no stepId field
    },
  });

  orchestrator.normalizeStructuredOutputStepId("initial.test", summary, ctx);

  // structuredOutput should not have stepId added
  assertEquals(
    (summary.structuredOutput as Record<string, unknown>).stepId,
    undefined,
  );
});

// =============================================================================
// recordStepOutput
// =============================================================================

Deno.test("FlowOrchestrator - recordStepOutput stores structured output in context", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry);
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  orchestrator.initializeStepContext();

  const summary = createSummary({
    iteration: 1,
    sessionId: "sess-123",
    structuredOutput: {
      analysis: { summary: "code review done" },
      next_action: { action: "next" },
    },
  });

  orchestrator.recordStepOutput("initial.test", summary, ctx);

  const stored = orchestrator.stepContext!.getAll("initial.test");
  assertEquals(stored?.analysis, { summary: "code review done" });
  assertEquals(stored?.iteration, 1);
  assertEquals(stored?.sessionId, "sess-123");
});

Deno.test("FlowOrchestrator - recordStepOutput records error metadata", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry);
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  orchestrator.initializeStepContext();

  const summary = createSummary({
    errors: ["Schema parse error", "Timeout"],
    structuredOutput: {},
  });

  orchestrator.recordStepOutput("initial.test", summary, ctx);

  const stored = orchestrator.stepContext!.getAll("initial.test");
  assertEquals(stored?.hasErrors, true);
  assertEquals(stored?.errorCount, 2);
});

Deno.test("FlowOrchestrator - recordStepOutput is no-op when context is null", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry);
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  // Do NOT call initializeStepContext() - stepContext stays null

  const summary = createSummary({ structuredOutput: { data: "test" } });

  // Should not throw
  orchestrator.recordStepOutput("initial.test", summary, ctx);
});

// =============================================================================
// handleStepTransition
// =============================================================================

Deno.test("FlowOrchestrator - handleStepTransition returns null when schemaResolutionFailed", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry, { withRouting: true });
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  orchestrator.setSchemaResolutionFailed(true);

  const summary = createSummary({
    structuredOutput: { next_action: { action: "next" } },
  });

  const result = orchestrator.handleStepTransition(
    "initial.test",
    summary,
    ctx,
  );
  assertEquals(result, null);
});

Deno.test("FlowOrchestrator - handleStepTransition returns null when prerequisites missing", async () => {
  const registry = await loadFixtureRegistry();
  // No routing components
  const deps = buildDeps(registry, { withRouting: false });
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  const summary = createSummary({
    structuredOutput: { next_action: { action: "next" } },
  });

  const result = orchestrator.handleStepTransition(
    "initial.test",
    summary,
    ctx,
  );
  assertEquals(result, null);
});

Deno.test("FlowOrchestrator - handleStepTransition returns null when no structured output", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry, { withRouting: true });
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  const summary = createSummary(); // no structuredOutput

  const result = orchestrator.handleStepTransition(
    "initial.test",
    summary,
    ctx,
  );
  assertEquals(result, null);
});

Deno.test("FlowOrchestrator - handleStepTransition routes next intent to continuation step", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry, { withRouting: true });
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  orchestrator.initializeStepContext();

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "next", reason: "Moving forward" },
      analysis: { summary: "done" },
    },
  });

  const result = orchestrator.handleStepTransition(
    "initial.test",
    summary,
    ctx,
  );

  assertEquals(result !== null, true);
  assertEquals(result!.nextStepId, "continuation.test");
  assertEquals(result!.signalCompletion, false);
  // currentStepId updated to next step
  assertEquals(orchestrator.currentStepId, "continuation.test");
});

Deno.test("FlowOrchestrator - handleStepTransition routes handoff intent to closure step", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry, { withRouting: true });
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  orchestrator.initializeStepContext();

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "handoff", reason: "Work complete" },
      progress: { files: ["a.ts", "b.ts"] },
    },
  });

  const result = orchestrator.handleStepTransition(
    "continuation.test",
    summary,
    ctx,
  );

  assertEquals(result !== null, true);
  assertEquals(result!.nextStepId, "closure.test");
  assertEquals(result!.signalCompletion, false);
  assertEquals(orchestrator.currentStepId, "closure.test");
});

Deno.test("FlowOrchestrator - handleStepTransition signals completion for closing intent on closure step", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry, { withRouting: true });
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  orchestrator.initializeStepContext();

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "closing", reason: "All done" },
    },
  });

  const result = orchestrator.handleStepTransition(
    "closure.test",
    summary,
    ctx,
  );

  assertEquals(result !== null, true);
  assertEquals(result!.signalCompletion, true);
});

Deno.test("FlowOrchestrator - handleStepTransition stores handoff data in step context", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry, { withRouting: true });
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  orchestrator.initializeStepContext();

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "next", reason: "ok" },
      analysis: { summary: "important finding" },
    },
  });

  orchestrator.handleStepTransition("initial.test", summary, ctx);

  // Handoff data should be stored for initial.test
  const handoff = orchestrator.stepContext!.getAll("initial.test");
  assertEquals(handoff?.summary, "important finding");
});

// =============================================================================
// setSchemaResolutionFailed
// =============================================================================

Deno.test("FlowOrchestrator - setSchemaResolutionFailed toggles routing skip", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry, { withRouting: true });
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  const summary = createSummary({
    structuredOutput: { next_action: { action: "next" } },
  });

  // With flag set, routing is skipped
  orchestrator.setSchemaResolutionFailed(true);
  assertEquals(
    orchestrator.handleStepTransition("initial.test", summary, ctx),
    null,
  );

  // Clear flag, routing proceeds
  orchestrator.setSchemaResolutionFailed(false);
  const result = orchestrator.handleStepTransition(
    "initial.test",
    summary,
    ctx,
  );
  assertEquals(result !== null, true);
});

// =============================================================================
// End-to-end: multi-step flow through orchestrator
// =============================================================================

Deno.test("FlowOrchestrator - full issue flow: initial -> continuation -> closure", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry, { withRouting: true });
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  orchestrator.initializeStepContext();

  // Iteration 1: initial.test -> "next" -> continuation.test
  assertEquals(orchestrator.getStepIdForIteration(1), "initial.test");
  const s1 = createSummary({
    iteration: 1,
    structuredOutput: {
      next_action: { action: "next", reason: "Analyzed" },
      analysis: { summary: "ready" },
    },
  });
  orchestrator.recordStepOutput("initial.test", s1, ctx);
  const r1 = orchestrator.handleStepTransition("initial.test", s1, ctx);
  assertEquals(r1!.nextStepId, "continuation.test");
  assertEquals(r1!.signalCompletion, false);

  // Iteration 2: continuation.test -> "handoff" -> closure.test
  assertEquals(orchestrator.getStepIdForIteration(2), "continuation.test");
  const s2 = createSummary({
    iteration: 2,
    structuredOutput: {
      next_action: { action: "handoff", reason: "Work done" },
      progress: { files: ["main.ts"] },
    },
  });
  orchestrator.recordStepOutput("continuation.test", s2, ctx);
  const r2 = orchestrator.handleStepTransition("continuation.test", s2, ctx);
  assertEquals(r2!.nextStepId, "closure.test");
  assertEquals(r2!.signalCompletion, false);

  // Iteration 3: closure.test -> "closing" -> completion
  assertEquals(orchestrator.getStepIdForIteration(3), "closure.test");
  const s3 = createSummary({
    iteration: 3,
    structuredOutput: {
      next_action: { action: "closing", reason: "All checks pass" },
    },
  });
  orchestrator.recordStepOutput("closure.test", s3, ctx);
  const r3 = orchestrator.handleStepTransition("closure.test", s3, ctx);
  assertEquals(r3!.signalCompletion, true);

  // Verify step context accumulated outputs
  assertEquals(
    orchestrator.stepContext!.getAll("initial.test") !== undefined,
    true,
  );
  assertEquals(
    orchestrator.stepContext!.getAll("continuation.test") !== undefined,
    true,
  );
  assertEquals(
    orchestrator.stepContext!.getAll("closure.test") !== undefined,
    true,
  );
});

Deno.test("FlowOrchestrator - repeat intent keeps same step", async () => {
  const registry = await loadFixtureRegistry();
  const deps = buildDeps(registry, { withRouting: true });
  const orchestrator = new FlowOrchestrator(deps);
  const ctx = createMockContext();

  orchestrator.initializeStepContext();

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "repeat", reason: "Need more analysis" },
    },
  });

  const result = orchestrator.handleStepTransition(
    "initial.test",
    summary,
    ctx,
  );
  assertEquals(result!.nextStepId, "initial.test");
  assertEquals(result!.signalCompletion, false);
  // currentStepId should remain initial.test (repeat stays)
  assertEquals(orchestrator.currentStepId, "initial.test");
});
