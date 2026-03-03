/**
 * Tests for agents/config/registry-validator.ts
 *
 * Covers validateCrossReferences() with valid registries,
 * broken entryStepMapping, broken transitions, broken validators,
 * broken failurePatterns, conditional transitions, null targets,
 * and live agent configs.
 */

import { assertEquals } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { validateCrossReferences } from "./registry-validator.ts";

const logger = new BreakdownLogger("registry-validator");

// =============================================================================
// Fixtures
// =============================================================================

function validRegistry(): Record<string, unknown> {
  return {
    agentId: "test",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "initial.default": {
        stepId: "initial.default",
        transitions: {
          next: { target: "continuation.default" },
          repeat: { target: "initial.default" },
        },
      },
      "continuation.default": {
        stepId: "continuation.default",
        transitions: {
          next: { target: "closure.default" },
          repeat: { target: "continuation.default" },
        },
      },
      "closure.default": {
        stepId: "closure.default",
        transitions: {
          closing: { target: null },
          repeat: { target: "closure.default" },
        },
      },
    },
    entryStepMapping: {
      issue: "initial.default",
    },
    validators: {
      "git-clean": {
        type: "command",
        command: "git status --porcelain",
        failurePattern: "git-dirty",
      },
    },
    failurePatterns: {
      "git-dirty": {
        description: "Uncommitted changes",
        edition: "failed",
        adaptation: "git-dirty",
      },
    },
    validationSteps: {
      "closure.issue": {
        stepId: "closure.issue",
        validationConditions: [
          { validator: "git-clean", params: {} },
        ],
      },
    },
  };
}

// =============================================================================
// Valid data
// =============================================================================

