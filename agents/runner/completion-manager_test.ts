/**
 * CompletionManager Unit Tests
 *
 * Tests for completion detection, validation routing, and step ID resolution.
 * Exercises the synchronous/lightweight methods directly without loading
 * the real steps registry from disk.
 *
 * @design_ref tmp/agent_runner_tests/evaluation.md (Completion management row)
 */

import { assertEquals } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import {
  CompletionManager,
  type CompletionManagerDeps,
} from "./completion-manager.ts";

const logger = new BreakdownLogger("completion");
import { CompletionChain } from "./completion-chain.ts";
import { StepGateInterpreter } from "./step-gate-interpreter.ts";
import { WorkflowRouter } from "./workflow-router.ts";
import type { ExtendedStepsRegistry } from "../common/completion-types.ts";
import type { StepRegistry } from "../common/step-registry.ts";
import type { AgentDefinition, IterationSummary } from "../src_common/types.ts";
import type { CompletionType } from "../src_common/types/completion.ts";
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
  completionType: CompletionType = "externalState",
): AgentDefinition {
  return {
    name: "test-completion",
    displayName: "Test Completion Agent",
    description: "Fixture agent for CompletionManager tests",
    version: "1.0.0",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "./prompts/system.md",
        prompts: { registry: "steps_registry.json", fallbackDir: "./prompts" },
      },
      completion: {
        type: completionType,
        config: { maxIterations: 10 },
      },
      boundaries: {
        allowedTools: [],
        permissionMode: "plan",
      },
      execution: {},
      telemetry: {
        logging: { directory: "/tmp/claude/test-logs", format: "jsonl" },
      },
    },
  };
}

function createMockDeps(
  completionType: CompletionType = "externalState",
): CompletionManagerDeps {
  return {
    definition: createTestDefinition(completionType),
    dependencies: {
      loggerFactory: { create: () => Promise.resolve({} as never) },
      completionHandlerFactory: { create: () => Promise.resolve({} as never) },
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
// hasAICompletionDeclaration
// =============================================================================

Deno.test("CompletionManager - hasAICompletionDeclaration detects closing intent", () => {
  const manager = new CompletionManager(createMockDeps());

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "closing", reason: "Done" },
    },
  });

  logger.debug("hasAICompletionDeclaration input", {
    structuredOutput: summary.structuredOutput,
  });
  const result = manager.hasAICompletionDeclaration(summary);
  logger.debug("hasAICompletionDeclaration result", { result });
  assertEquals(result, true);
});

Deno.test("CompletionManager - hasAICompletionDeclaration detects complete intent (backward compat)", () => {
  const manager = new CompletionManager(createMockDeps());

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "complete", reason: "All tasks finished" },
    },
  });

  assertEquals(manager.hasAICompletionDeclaration(summary), true);
});

Deno.test("CompletionManager - hasAICompletionDeclaration returns false for next intent", () => {
  const manager = new CompletionManager(createMockDeps());

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "next", reason: "More work" },
    },
  });

  assertEquals(manager.hasAICompletionDeclaration(summary), false);
});

Deno.test("CompletionManager - hasAICompletionDeclaration returns false for repeat intent", () => {
  const manager = new CompletionManager(createMockDeps());

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "repeat", reason: "Retry needed" },
    },
  });

  assertEquals(manager.hasAICompletionDeclaration(summary), false);
});

Deno.test("CompletionManager - hasAICompletionDeclaration returns false for handoff intent", () => {
  const manager = new CompletionManager(createMockDeps());

  const summary = createSummary({
    structuredOutput: {
      next_action: { action: "handoff", reason: "Ready for closure" },
    },
  });

  assertEquals(manager.hasAICompletionDeclaration(summary), false);
});

Deno.test("CompletionManager - hasAICompletionDeclaration returns false without structured output", () => {
  const manager = new CompletionManager(createMockDeps());

  const summary = createSummary();

  assertEquals(manager.hasAICompletionDeclaration(summary), false);
});

