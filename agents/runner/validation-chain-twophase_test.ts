/**
 * Tests for ValidationChain two-phase validation model.
 *
 * Covers:
 * - Group 1 (G1): Pre-flight state validation via validateState()
 * - Group 4 (G3+G5): outputSchema + validationConditions coexistence
 *
 * Source of truth: agents/runner/validation-chain.ts
 */

import { assertEquals } from "@std/assert";
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
import { makeStep } from "../common/step-registry/test-helpers.ts";

// =============================================================================
// Helpers (same pattern as validation-chain_test.ts)
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

function createMockStepValidator(
  result: ValidatorResult,
): StepValidator {
  return {
    validate: (_conditions: ValidationCondition[]) => Promise.resolve(result),
  } as unknown as StepValidator;
}

function createMockRetryHandler(prompt: string): RetryHandler {
  return {
    buildRetryPrompt: (
      _stepConfig: ValidationStepConfig,
      _result: ValidatorResult,
    ) => Promise.resolve(prompt),
    getPattern: () => undefined,
  } as unknown as RetryHandler;
}

/**
 * Build a fixture registry with a single validation step that has BOTH
 * outputSchema AND validationConditions. This is the central fixture
 * for two-phase coexistence tests.
 */
function createTwoPhaseRegistry(
  overrides: Partial<ValidationStepConfig> = {},
): ExtendedStepsRegistry {
  return {
    agentId: "twophase-test",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "initial.test": makeStep({
        stepId: "initial.test",
        name: "Initial",
        c2: "initial",
        c3: "test",
        edition: "default",
        uvVariables: [],
        usesStdin: false,
      }),
    },
    validationSteps: {
      "closure.twophase": {
        stepId: "closure.twophase",
        name: "Two-Phase Closure",
        c2: "closure",
        c3: "twophase",
        // Mirror the new contract: validator is wired to the post-LLM slot.
        // `validateState()` reads `preflightConditions`, which is empty here.
        preflightConditions: [],
        postLLMConditions: [{
          validator: "command",
          params: { command: "echo ok" },
        }],
        onFailure: { action: "retry" },
        outputSchema: {
          type: "object",
          properties: { status: { type: "string" } },
        },
        ...overrides,
      },
    },
  };
}

/**
 * Build a registry with a validation step that has NO validationConditions.
 */
function createNoConditionsRegistry(): ExtendedStepsRegistry {
  return {
    agentId: "no-conditions-test",
    version: "1.0.0",
    c1: "steps",
    steps: {},
    validationSteps: {
      "closure.nocond": {
        stepId: "closure.nocond",
        name: "No Conditions Closure",
        c2: "closure",
        c3: "nocond",
        preflightConditions: [],
        postLLMConditions: [],
        onFailure: { action: "retry" },
      },
    },
  };
}

/**
 * Build a registry with outputSchema only (no validationConditions).
 */
function createSchemaOnlyRegistry(): ExtendedStepsRegistry {
  return {
    agentId: "schema-only-test",
    version: "1.0.0",
    c1: "steps",
    steps: {},
    validationSteps: {
      "closure.schemaonly": {
        stepId: "closure.schemaonly",
        name: "Schema Only Closure",
        c2: "closure",
        c3: "schemaonly",
        preflightConditions: [],
        postLLMConditions: [],
        onFailure: { action: "retry" },
        outputSchema: {
          type: "object",
          properties: { status: { type: "string" } },
        },
      },
    },
  };
}

function createChainWithValidator(
  stepValidator: StepValidator | null,
  retryHandler: RetryHandler | null = null,
  registry: ExtendedStepsRegistry = createTwoPhaseRegistry(),
): ValidationChain {
  return new ValidationChain({
    workingDir: "/tmp/claude/test",
    logger: createMockLogger(),
    stepsRegistry: registry,
    stepValidator,
    retryHandler,
    agentId: "twophase-test",
  });
}

// =============================================================================
// Group 1: Pre-flight State Validation (G1)
// =============================================================================

