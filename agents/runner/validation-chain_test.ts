/**
 * Tests for ValidationChain
 *
 * Covers validate(), getClosureStepId(), and getStepIdForIteration().
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { ValidationChain } from "./validation-chain.ts";
import { AgentValidationAbortError } from "../shared/errors/runner-errors.ts";
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
        uvVariables: [],
        usesStdin: false,
      },
      "continuation.test": {
        stepId: "continuation.test",
        name: "Continuation",
        c2: "continuation",
        c3: "test",
        edition: "default",
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

Deno.test("ValidationChain - validate runs format validation when outputSchema defined", async () => {
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

  // G2+G3: outputSchema no longer causes early valid return.
  // With valid JSON matching schema, format validation passes.
  const validSummary = createSummary({
    assistantResponses: ['```json\n{"status": "ok"}\n```'],
  });
  const passResult = await chain.validate("closure.schema", validSummary);
  assertEquals(
    passResult.valid,
    true,
    "validate() must pass when JSON matches outputSchema. " +
      "Fix: agents/runner/validation-chain.ts validate()",
  );

  // Without JSON, format validation fails (no longer silently passes).
  const emptySummary = createSummary();
  const failResult = await chain.validate("closure.schema", emptySummary);
  assertEquals(
    failResult.valid,
    false,
    "validate() must fail when outputSchema defined but no JSON in response. " +
      "Fix: agents/runner/validation-chain.ts validate()",
  );
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

// =============================================================================
// P4-1: onFailure action dispatch
// =============================================================================

Deno.test("ValidationChain - onFailure retry returns retryPrompt (existing behavior)", async () => {
  const failResult: ValidatorResult = {
    valid: false,
    pattern: "test-failure",
    error: "2 tests failed",
  };
  const validator = createMockStepValidator(failResult);
  const registry = createFixtureRegistry();
  registry.validationSteps!["closure.issue"].onFailure = { action: "retry" };
  const chain = createChainWithValidator(validator, null, registry);
  const summary = createSummary();

  const result = await chain.validate("closure.issue", summary);

  assertEquals(result.valid, false, "should report validation failure");
  assertEquals(result.action, "retry", "action should be retry");
  assertEquals(
    typeof result.retryPrompt,
    "string",
    "retryPrompt should be a string",
  );
});

Deno.test("ValidationChain - onFailure abort returns action abort", async () => {
  const failResult: ValidatorResult = {
    valid: false,
    pattern: "critical-error",
    error: "unrecoverable state",
  };
  const validator = createMockStepValidator(failResult);
  const registry = createFixtureRegistry();
  registry.validationSteps!["closure.issue"].onFailure = { action: "abort" };
  const chain = createChainWithValidator(validator, null, registry);
  const summary = createSummary();

  const result = await chain.validate("closure.issue", summary);

  assertEquals(result.valid, false, "should report validation failure");
  assertEquals(result.action, "abort", "action should be abort");
});

Deno.test("ValidationChain - onFailure skip returns action skip", async () => {
  const failResult: ValidatorResult = {
    valid: false,
    pattern: "optional-check",
    error: "non-critical warning",
  };
  const validator = createMockStepValidator(failResult);
  const registry = createFixtureRegistry();
  registry.validationSteps!["closure.issue"].onFailure = { action: "skip" };
  const chain = createChainWithValidator(validator, null, registry);
  const summary = createSummary();

  const result = await chain.validate("closure.issue", summary);

  assertEquals(result.valid, false, "should report validation failure");
  assertEquals(result.action, "skip", "action should be skip");
});

Deno.test("ValidationChain - maxAttempts exceeded overrides retry to abort", async () => {
  const failResult: ValidatorResult = {
    valid: false,
    pattern: "persistent-failure",
    error: "keeps failing",
  };
  const validator = createMockStepValidator(failResult);
  const registry = createFixtureRegistry();
  registry.validationSteps!["closure.issue"].onFailure = {
    action: "retry",
    maxAttempts: 2,
  };
  const chain = createChainWithValidator(validator, null, registry);
  const summary = createSummary();

  // First attempt: action should be retry
  const result1 = await chain.validate("closure.issue", summary);
  assertEquals(result1.action, "retry", "first attempt should retry");

  // Second attempt: maxAttempts (2) reached, should abort
  const result2 = await chain.validate("closure.issue", summary);
  assertEquals(
    result2.action,
    "abort",
    "should abort after maxAttempts exceeded",
  );
});

Deno.test("ValidationChain - default maxAttempts is 3 when not configured", async () => {
  const failResult: ValidatorResult = {
    valid: false,
    pattern: "recurring-failure",
    error: "still failing",
  };
  const validator = createMockStepValidator(failResult);
  const registry = createFixtureRegistry();
  // onFailure.action is "retry" but maxAttempts is not set (defaults to 3)
  registry.validationSteps!["closure.issue"].onFailure = { action: "retry" };
  const chain = createChainWithValidator(validator, null, registry);
  const summary = createSummary();

  // Attempts 1 and 2: should retry
  const r1 = await chain.validate("closure.issue", summary);
  assertEquals(r1.action, "retry", "attempt 1 should retry");
  const r2 = await chain.validate("closure.issue", summary);
  assertEquals(r2.action, "retry", "attempt 2 should retry");

  // Attempt 3: default maxAttempts (3) reached, should abort
  const r3 = await chain.validate("closure.issue", summary);
  assertEquals(
    r3.action,
    "abort",
    "attempt 3 should abort (default maxAttempts=3)",
  );
});

// =============================================================================
// P4-5: Recoverable/unrecoverable classification
// =============================================================================

Deno.test("ValidationChain - unrecoverable failure overrides retry to abort", async () => {
  const failResult: ValidatorResult = {
    valid: false,
    pattern: "command-not-found",
    error: "sh: validator-cmd: command not found",
    recoverable: false,
  };
  const validator = createMockStepValidator(failResult);
  const registry = createFixtureRegistry();
  // Config says retry, but unrecoverable should override
  registry.validationSteps!["closure.issue"].onFailure = { action: "retry" };
  const chain = createChainWithValidator(validator, null, registry);
  const summary = createSummary();

  const result = await chain.validate("closure.issue", summary);

  assertEquals(result.valid, false, "should report validation failure");
  assertEquals(
    result.action,
    "abort",
    "unrecoverable failure should override action to abort",
  );
});

Deno.test("ValidationChain - recoverable failure preserves configured retry action", async () => {
  const failResult: ValidatorResult = {
    valid: false,
    pattern: "test-failure",
    error: "3 tests failed",
    recoverable: true,
  };
  const validator = createMockStepValidator(failResult);
  const registry = createFixtureRegistry();
  registry.validationSteps!["closure.issue"].onFailure = { action: "retry" };
  const chain = createChainWithValidator(validator, null, registry);
  const summary = createSummary();

  const result = await chain.validate("closure.issue", summary);

  assertEquals(result.valid, false, "should report validation failure");
  assertEquals(
    result.action,
    "retry",
    "recoverable failure should preserve retry action",
  );
});

Deno.test("ValidationChain - retry counter resets on successful validation", async () => {
  let callCount = 0;
  // First two calls fail, third succeeds, fourth fails again
  const dynamicValidator = {
    validate: (_conditions: ValidationCondition[]) => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve({
          valid: false,
          pattern: "intermittent",
          error: "flaky check",
        } as ValidatorResult);
      }
      if (callCount === 3) {
        return Promise.resolve({ valid: true } as ValidatorResult);
      }
      // After reset, fail again
      return Promise.resolve({
        valid: false,
        pattern: "intermittent",
        error: "flaky check again",
      } as ValidatorResult);
    },
  } as unknown as StepValidator;

  const registry = createFixtureRegistry();
  registry.validationSteps!["closure.issue"].onFailure = {
    action: "retry",
    maxAttempts: 3,
  };
  const chain = createChainWithValidator(dynamicValidator, null, registry);
  const summary = createSummary();

  // Fail 1: retry (count=1)
  const r1 = await chain.validate("closure.issue", summary);
  assertEquals(r1.action, "retry");

  // Fail 2: retry (count=2)
  const r2 = await chain.validate("closure.issue", summary);
  assertEquals(r2.action, "retry");

  // Success: counter resets
  const r3 = await chain.validate("closure.issue", summary);
  assertEquals(r3.valid, true);

  // Fail again: counter starts from 1 (not 3), should retry
  const r4 = await chain.validate("closure.issue", summary);
  assertEquals(
    r4.action,
    "retry",
    "retry counter should have reset after success",
  );
});
