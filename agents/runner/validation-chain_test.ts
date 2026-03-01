/**
 * Tests for ValidationChain
 *
 * Covers validate(), getClosureStepId(), and getStepIdForIteration().
 */

import { assertEquals } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { ValidationChain } from "./validation-chain.ts";
import type { ExtendedStepsRegistry } from "../common/validation-types.ts";
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
    validationSteps: {
      "closure.issue": {
        stepId: "closure.issue",
        name: "Issue Closure",
        c2: "closure",
        c3: "issue",
        validationConditions: [{
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
        validationConditions: [],
        onFailure: { action: "retry" },
      },
    },
  };
}

function createChain(
  registry: ExtendedStepsRegistry | null = createFixtureRegistry(),
): ValidationChain {
  return new ValidationChain({
    workingDir: "/tmp/claude/test",
    logger: createMockLogger(),
    stepsRegistry: registry,
    stepValidator: null,
    retryHandler: null,
    agentId: "test",
  });
}

// =============================================================================
// validate Tests
// =============================================================================

Deno.test("ValidationChain - validate returns valid when no step config", async () => {
  const chain = createChain();
  const summary = createSummary();

  logger.debug("validate input", { stepId: "unknown.step" });
  const result = await chain.validate("unknown.step", summary);
  logger.debug("validate result", { valid: result.valid });

  assertEquals(result.valid, true);
});

Deno.test("ValidationChain - validate returns valid when outputSchema defers to runner", async () => {
  const registry = createFixtureRegistry();
  registry.validationSteps!["closure.schema"] = {
    stepId: "closure.schema",
    name: "Schema Closure",
    c2: "closure",
    c3: "schema",
    validationConditions: [],
    onFailure: { action: "retry" },
    outputSchema: { type: "object" },
  };
  const chain = createChain(registry);
  const summary = createSummary();

  const result = await chain.validate("closure.schema", summary);

  assertEquals(result.valid, true);
});

Deno.test("ValidationChain - validate returns valid when no validator available", async () => {
  const chain = createChain();
  const summary = createSummary();

  // closure.issue has conditions but no validator
  const result = await chain.validate("closure.issue", summary);

  assertEquals(result.valid, true);
});

Deno.test("ValidationChain - validate returns valid for step with empty conditions", async () => {
  const chain = createChain();
  const summary = createSummary();

  // closure.externalState has empty completionConditions
  const result = await chain.validate("closure.externalState", summary);

  assertEquals(result.valid, true);
});

// =============================================================================
// getClosureStepId Tests
// =============================================================================

Deno.test("ValidationChain - getClosureStepId returns registry step for known type", () => {
  const chain = createChain();

  logger.debug("getClosureStepId input", { verdictType: "issue" });
  const stepId = chain.getClosureStepId("issue");
  logger.debug("getClosureStepId result", { stepId });

  assertEquals(stepId, "closure.issue");
});

Deno.test("ValidationChain - getClosureStepId returns closure.externalState", () => {
  const chain = createChain();

  const stepId = chain.getClosureStepId("externalState");

  assertEquals(stepId, "closure.externalState");
});

Deno.test("ValidationChain - getClosureStepId type defaults for iterate", () => {
  const chain = createChain();

  assertEquals(chain.getClosureStepId("iterate"), "closure.iterate");
  assertEquals(chain.getClosureStepId("iterationBudget"), "closure.iterate");
});

Deno.test("ValidationChain - getClosureStepId falls back to closure.{type}", () => {
  const chain = createChain();

  const stepId = chain.getClosureStepId("custom");

  assertEquals(stepId, "closure.custom");
});

// =============================================================================
// getStepIdForIteration Tests
// =============================================================================

Deno.test("ValidationChain - getStepIdForIteration maps iteration to step", () => {
  const chain = createChain();

  logger.debug("getStepIdForIteration input", { iteration: 1 });
  const stepId = chain.getStepIdForIteration(1);
  logger.debug("getStepIdForIteration result", { stepId });

  assertEquals(stepId, "initial.test");
});

Deno.test("ValidationChain - getStepIdForIteration clamps to last step", () => {
  const chain = createChain();

  // iteration 3 exceeds 2 steps, should clamp to last
  const stepId = chain.getStepIdForIteration(10);

  assertEquals(stepId, "continuation.test");
});

Deno.test("ValidationChain - getStepIdForIteration without registry falls back", () => {
  const chain = createChain(null);

  const stepId = chain.getStepIdForIteration(1);

  assertEquals(stepId, "step.1");
});