Deno.test("ValidationChain two-phase model", async (t) => {
  await t.step(
    "validateState() runs preflightConditions regardless of outputSchema",
    async () => {
      // Source of truth: ValidationChain.validateState() method
      // Contract: validateState reads ONLY preflightConditions and ignores
      // outputSchema. Pre-flight is pure-predicate: failure has no retry prompt.
      const failResult: ValidatorResult = {
        valid: false,
        pattern: "test-fail",
        error: "state check failed",
      };
      const validator = createMockStepValidator(failResult);
      // Registry has outputSchema AND a preflight condition wired in.
      const registryWithPreflight = createTwoPhaseRegistry({
        preflightConditions: [{
          validator: "preflight-command",
          params: { command: "echo ok" },
        }],
      });
      const chain = createChainWithValidator(
        validator,
        null,
        registryWithPreflight,
      );

      const result = await chain.validateState("closure.twophase");

      assertEquals(
        result.valid,
        false,
        "validateState() must run preflightConditions even when outputSchema is defined. " +
          "Fix: agents/runner/validation-chain.ts validateState()",
      );
      // Pre-flight results carry no retryPrompt (structural guarantee).
      assertEquals(
        "retryPrompt" in result,
        false,
        "PreFlightValidatorResult must NOT expose a retryPrompt field. " +
          "Fix: agents/common/validation-types.ts PreFlightValidatorResult",
      );
    },
  );

  await t.step(
    "validateState() returns valid when no conditions exist",
    async () => {
      // Contract: no conditions -> valid: true
      const failResult: ValidatorResult = {
        valid: false,
        pattern: "unreachable",
        error: "should not be called",
      };
      const validator = createMockStepValidator(failResult);
      const registry = createNoConditionsRegistry();
      const chain = createChainWithValidator(validator, null, registry);

      const result = await chain.validateState("closure.nocond");

      assertEquals(
        result.valid,
        true,
        "validateState() must return valid when no validationConditions are defined. " +
          "Fix: agents/runner/validation-chain.ts validateState()",
      );
    },
  );

  await t.step(
    "validateState() returns valid when no step config exists",
    async () => {
      // Contract: unknown stepId -> valid: true
      const chain = createChainWithValidator(null);

      const result = await chain.validateState("nonexistent.step");

      assertEquals(
        result.valid,
        true,
        "validateState() must return valid for unknown step IDs. " +
          "Fix: agents/runner/validation-chain.ts validateState()",
      );
    },
  );

  await t.step(
    "validateState() returns valid when no stepValidator is injected",
    async () => {
      // Contract: no stepValidator -> valid: true (even with conditions defined)
      const chain = createChainWithValidator(null);

      const result = await chain.validateState("closure.twophase");

      assertEquals(
        result.valid,
        true,
        "validateState() must return valid when no stepValidator is available. " +
          "Fix: agents/runner/validation-chain.ts validateState()",
      );
    },
  );

  // ===========================================================================
  // Phase 2: validate() with format validation
  // ===========================================================================

  await t.step(
    "validate() runs format validation when outputSchema defined",
    async () => {
      // Source of truth: ValidationChain.validate() method
      // Contract: Phase 2 validate() uses FormatValidator when outputSchema exists
      const registry = createSchemaOnlyRegistry();
      const chain = createChainWithValidator(null, null, registry);

      // Summary with no JSON block -> FormatValidator will fail ("No JSON block found")
      const summary = createSummary({
        assistantResponses: ["This is plain text with no JSON"],
      });

      const result = await chain.validate("closure.schemaonly", summary);

      assertEquals(
        result.valid,
        false,
        "validate() must run format validation when outputSchema is defined. " +
          "Fix: agents/runner/validation-chain.ts validate()",
      );
      assertEquals(
        result.formatValidation !== undefined,
        true,
        "validate() must populate formatValidation when format check fails. " +
          "Fix: agents/runner/validation-chain.ts validate()",
      );
    },
  );

  await t.step(
    "validate() passes format validation with valid JSON matching schema",
    async () => {
      // Contract: valid JSON matching schema -> format validation passes
      const registry = createSchemaOnlyRegistry();
      const chain = createChainWithValidator(null, null, registry);

      const summary = createSummary({
        assistantResponses: [
          'Here is the result:\n```json\n{"status": "done"}\n```',
        ],
      });

      const result = await chain.validate("closure.schemaonly", summary);

      assertEquals(
        result.valid,
        true,
        "validate() must pass when JSON matches outputSchema. " +
          "Fix: agents/runner/validation-chain.ts validate()",
      );
    },
  );

  // ===========================================================================
  // Group 4: outputSchema + conditions coexistence (G3+G5)
  // ===========================================================================

  await t.step(
    "validate() executes both format and condition validation when both defined",
    async () => {
      // Invariant: outputSchema and validationConditions are NOT mutually exclusive
      // Source of truth: ValidationChain.validate() method
      const passResult: ValidatorResult = { valid: true };
      const validator = createMockStepValidator(passResult);
      const chain = createChainWithValidator(validator);

      // Summary with valid JSON that matches schema
      const summary = createSummary({
        assistantResponses: ['```json\n{"status": "ok"}\n```'],
      });

      const result = await chain.validate("closure.twophase", summary);

      assertEquals(
        result.valid,
        true,
        "validate() must pass when both format and conditions pass. " +
          "outputSchema must not disable validationConditions. " +
          "Fix: agents/runner/validation-chain.ts validate()",
      );
    },
  );

  await t.step(
    "validate() returns format failure even when conditions would pass",
    async () => {
      // Contract: format failure takes precedence in Phase 2 (checked first)
      const passResult: ValidatorResult = { valid: true };
      const validator = createMockStepValidator(passResult);
      const chain = createChainWithValidator(validator);

      // Summary with NO JSON block -> format validation will fail
      const summary = createSummary({
        assistantResponses: ["Plain text without any JSON block"],
      });

      const result = await chain.validate("closure.twophase", summary);

      assertEquals(
        result.valid,
        false,
        "validate() must fail on format when outputSchema is defined and response lacks JSON. " +
          "Fix: agents/runner/validation-chain.ts validate()",
      );
      assertEquals(
        result.formatValidation !== undefined,
        true,
        "formatValidation must be populated when format check fails. " +
          "Fix: agents/runner/validation-chain.ts validate()",
      );
    },
  );

  await t.step(
    "validate() returns condition failure when format passes but conditions fail",
    async () => {
      // Contract: conditions are evaluated after format passes
      const failResult: ValidatorResult = {
        valid: false,
        pattern: "condition-failed",
        error: "condition check did not pass",
      };
      const validator = createMockStepValidator(failResult);
      const chain = createChainWithValidator(validator);

      // Summary with valid JSON matching schema
      const summary = createSummary({
        assistantResponses: ['```json\n{"status": "incomplete"}\n```'],
      });

      const result = await chain.validate("closure.twophase", summary);

      assertEquals(
        result.valid,
        false,
        "validate() must fail when format passes but conditions fail. " +
          "Fix: agents/runner/validation-chain.ts validate()",
      );
      assertEquals(
        result.formatValidation,
        undefined,
        "formatValidation must be undefined when format passed but conditions failed. " +
          "Fix: agents/runner/validation-chain.ts validate()",
      );
      assertEquals(
        result.action,
        "retry",
        "action must reflect the condition failure config (retry). " +
          "Fix: agents/runner/validation-chain.ts validate()",
      );
    },
  );

  await t.step(
    "validate() retryPrompt from format failure describes the format problem",
    async () => {
      // Contract: format failure retryPrompt is user-actionable
      const chain = createChainWithValidator(
        null,
        null,
        createSchemaOnlyRegistry(),
      );

      const summary = createSummary({
        assistantResponses: ["no json here"],
      });

      const result = await chain.validate("closure.schemaonly", summary);

      assertEquals(
        result.valid,
        false,
        "must fail for missing JSON block",
      );
      assertEquals(
        typeof result.retryPrompt,
        "string",
        "retryPrompt must be a string when format validation fails. " +
          "Fix: agents/runner/validation-chain.ts buildFormatRetryPrompt()",
      );
      assertEquals(
        result.retryPrompt!.length > 0,
        true,
        "retryPrompt must not be empty. " +
          "Fix: agents/runner/validation-chain.ts buildFormatRetryPrompt()",
      );
    },
  );
});
