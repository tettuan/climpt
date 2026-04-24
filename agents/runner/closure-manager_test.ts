/**
 * ClosureManager Unit Tests
 *
 * Tests for verdict detection, validation routing, and step ID resolution.
 * Exercises the synchronous/lightweight methods directly without loading
 * the real steps registry from disk.
 *
 * @design_ref tmp/agent_runner_tests/evaluation.md (Closure management row)
 */

import { assertEquals } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { ClosureManager, type ClosureManagerDeps } from "./closure-manager.ts";

const logger = new BreakdownLogger("completion");
import { ValidationChain } from "./validation-chain.ts";
import { StepGateInterpreter } from "./step-gate-interpreter.ts";
import { WorkflowRouter } from "./workflow-router.ts";
import type { ExtendedStepsRegistry } from "../common/validation-types.ts";
import type { StepRegistry } from "../common/step-registry.ts";
import type { AgentDefinition, IterationSummary } from "../src_common/types.ts";
import type { VerdictType } from "../src_common/types/verdict.ts";
import type { AgentDependencies } from "./builder.ts";

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

function createTestDefinition(
  verdictType: VerdictType = "poll:state",
): AgentDefinition {
  return {
    name: "test-completion",
    displayName: "Test Verdict Agent",
    description: "Fixture agent for ClosureManager tests",
    version: "1.0.0",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "./prompts/system.md",
        prompts: { registry: "steps_registry.json", fallbackDir: "./prompts" },
      },
      verdict: {
        type: verdictType,
        config: { maxIterations: 10 },
      },
      execution: {},
      logging: { directory: "/tmp/claude/test-logs", format: "jsonl" },
    },
  };
}

function createMockDeps(
  verdictType: VerdictType = "poll:state",
): ClosureManagerDeps {
  return {
    definition: createTestDefinition(verdictType),
    dependencies: {
      loggerFactory: { create: () => Promise.resolve({} as never) },
      verdictHandlerFactory: { create: () => Promise.resolve({} as never) },
      promptResolverFactory: { create: () => Promise.resolve({} as never) },
    } as AgentDependencies,
  };
}

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
  } as unknown as import("../src_common/logger.ts").Logger;
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
// hasAIVerdictDeclaration
// =============================================================================

Deno.test("ClosureManager - hasAIVerdictDeclaration detects closing intent", () => {
  const manager = new ClosureManager(createMockDeps());

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "closing", reason: "Done" },
    },
  });

  logger.debug("hasAIVerdictDeclaration input", {
    structuredOutput: summary.structuredOutput,
  });
  const result = manager.hasAIVerdictDeclaration(summary);
  logger.debug("hasAIVerdictDeclaration result", { result });
  assertEquals(result, true);
});

Deno.test("ClosureManager - hasAIVerdictDeclaration rejects 'complete' action", () => {
  const manager = new ClosureManager(createMockDeps());

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "complete", reason: "All tasks finished" },
    },
  });

  assertEquals(manager.hasAIVerdictDeclaration(summary), false);
});

Deno.test("ClosureManager - hasAIVerdictDeclaration returns false for next intent", () => {
  const manager = new ClosureManager(createMockDeps());

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "next", reason: "More work" },
    },
  });

  assertEquals(manager.hasAIVerdictDeclaration(summary), false);
});

Deno.test("ClosureManager - hasAIVerdictDeclaration returns false for repeat intent", () => {
  const manager = new ClosureManager(createMockDeps());

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "repeat", reason: "Retry needed" },
    },
  });

  assertEquals(manager.hasAIVerdictDeclaration(summary), false);
});

Deno.test("ClosureManager - hasAIVerdictDeclaration returns false for handoff intent", () => {
  const manager = new ClosureManager(createMockDeps());

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "handoff", reason: "Ready for closure" },
    },
  });

  assertEquals(manager.hasAIVerdictDeclaration(summary), false);
});

Deno.test("ClosureManager - hasAIVerdictDeclaration returns false without structured output", () => {
  const manager = new ClosureManager(createMockDeps());

  const summary = createSummary();

  assertEquals(manager.hasAIVerdictDeclaration(summary), false);
});