Deno.test("CompletionManager - hasAICompletionDeclaration returns false when next_action is not an object", () => {
  const manager = new CompletionManager(createMockDeps());

  const summary = createSummary({
    structuredOutput: {
      next_action: "closing", // string, not object
    },
  });

  assertEquals(manager.hasAICompletionDeclaration(summary), false);
});

Deno.test("CompletionManager - hasAICompletionDeclaration returns false for status:completed (not a completion signal)", () => {
  const manager = new CompletionManager(createMockDeps());

  // Per completion-manager.ts: status: "completed" is NOT a completion signal
  const summary = createSummary({
    structuredOutput: {
      status: "completed",
      next_action: { action: "next" },
    },
  });

  assertEquals(manager.hasAICompletionDeclaration(summary), false);
});

// =============================================================================
// getCompletionStepId
// =============================================================================

Deno.test("CompletionManager - getCompletionStepId defaults to closure.issue without registry", () => {
  const manager = new CompletionManager(createMockDeps("externalState"));

  // Without CompletionChain, falls back to hardcoded "closure.issue"
  assertEquals(manager.getCompletionStepId(), "closure.issue");
});

Deno.test("CompletionManager - getCompletionStepId delegates to CompletionChain when available", async () => {
  const registry = await loadFixtureRegistry();
  const manager = new CompletionManager(createMockDeps("externalState"));
  const mockLogger = createMockLogger();

  // Manually wire CompletionChain (simulating what initializeCompletionValidation does)
  manager.completionChain = new CompletionChain({
    workingDir: "/tmp/claude/test",
    logger: mockLogger,
    stepsRegistry: registry,
    completionValidator: null,
    retryHandler: null,
    agentId: "test-completion",
  });
  manager.stepsRegistry = registry;

  // CompletionChain looks up closure.{completionType} in registry's completionSteps
  logger.debug("getCompletionStepId input", {
    completionType: "externalState",
  });
  const stepId = manager.getCompletionStepId();
  logger.debug("getCompletionStepId result", { stepId });
  assertEquals(stepId, "closure.externalState");
});

// =============================================================================
// hasFlowRoutingEnabled
// =============================================================================

Deno.test("CompletionManager - hasFlowRoutingEnabled returns false initially", () => {
  const manager = new CompletionManager(createMockDeps());

  assertEquals(manager.hasFlowRoutingEnabled(), false);
});

Deno.test("CompletionManager - hasFlowRoutingEnabled returns true when components are set", async () => {
  const registry = await loadFixtureRegistry();
  const manager = new CompletionManager(createMockDeps());

  // Manually wire routing components
  manager.stepGateInterpreter = new StepGateInterpreter();
  manager.workflowRouter = new WorkflowRouter(
    registry as unknown as StepRegistry,
  );

  assertEquals(manager.hasFlowRoutingEnabled(), true);
});

Deno.test("CompletionManager - hasFlowRoutingEnabled returns false if only interpreter is set", () => {
  const manager = new CompletionManager(createMockDeps());

  manager.stepGateInterpreter = new StepGateInterpreter();
  // workflowRouter still null

  assertEquals(manager.hasFlowRoutingEnabled(), false);
});

// =============================================================================
// validateCompletionConditions
// =============================================================================

Deno.test("CompletionManager - validateCompletionConditions returns valid when no registry", async () => {
  const manager = new CompletionManager(createMockDeps());
  const mockLogger = createMockLogger();

  const summary = createSummary({
    structuredOutput: { next_action: { action: "closing" } },
  });

  logger.debug("validateCompletionConditions input", {
    stepId: "closure.test",
  });
  const result = await manager.validateCompletionConditions(
    "closure.test",
    summary,
    mockLogger,
  );
  logger.debug("validateCompletionConditions result", { valid: result.valid });
  assertEquals(result.valid, true);
});

Deno.test("CompletionManager - validateCompletionConditions returns valid for unknown step", async () => {
  const registry = await loadFixtureRegistry();
  const manager = new CompletionManager(createMockDeps());
  manager.stepsRegistry = registry;
  const mockLogger = createMockLogger();

  const summary = createSummary();

  // Step not in completionSteps
  const result = await manager.validateCompletionConditions(
    "nonexistent.step",
    summary,
    mockLogger,
  );
  assertEquals(result.valid, true);
});