Deno.test("registry-validator - valid registry passes", () => {
  const data = validRegistry();
  logger.debug("validateCrossReferences input", { agentId: data.agentId });
  const result = validateCrossReferences(data);
  logger.debug("validateCrossReferences result", {
    valid: result.valid,
    errorCount: result.errors.length,
  });

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("registry-validator - empty registry passes", () => {
  const data: Record<string, unknown> = {};

  const result = validateCrossReferences(data);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("registry-validator - registry with only steps passes", () => {
  const data: Record<string, unknown> = {
    steps: {
      "initial.default": { stepId: "initial.default", transitions: {} },
    },
    entryStepMapping: { issue: "initial.default" },
  };

  const result = validateCrossReferences(data);

  assertEquals(result.valid, true);
});

// =============================================================================
// entryStepMapping - broken references
// =============================================================================

Deno.test("registry-validator - entryStepMapping references unknown step", () => {
  const data = validRegistry();
  (data.entryStepMapping as Record<string, string>).issue = "initial.missing";

  const result = validateCrossReferences(data);

  assertEquals(result.valid, false);
  assertEquals(result.errors.length, 1);
  assertEquals(
    result.errors[0].includes("initial.missing"),
    true,
  );
  assertEquals(
    result.errors[0].includes("entryStepMapping"),
    true,
  );
});

Deno.test("registry-validator - multiple broken entryStepMapping entries", () => {
  const data = validRegistry();
  const esm = data.entryStepMapping as Record<string, string>;
  esm.issue = "initial.gone";
  esm.externalState = "initial.also-gone";

  const result = validateCrossReferences(data);

  assertEquals(result.valid, false);
  assertEquals(result.errors.length, 2);
});

// =============================================================================
// transitions - broken target references
// =============================================================================

Deno.test("registry-validator - transition target references unknown step", () => {
  const data = validRegistry();
  const steps = data.steps as Record<string, Record<string, unknown>>;
  steps["initial.default"].transitions = {
    next: { target: "nonexistent.step" },
  };

  const result = validateCrossReferences(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.includes("nonexistent.step") && e.includes("transitions")
  );
  assertEquals(error !== undefined, true);
});

Deno.test("registry-validator - null target is valid (terminal)", () => {
  const data = validRegistry();
  const steps = data.steps as Record<string, Record<string, unknown>>;
  steps["closure.default"].transitions = {
    closing: { target: null },
  };

  const result = validateCrossReferences(data);

  // null targets are terminal and should not trigger errors
  const closingErrors = result.errors.filter((e) =>
    e.includes("closure.default") && e.includes("closing")
  );
  assertEquals(closingErrors.length, 0);
});

Deno.test("registry-validator - fallback references unknown step", () => {
  const data = validRegistry();
  const steps = data.steps as Record<string, Record<string, unknown>>;
  steps["initial.default"].transitions = {
    next: { target: "continuation.default", fallback: "missing.fallback" },
  };

  const result = validateCrossReferences(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.includes("missing.fallback") && e.includes("fallback")
  );
  assertEquals(error !== undefined, true);
});

Deno.test("registry-validator - fallback null is valid", () => {
  const data = validRegistry();
  const steps = data.steps as Record<string, Record<string, unknown>>;
  steps["initial.default"].transitions = {
    next: { target: "continuation.default", fallback: null },
  };

  const result = validateCrossReferences(data);

  // Should not have fallback-related errors
  const fallbackErrors = result.errors.filter((e) => e.includes("fallback"));
  assertEquals(fallbackErrors.length, 0);
});

// =============================================================================
// Conditional transitions (targets map)
// =============================================================================

Deno.test("registry-validator - conditional targets with valid steps passes", () => {
  const data = validRegistry();
  const steps = data.steps as Record<string, Record<string, unknown>>;
  steps["initial.default"].transitions = {
    next: {
      targets: {
        analyze: "continuation.default",
        skip: "closure.default",
      },
    },
  };

  const result = validateCrossReferences(data);

  assertEquals(result.valid, true);
});

Deno.test("registry-validator - conditional targets with unknown step fails", () => {
  const data = validRegistry();
  const steps = data.steps as Record<string, Record<string, unknown>>;
  steps["initial.default"].transitions = {
    next: {
      targets: {
        analyze: "continuation.default",
        broken: "nonexistent.target",
      },
    },
  };

  const result = validateCrossReferences(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.includes("nonexistent.target") && e.includes("targets")
  );
  assertEquals(error !== undefined, true);
});

Deno.test("registry-validator - conditional targets null is valid (terminal)", () => {
  const data = validRegistry();
  const steps = data.steps as Record<string, Record<string, unknown>>;
  steps["initial.default"].transitions = {
    next: {
      targets: {
        continue: "continuation.default",
        done: null,
      },
    },
  };

  const result = validateCrossReferences(data);

  const targetErrors = result.errors.filter((e) => e.includes("targets"));
  assertEquals(targetErrors.length, 0);
});

// =============================================================================
// validationConditions - broken validator references
// =============================================================================

Deno.test("registry-validator - validationCondition references unknown validator", () => {
  const data = validRegistry();
  const vs = data.validationSteps as Record<string, Record<string, unknown>>;
  vs["closure.issue"].validationConditions = [
    { validator: "missing-validator", params: {} },
  ];

  const result = validateCrossReferences(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.includes("missing-validator") && e.includes("validationConditions")
  );
  assertEquals(error !== undefined, true);
});

Deno.test("registry-validator - multiple broken validationConditions", () => {
  const data = validRegistry();
  const vs = data.validationSteps as Record<string, Record<string, unknown>>;
  vs["closure.issue"].validationConditions = [
    { validator: "missing-a", params: {} },
    { validator: "missing-b", params: {} },
  ];

  const result = validateCrossReferences(data);

  assertEquals(result.valid, false);
  assertEquals(result.errors.length, 2);
});

// =============================================================================
// validators - broken failurePattern references
// =============================================================================

Deno.test("registry-validator - validator references unknown failurePattern", () => {
  const data = validRegistry();
  const validators = data.validators as Record<
    string,
    Record<string, unknown>
  >;
  validators["git-clean"].failurePattern = "nonexistent-pattern";

  const result = validateCrossReferences(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.includes("nonexistent-pattern") && e.includes("failurePattern")
  );
  assertEquals(error !== undefined, true);
});

Deno.test("registry-validator - validator without failurePattern is valid", () => {
  const data = validRegistry();
  const validators = data.validators as Record<
    string,
    Record<string, unknown>
  >;
  delete validators["git-clean"].failurePattern;

  const result = validateCrossReferences(data);

  // Removing the failurePattern reference means no cross-ref to check
  const fpErrors = result.errors.filter((e) => e.includes("failurePattern"));
  assertEquals(fpErrors.length, 0);
});

// =============================================================================
// Mixed errors
// =============================================================================

Deno.test("registry-validator - multiple different error types accumulate", () => {
  const data = validRegistry();

  // Break entryStepMapping
  (data.entryStepMapping as Record<string, string>).issue = "initial.gone";

  // Break transition
  const steps = data.steps as Record<string, Record<string, unknown>>;
  steps["initial.default"].transitions = {
    next: { target: "gone.step" },
  };

  // Break validationCondition
  const vs = data.validationSteps as Record<string, Record<string, unknown>>;
  vs["closure.issue"].validationConditions = [
    { validator: "gone-validator", params: {} },
  ];

  // Break failurePattern
  const validators = data.validators as Record<
    string,
    Record<string, unknown>
  >;
  validators["git-clean"].failurePattern = "gone-pattern";

  const result = validateCrossReferences(data);

  assertEquals(result.valid, false);
  // At least 4 different errors (one per category)
  assertEquals(result.errors.length >= 4, true);
});

// =============================================================================
// Edge cases
// =============================================================================

Deno.test("registry-validator - steps with no transitions is valid", () => {
  const data: Record<string, unknown> = {
    steps: {
      "initial.default": { stepId: "initial.default" },
    },
    entryStepMapping: { issue: "initial.default" },
  };

  const result = validateCrossReferences(data);

  assertEquals(result.valid, true);
});

Deno.test("registry-validator - non-object step entry is skipped", () => {
  const data: Record<string, unknown> = {
    steps: {
      "initial.default": "not-an-object",
    },
    entryStepMapping: { issue: "initial.default" },
  };

  const result = validateCrossReferences(data);

  // Should not crash, non-object steps are skipped in transition check
  assertEquals(result.valid, true);
});

Deno.test("registry-validator - non-object transition rule is skipped", () => {
  const data: Record<string, unknown> = {
    steps: {
      "initial.default": {
        stepId: "initial.default",
        transitions: {
          next: "not-an-object",
        },
      },
    },
    entryStepMapping: { issue: "initial.default" },
  };

  const result = validateCrossReferences(data);

  // Non-object transition rules are silently skipped
  assertEquals(result.valid, true);
});

// =============================================================================
// Live agent configs - Integration tests
// =============================================================================

Deno.test("registry-validator/integration - iterator steps_registry cross-refs valid", async () => {
  const text = await Deno.readTextFile(".agent/iterator/steps_registry.json");
  const data = JSON.parse(text);

  const result = validateCrossReferences(data);

  assertEquals(
    result.valid,
    true,
    `Cross-ref errors: ${JSON.stringify(result.errors)}`,
  );
});

Deno.test("registry-validator/integration - reviewer steps_registry cross-refs valid", async () => {
  const text = await Deno.readTextFile(".agent/reviewer/steps_registry.json");
  const data = JSON.parse(text);

  const result = validateCrossReferences(data);

  assertEquals(
    result.valid,
    true,
    `Cross-ref errors: ${JSON.stringify(result.errors)}`,
  );
});

Deno.test("registry-validator/integration - facilitator steps_registry cross-refs valid", async () => {
  const text = await Deno.readTextFile(
    ".agent/facilitator/steps_registry.json",
  );
  const data = JSON.parse(text);

  const result = validateCrossReferences(data);

  assertEquals(
    result.valid,
    true,
    `Cross-ref errors: ${JSON.stringify(result.errors)}`,
  );
});