Deno.test("ClosureManager - hasAIVerdictDeclaration returns false when next_action is not an object", () => {
  const manager = new ClosureManager(createMockDeps());

  const summary = createSummary({
    structuredOutput: {
      next_action: "closing", // string, not object
    },
  });

  assertEquals(manager.hasAIVerdictDeclaration(summary), false);
});

Deno.test("ClosureManager - hasAIVerdictDeclaration returns false for status:completed (not a verdict signal)", () => {
  const manager = new ClosureManager(createMockDeps());

  // Per closure-manager.ts: status: "completed" is NOT a verdict signal
  const summary = createSummary({
    structuredOutput: {
      status: "completed",
      next_action: { action: "next" },
    },
  });

  assertEquals(manager.hasAIVerdictDeclaration(summary), false);
});

// =============================================================================
// getClosureStepId
// =============================================================================

Deno.test("ClosureManager - getClosureStepId defaults to closure.issue without registry", () => {
  const manager = new ClosureManager(createMockDeps("poll:state"));

  // Without ValidationChain, falls back to hardcoded "closure.issue"
  assertEquals(manager.getClosureStepId(), "closure.issue");
});

Deno.test("ClosureManager - getClosureStepId delegates to ValidationChain when available", async () => {
  const registry = await loadFixtureRegistry();
  const manager = new ClosureManager(createMockDeps("poll:state"));
  const mockLogger = createMockLogger();

  // Manually wire ValidationChain (simulating what initializeValidation does)
  manager.validationChain = new ValidationChain({
    workingDir: "/tmp/claude/test",
    logger: mockLogger,
    stepsRegistry: registry,
    stepValidator: null,
    retryHandler: null,
    agentId: "test-completion",
  });
  manager.stepsRegistry = registry;

  // ValidationChain looks up closure.{verdictType} in registry's validationSteps
  logger.debug("getClosureStepId input", {
    verdictType: "poll:state",
  });
  const stepId = manager.getClosureStepId();
  logger.debug("getClosureStepId result", { stepId });
  assertEquals(stepId, "closure.polling");
});

// =============================================================================
// hasFlowRoutingEnabled
// =============================================================================

Deno.test("ClosureManager - hasFlowRoutingEnabled returns false initially", () => {
  const manager = new ClosureManager(createMockDeps());

  assertEquals(manager.hasFlowRoutingEnabled(), false);
});

Deno.test("ClosureManager - hasFlowRoutingEnabled returns true when components are set", async () => {
  const registry = await loadFixtureRegistry();
  const manager = new ClosureManager(createMockDeps());

  // Manually wire routing components
  manager.stepGateInterpreter = new StepGateInterpreter();
  manager.workflowRouter = new WorkflowRouter(
    registry as unknown as StepRegistry,
  );

  assertEquals(manager.hasFlowRoutingEnabled(), true);
});

Deno.test("ClosureManager - hasFlowRoutingEnabled returns false if only interpreter is set", () => {
  const manager = new ClosureManager(createMockDeps());

  manager.stepGateInterpreter = new StepGateInterpreter();
  // workflowRouter still null

  assertEquals(manager.hasFlowRoutingEnabled(), false);
});

// =============================================================================
// validateConditions
// =============================================================================

Deno.test("ClosureManager - validateConditions returns valid when no registry", async () => {
  const manager = new ClosureManager(createMockDeps());
  const mockLogger = createMockLogger();

  const summary = createSummary({
    structuredOutput: { next_action: { action: "closing" } },
  });

  logger.debug("validateConditions input", {
    stepId: "closure.test",
  });
  const result = await manager.validateConditions(
    "closure.test",
    summary,
    mockLogger,
  );
  logger.debug("validateConditions result", { valid: result.valid });
  assertEquals(result.valid, true);
});

