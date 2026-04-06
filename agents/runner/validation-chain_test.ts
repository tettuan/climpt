/**
 * Tests for ValidationChain
 *
 * Covers validate(), getClosureStepId(), and getStepIdForIteration().
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { ValidationChain } from "./validation-chain.ts";
import type {
  ExtendedStepsRegistry,
  ValidationCondition,
  ValidationStepConfig,
  ValidatorResult,
} from "../common/validation-types.ts";
import type { IterationSummary } from "../src_common/types.ts";
import type { Logger } from "../src_common/logger.ts";
import type { StepValidator } from "../validators/step/validator.ts";
import type { RetryHandler } from "../retry/retry-handler.ts";

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
      "closure.polling": {
        stepId: "closure.polling",
        name: "External State Closure",
        c2: "closure",
        c3: "polling",
        validationConditions: [],
        onFailure: { action: "retry" },
      },
    },
  };
}

/**
 * Create a mock StepValidator that returns the given result for any call.
 */
function createMockStepValidator(
  result: ValidatorResult,
): StepValidator {
  return {
    validate: (_conditions: ValidationCondition[]) => Promise.resolve(result),
  } as unknown as StepValidator;
}

/**
 * Create a mock RetryHandler that returns the given prompt string.
 */
function createMockRetryHandler(prompt: string): RetryHandler {
  return {
    buildRetryPrompt: (
      _stepConfig: ValidationStepConfig,
      _result: ValidatorResult,
    ) => Promise.resolve(prompt),
    getPattern: () => undefined,
  } as unknown as RetryHandler;
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

/**
 * Create a ValidationChain with injected stepValidator and optional retryHandler.
 */
function createChainWithValidator(
  stepValidator: StepValidator,
  retryHandler: RetryHandler | null = null,
  registry: ExtendedStepsRegistry = createFixtureRegistry(),
): ValidationChain {
  return new ValidationChain({
    workingDir: "/tmp/claude/test",
    logger: createMockLogger(),
    stepsRegistry: registry,
    stepValidator,
    retryHandler,
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

  // closure.polling has empty completionConditions
  const result = await chain.validate("closure.polling", summary);

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

Deno.test("ValidationChain - getClosureStepId returns closure.polling for poll:state", () => {
  const chain = createChain();

  const stepId = chain.getClosureStepId("poll:state");

  assertEquals(stepId, "closure.polling");
});

Deno.test("ValidationChain - getClosureStepId returns closure.iteration for count:iteration", () => {
  const chain = createChain();

  assertEquals(chain.getClosureStepId("count:iteration"), "closure.iteration");
});

Deno.test("ValidationChain - getClosureStepId falls back to closure.{type}", () => {
  const chain = createChain();

  const stepId = chain.getClosureStepId("meta:custom");

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

// =============================================================================
// Rejection Tests - validate returns valid: false
// =============================================================================

Deno.test("ValidationChain - validate returns invalid when stepValidator rejects (no retryHandler)", async () => {
  const failResult: ValidatorResult = {
    valid: false,
    pattern: "git-dirty",
    error: "working tree has uncommitted changes",
  };
  const validator = createMockStepValidator(failResult);
  const chain = createChainWithValidator(validator);
  const summary = createSummary();

  // closure.issue has non-empty validationConditions
  const result = await chain.validate("closure.issue", summary);

  assertEquals(result.valid, false);
});

Deno.test("ValidationChain - validate returns invalid when stepValidator rejects (with retryHandler)", async () => {
  const failResult: ValidatorResult = {
    valid: false,
    pattern: "test-failure",
    error: "3 tests failed",
  };
  const validator = createMockStepValidator(failResult);
  const retryHandler = createMockRetryHandler(
    "Please fix the failing tests and try again.",
  );
  const chain = createChainWithValidator(validator, retryHandler);
  const summary = createSummary();

  const result = await chain.validate("closure.issue", summary);

  assertEquals(result.valid, false);
});

Deno.test("ValidationChain - validate still returns valid when step has empty conditions despite failing validator", async () => {
  // closure.polling has empty validationConditions, so validateWithConditions
  // is never reached even if a stepValidator is provided.
  const failResult: ValidatorResult = {
    valid: false,
    pattern: "unreachable",
    error: "should not be called",
  };
  const validator = createMockStepValidator(failResult);
  const chain = createChainWithValidator(validator);
  const summary = createSummary();

  const result = await chain.validate("closure.polling", summary);

  assertEquals(result.valid, true);
});

// =============================================================================
// Diagnosis Tests - error message content verification
// =============================================================================

Deno.test("ValidationChain - retryPrompt contains error message from validator (fallback path)", async () => {
  const failResult: ValidatorResult = {
    valid: false,
    pattern: "lint-errors",
    error: "found 5 lint violations in src/main.ts",
  };
  const validator = createMockStepValidator(failResult);
  // No retryHandler -> falls back to generic message
  const chain = createChainWithValidator(validator);
  const summary = createSummary();

  const result = await chain.validate("closure.issue", summary);

  assertEquals(result.valid, false);
  assertStringIncludes(
    result.retryPrompt!,
    "found 5 lint violations in src/main.ts",
    "retryPrompt should include the validator error message",
  );
});

Deno.test("ValidationChain - retryPrompt contains pattern name when error is absent (fallback path)", async () => {
  const failResult: ValidatorResult = {
    valid: false,
    pattern: "format-mismatch",
    // no error field
  };
  const validator = createMockStepValidator(failResult);
  const chain = createChainWithValidator(validator);
  const summary = createSummary();

  const result = await chain.validate("closure.issue", summary);

  assertEquals(result.valid, false);
  assertStringIncludes(
    result.retryPrompt!,
    "format-mismatch",
    "retryPrompt should include the pattern name as fallback diagnostic",
  );
});

Deno.test("ValidationChain - retryPrompt comes from retryHandler when available", async () => {
  const failResult: ValidatorResult = {
    valid: false,
    pattern: "type-errors",
    error: "TS2345: Argument of type string is not assignable",
  };
  const validator = createMockStepValidator(failResult);
  const expectedPrompt =
    "Type errors detected. Fix the type mismatches and retry.";
  const retryHandler = createMockRetryHandler(expectedPrompt);
  const chain = createChainWithValidator(validator, retryHandler);
  const summary = createSummary();

  const result = await chain.validate("closure.issue", summary);

  assertEquals(result.valid, false);
  assertStringIncludes(
    result.retryPrompt!,
    "Type errors detected",
    "retryPrompt should come from retryHandler when pattern is present",
  );
});

Deno.test("ValidationChain - fallback retryPrompt prefix is 'Validation conditions not met'", async () => {
  const failResult: ValidatorResult = {
    valid: false,
    pattern: "generic-fail",
    error: "something went wrong",
  };
  const validator = createMockStepValidator(failResult);
  const chain = createChainWithValidator(validator);
  const summary = createSummary();

  const result = await chain.validate("closure.issue", summary);

  assertEquals(result.valid, false);
  assertStringIncludes(
    result.retryPrompt!,
    "Validation conditions not met",
    "retryPrompt should start with the standard fallback prefix",
  );
});
