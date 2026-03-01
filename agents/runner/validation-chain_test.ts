/**
 * Tests for CompletionChain
 *
 * Covers validate(), getCompletionStepId(), and getStepIdForIteration().
 */

import { assertEquals } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { CompletionChain } from "./completion-chain.ts";
import type { ExtendedStepsRegistry } from "../common/completion-types.ts";
import type { IterationSummary } from "../src_common/types.ts";
import type { Logger } from "../src_common/logger.ts";

const logger = new BreakdownLogger("chain");

// =============================================================================
// Helpers
// =============================================================================

function createMockLogger(): Logger {
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
  } as unknown as Logger;
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

function createFixtureRegistry(): ExtendedStepsRegistry {
  return {
    agentId: "test",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "initial.test": {
        stepId: "initial.test",
        name: "Initial",
        c2: "initial",
        c3: "test",
        edition: "default",
        fallbackKey: "initial_test",
        uvVariables: [],
        usesStdin: false,
      },
      "continuation.test": {
        stepId: "continuation.test",
        name: "Continuation",
        c2: "continuation",
        c3: "test",
        edition: "default",
        fallbackKey: "continuation_test",
        uvVariables: [],
        usesStdin: false,
      },
    },
    completionSteps: {
      "closure.issue": {
        stepId: "closure.issue",
        name: "Issue Closure",
        c2: "closure",
        c3: "issue",
        completionConditions: [{
          validator: "command",
          params: { command: "echo ok" },
        }],
        onFailure: { action: "retry" },
      },
      "closure.externalState": {
        stepId: "closure.externalState",
        name: "External State Closure",
        c2: "closure",
        c3: "externalState",
        completionConditions: [],
        onFailure: { action: "retry" },
      },
    },
  };
}

function createChain(
  registry: ExtendedStepsRegistry | null = createFixtureRegistry(),
): CompletionChain {
  return new CompletionChain({
    workingDir: "/tmp/claude/test",
    logger: createMockLogger(),
    stepsRegistry: registry,
    completionValidator: null,
    retryHandler: null,
    agentId: "test",
  });
}

// =============================================================================
// validate Tests
// =============================================================================

Deno.test("CompletionChain - validate returns valid when no step config", async () => {
  const chain = createChain();
  const summary = createSummary();

  logger.debug("validate input", { stepId: "unknown.step" });
  const result = await chain.validate("unknown.step", summary);
  logger.debug("validate result", { valid: result.valid });

  assertEquals(result.valid, true);
});

Deno.test("CompletionChain - validate returns valid when outputSchema defers to runner", async () => {
  const registry = createFixtureRegistry();
  registry.completionSteps!["closure.schema"] = {
    stepId: "closure.schema",
    name: "Schema Closure",
    c2: "closure",
    c3: "schema",
    completionConditions: [],
    onFailure: { action: "retry" },
    outputSchema: { type: "object" },
  };
  const chain = createChain(registry);
  const summary = createSummary();

  const result = await chain.validate("closure.schema", summary);

  assertEquals(result.valid, true);
});

Deno.test("CompletionChain - validate returns valid when no validator available", async () => {
  const chain = createChain();
  const summary = createSummary();

  // closure.issue has conditions but no validator
  const result = await chain.validate("closure.issue", summary);

  assertEquals(result.valid, true);
});

Deno.test("CompletionChain - validate returns valid for step with empty conditions", async () => {
  const chain = createChain();
  const summary = createSummary();

  // closure.externalState has empty completionConditions
  const result = await chain.validate("closure.externalState", summary);

  assertEquals(result.valid, true);
});

// =============================================================================
// getCompletionStepId Tests
// =============================================================================

Deno.test("CompletionChain - getCompletionStepId returns registry step for known type", () => {
  const chain = createChain();

  logger.debug("getCompletionStepId input", { completionType: "issue" });
  const stepId = chain.getCompletionStepId("issue");
  logger.debug("getCompletionStepId result", { stepId });

  assertEquals(stepId, "closure.issue");
});

Deno.test("CompletionChain - getCompletionStepId returns closure.externalState", () => {
  const chain = createChain();

  const stepId = chain.getCompletionStepId("externalState");

  assertEquals(stepId, "closure.externalState");
});

Deno.test("CompletionChain - getCompletionStepId type defaults for iterate", () => {
  const chain = createChain();

  assertEquals(chain.getCompletionStepId("iterate"), "closure.iterate");
  assertEquals(chain.getCompletionStepId("iterationBudget"), "closure.iterate");
});

Deno.test("CompletionChain - getCompletionStepId falls back to closure.{type}", () => {
  const chain = createChain();

  const stepId = chain.getCompletionStepId("custom");

  assertEquals(stepId, "closure.custom");
});

// =============================================================================
// getStepIdForIteration Tests
// =============================================================================

Deno.test("CompletionChain - getStepIdForIteration maps iteration to step", () => {
  const chain = createChain();

  logger.debug("getStepIdForIteration input", { iteration: 1 });
  const stepId = chain.getStepIdForIteration(1);
  logger.debug("getStepIdForIteration result", { stepId });

  assertEquals(stepId, "initial.test");
});

Deno.test("CompletionChain - getStepIdForIteration clamps to last step", () => {
  const chain = createChain();

  // iteration 3 exceeds 2 steps, should clamp to last
  const stepId = chain.getStepIdForIteration(10);

  assertEquals(stepId, "continuation.test");
});

Deno.test("CompletionChain - getStepIdForIteration without registry falls back", () => {
  const chain = createChain(null);

  const stepId = chain.getStepIdForIteration(1);

  assertEquals(stepId, "step.1");
});