Deno.test("CompletionManager - validateCompletionConditions delegates to CompletionChain", async () => {
  const registry = await loadFixtureRegistry();
  const manager = new CompletionManager(createMockDeps());
  const mockLogger = createMockLogger();

  manager.stepsRegistry = registry;

  // Wire a CompletionChain with no validator (will return valid)
  manager.completionChain = new CompletionChain({
    workingDir: "/tmp/claude/test",
    logger: mockLogger,
    stepsRegistry: registry,
    completionValidator: null,
    retryHandler: null,
    agentId: "test-completion",
  });

  const summary = createSummary();

  // closure.test exists in completionSteps, CompletionChain handles validation
  const result = await manager.validateCompletionConditions(
    "closure.test",
    summary,
    mockLogger,
  );
  assertEquals(result.valid, true);
});

// =============================================================================
// CompletionChain.getCompletionStepId
// =============================================================================

Deno.test("CompletionChain - getCompletionStepId returns closure.{type} for known types", async () => {
  const registry = await loadFixtureRegistry();
  const mockLogger = createMockLogger();

  const chain = new CompletionChain({
    workingDir: "/tmp/claude/test",
    logger: mockLogger,
    stepsRegistry: registry,
    completionValidator: null,
    retryHandler: null,
    agentId: "test",
  });

  // closure.test is in the registry's completionSteps
  // But getCompletionStepId looks for closure.{completionType}
  assertEquals(chain.getCompletionStepId("issue"), "closure.issue");
  assertEquals(chain.getCompletionStepId("iterate"), "closure.iterate");
  assertEquals(
    chain.getCompletionStepId("externalState"),
    "closure.externalState",
  );
});

Deno.test("CompletionChain - getCompletionStepId finds step from completionSteps", async () => {
  // Build a registry where completionSteps has a known key
  const registry: ExtendedStepsRegistry = {
    agentId: "test",
    version: "1.0.0",
    c1: "steps",
    steps: {},
    completionSteps: {
      "closure.mytype": {
        stepId: "closure.mytype",
        name: "My Completion",
        c2: "retry",
        c3: "mytype",
        completionConditions: [],
        onFailure: { action: "retry" },
      },
    },
  };
  const mockLogger = createMockLogger();

  const chain = new CompletionChain({
    workingDir: "/tmp/claude/test",
    logger: mockLogger,
    stepsRegistry: registry,
    completionValidator: null,
    retryHandler: null,
    agentId: "test",
  });

  assertEquals(chain.getCompletionStepId("mytype"), "closure.mytype");
});

// =============================================================================
// CompletionChain.validate
// =============================================================================

Deno.test("CompletionChain - validate returns valid when no step config", async () => {
  const registry = await loadFixtureRegistry();
  const mockLogger = createMockLogger();

  const chain = new CompletionChain({
    workingDir: "/tmp/claude/test",
    logger: mockLogger,
    stepsRegistry: registry,
    completionValidator: null,
    retryHandler: null,
    agentId: "test",
  });

  const summary = createSummary();

  // "unknown.step" has no completionSteps entry
  const result = await chain.validate("unknown.step", summary);
  assertEquals(result.valid, true);
});

Deno.test("CompletionChain - validate returns valid when validator is null and conditions exist", async () => {
  const registry = await loadFixtureRegistry();
  const mockLogger = createMockLogger();

  const chain = new CompletionChain({
    workingDir: "/tmp/claude/test",
    logger: mockLogger,
    stepsRegistry: registry,
    completionValidator: null, // No validator
    retryHandler: null,
    agentId: "test",
  });

  const summary = createSummary();

  // "closure.test" has completionConditions but no outputSchema
  // Without a validator, it returns valid (graceful fallback)
  const result = await chain.validate("closure.test", summary);
  assertEquals(result.valid, true);
});