Deno.test("ClosureManager - validateConditions returns valid for unknown step", async () => {
  const registry = await loadFixtureRegistry();
  const manager = new ClosureManager(createMockDeps());
  manager.stepsRegistry = registry;
  const mockLogger = createMockLogger();

  const summary = createSummary();

  // Step not in validationSteps
  const result = await manager.validateConditions(
    "nonexistent.step",
    summary,
    mockLogger,
  );
  assertEquals(result.valid, true);
});

Deno.test("ClosureManager - validateConditions delegates to ValidationChain", async () => {
  const registry = await loadFixtureRegistry();
  const manager = new ClosureManager(createMockDeps());
  const mockLogger = createMockLogger();

  manager.stepsRegistry = registry;

  // Wire a ValidationChain with no validator (will return valid)
  manager.validationChain = new ValidationChain({
    workingDir: "/tmp/claude/test",
    logger: mockLogger,
    stepsRegistry: registry,
    stepValidator: null,
    retryHandler: null,
    agentId: "test-completion",
  });

  const summary = createSummary();

  // closure.test exists in validationSteps, ValidationChain handles validation
  const result = await manager.validateConditions(
    "closure.test",
    summary,
    mockLogger,
  );
  assertEquals(result.valid, true);
});

// =============================================================================
// ValidationChain.getClosureStepId
// =============================================================================

Deno.test("ValidationChain - getClosureStepId returns closure.{type} for known types", async () => {
  const registry = await loadFixtureRegistry();
  const mockLogger = createMockLogger();

  const chain = new ValidationChain({
    workingDir: "/tmp/claude/test",
    logger: mockLogger,
    stepsRegistry: registry,
    stepValidator: null,
    retryHandler: null,
    agentId: "test",
  });

  // closure.test is in the registry's validationSteps
  // But getClosureStepId looks for closure.{verdictType}
  assertEquals(chain.getClosureStepId("issue"), "closure.issue");
  assertEquals(chain.getClosureStepId("count:iteration"), "closure.iteration");
  assertEquals(
    chain.getClosureStepId("poll:state"),
    "closure.polling",
  );
});

Deno.test("ValidationChain - getClosureStepId finds step from validationSteps", async () => {
  // Build a registry where validationSteps has a known key
  const registry: ExtendedStepsRegistry = {
    agentId: "test",
    version: "1.0.0",
    c1: "steps",
    steps: {},
    validationSteps: {
      "closure.mytype": {
        stepId: "closure.mytype",
        name: "My Closure",
        c2: "retry",
        c3: "mytype",
        preflightConditions: [],
        postLLMConditions: [],
        onFailure: { action: "retry" },
      },
    },
  };
  const mockLogger = createMockLogger();

  const chain = new ValidationChain({
    workingDir: "/tmp/claude/test",
    logger: mockLogger,
    stepsRegistry: registry,
    stepValidator: null,
    retryHandler: null,
    agentId: "test",
  });

  assertEquals(chain.getClosureStepId("mytype"), "closure.mytype");
});

// =============================================================================
// ValidationChain.validate
// =============================================================================

Deno.test("ValidationChain - validate returns valid when no step config", async () => {
  const registry = await loadFixtureRegistry();
  const mockLogger = createMockLogger();

  const chain = new ValidationChain({
    workingDir: "/tmp/claude/test",
    logger: mockLogger,
    stepsRegistry: registry,
    stepValidator: null,
    retryHandler: null,
    agentId: "test",
  });

  const summary = createSummary();

  // "unknown.step" has no validationSteps entry
  const result = await chain.validate("unknown.step", summary);
  assertEquals(result.valid, true);
});

Deno.test("ValidationChain - validate returns valid when validator is null and conditions exist", async () => {
  const registry = await loadFixtureRegistry();
  const mockLogger = createMockLogger();

  const chain = new ValidationChain({
    workingDir: "/tmp/claude/test",
    logger: mockLogger,
    stepsRegistry: registry,
    stepValidator: null, // No validator
    retryHandler: null,
    agentId: "test",
  });

  const summary = createSummary();

  // "closure.test" has completionConditions but no outputSchema
  // Without a validator, it returns valid (graceful fallback)
  const result = await chain.validate("closure.test", summary);
  assertEquals(result.valid, true);
});
