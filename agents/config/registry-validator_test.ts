/**
 * Tests for agents/config/registry-validator.ts
 *
 * Covers validateCrossReferences() with valid registries,
 * broken entryStepMapping, broken transitions, broken validators,
 * broken failurePatterns, conditional transitions, null targets,
 * and live agent configs.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { validateCrossReferences } from "./registry-validator.ts";
import { validateStepRegistry } from "../common/step-registry/validator.ts";
import type { StepRegistry } from "../common/step-registry/types.ts";
import { makeStep } from "../common/step-registry/test-helpers.ts";
import { discoverAgents } from "../testing/discover-agents.ts";

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
      issue: { initial: "initial.default", continuation: "initial.default" },
    },
    validators: {
      "git-clean": {
        type: "command",
        phase: "postllm",
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
        preflightConditions: [],
        postLLMConditions: [
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
    entryStepMapping: {
      issue: { initial: "initial.default", continuation: "initial.default" },
    },
  };

  const result = validateCrossReferences(data);

  assertEquals(result.valid, true);
});

// =============================================================================
// entryStepMapping - broken references
// =============================================================================

Deno.test("registry-validator - entryStepMapping.initial references unknown step", () => {
  const data = validRegistry();
  (data.entryStepMapping as Record<
    string,
    { initial: string; continuation: string }
  >).issue = { initial: "initial.missing", continuation: "initial.default" };

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
  const esm = data.entryStepMapping as Record<
    string,
    { initial: string; continuation: string }
  >;
  esm.issue = { initial: "initial.gone", continuation: "initial.default" };
  esm.externalState = {
    initial: "initial.also-gone",
    continuation: "initial.default",
  };

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
// postLLMConditions / preflightConditions - broken validator references
// =============================================================================

Deno.test("registry-validator - postLLMConditions references unknown validator", () => {
  const data = validRegistry();
  const vs = data.validationSteps as Record<string, Record<string, unknown>>;
  vs["closure.issue"].postLLMConditions = [
    { validator: "missing-validator", params: {} },
  ];

  const result = validateCrossReferences(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.includes("missing-validator") && e.includes("postLLMConditions")
  );
  assertEquals(error !== undefined, true);
});

Deno.test("registry-validator - multiple broken postLLMConditions", () => {
  const data = validRegistry();
  const vs = data.validationSteps as Record<string, Record<string, unknown>>;
  vs["closure.issue"].postLLMConditions = [
    { validator: "missing-a", params: {} },
    { validator: "missing-b", params: {} },
  ];

  const result = validateCrossReferences(data);

  assertEquals(result.valid, false);
  // At least 2 errors for the 2 missing validators (order of errors is stable
  // but the count is the invariant we care about — "at least one per row").
  assertEquals(result.errors.length >= 2, true);
});

Deno.test("registry-validator - legacy validationConditions field is rejected", () => {
  const data = validRegistry();
  const vs = data.validationSteps as Record<string, Record<string, unknown>>;
  // Simulate legacy config that still uses the removed field
  delete vs["closure.issue"].postLLMConditions;
  vs["closure.issue"].validationConditions = [
    { validator: "git-clean", params: {} },
  ];

  const result = validateCrossReferences(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.includes("validationConditions") && e.includes("removed")
  );
  assertEquals(
    error !== undefined,
    true,
    "Legacy validationConditions field must be explicitly rejected at load time. " +
      "Fix: agents/config/registry-validator.ts",
  );
});

Deno.test("registry-validator - preflight slot wired to postllm validator is rejected", () => {
  const data = validRegistry();
  // git-clean is declared phase:"postllm" in the fixture; wiring it to
  // preflightConditions must trigger a phase-mismatch error.
  const vs = data.validationSteps as Record<string, Record<string, unknown>>;
  vs["closure.issue"].preflightConditions = [
    { validator: "git-clean", params: {} },
  ];

  const result = validateCrossReferences(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.includes("git-clean") && e.includes("phase") &&
    e.includes("preflightConditions")
  );
  assertEquals(
    error !== undefined,
    true,
    "Expected a phase-mismatch error for validator wired to the wrong slot. " +
      "Fix: agents/config/registry-validator.ts",
  );
});

Deno.test("registry-validator - phase-less validator in conditions slot is rejected", () => {
  const data = validRegistry();
  const validators = data.validators as Record<
    string,
    Record<string, unknown>
  >;
  // Remove phase from the declared validator
  delete validators["git-clean"].phase;

  const result = validateCrossReferences(data);

  assertEquals(result.valid, false);
  const error = result.errors.find((e) =>
    e.includes("git-clean") && e.includes("phase")
  );
  assertEquals(
    error !== undefined,
    true,
    "Phase-less validators referenced by any conditions slot must be rejected. " +
      "Fix: agents/config/registry-validator.ts",
  );
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
  (data.entryStepMapping as Record<
    string,
    { initial: string; continuation: string }
  >).issue = { initial: "initial.gone", continuation: "initial.default" };

  // Break transition
  const steps = data.steps as Record<string, Record<string, unknown>>;
  steps["initial.default"].transitions = {
    next: { target: "gone.step" },
  };

  // Break post-LLM validator reference
  const vs = data.validationSteps as Record<string, Record<string, unknown>>;
  vs["closure.issue"].postLLMConditions = [
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
    entryStepMapping: {
      issue: { initial: "initial.default", continuation: "initial.default" },
    },
  };

  const result = validateCrossReferences(data);

  assertEquals(result.valid, true);
});

Deno.test("registry-validator - non-object step entry is skipped", () => {
  const data: Record<string, unknown> = {
    steps: {
      "initial.default": "not-an-object",
    },
    entryStepMapping: {
      issue: { initial: "initial.default", continuation: "initial.default" },
    },
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
    entryStepMapping: {
      issue: { initial: "initial.default", continuation: "initial.default" },
    },
  };

  const result = validateCrossReferences(data);

  // Non-object transition rules are silently skipped
  assertEquals(result.valid, true);
});

// =============================================================================
// Live agent configs - Integration tests (discovered dynamically)
//
// `.agent/<name>/*` is user-side config; this suite dogfoods the validator
// against every dev-time agent the climpt repo ships. Hardcoding specific
// agent names would partial-enumerate the consumer set.
// =============================================================================

const crossRefAgents = await discoverAgents();

Deno.test("registry-validator/integration - at least one agent discovered (non-vacuity)", () => {
  assertEquals(
    crossRefAgents.length > 0,
    true,
    `No agents found under .agent/*/steps_registry.json. ` +
      `Iterating an empty set would vacuously pass. ` +
      `Fix: verify .agent/ contains at least one agent directory.`,
  );
});

for (const { name: agent, registryPath } of crossRefAgents) {
  Deno.test(`registry-validator/integration - ${agent} steps_registry cross-refs valid`, async () => {
    const text = await Deno.readTextFile(registryPath);
    const data = JSON.parse(text);

    const result = validateCrossReferences(data);

    assertEquals(
      result.valid,
      true,
      `Cross-ref errors in ${registryPath}: ${JSON.stringify(result.errors)}`,
    );
  });
}

// =============================================================================
// validateStepRegistry - step-level permissionMode validation
// =============================================================================

/**
 * Build a minimal valid StepRegistry with one step.
 * Callers can override step properties via the `stepOverrides` parameter.
 */
function validTypedRegistry(
  stepOverrides?: Partial<StepRegistry["steps"][string]>,
): StepRegistry {
  return {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "initial.test": makeStep({
        stepId: "initial.test",
        name: "Test Step",
        c2: "initial",
        c3: "test",
        edition: "default",
        uvVariables: ["var1"],
        usesStdin: false,
        ...stepOverrides,
      }),
    },
  };
}

Deno.test("validateStepRegistry/permissionMode - valid permissionMode passes", () => {
  const registry = validTypedRegistry({ permissionMode: "plan" });

  // Should not throw
  validateStepRegistry(registry);
});

Deno.test("validateStepRegistry/permissionMode - invalid permissionMode is rejected", () => {
  const registry = validTypedRegistry({
    permissionMode:
      "invalid-mode" as StepRegistry["steps"][string]["permissionMode"],
  });

  assertThrows(
    () => validateStepRegistry(registry),
    Error,
    "permissionMode",
  );
});

Deno.test("validateStepRegistry/permissionMode - undefined permissionMode passes (optional)", () => {
  const registry = validTypedRegistry();
  // Ensure permissionMode is not set
  delete registry.steps["initial.test"].permissionMode;

  // Should not throw
  validateStepRegistry(registry);
});

Deno.test("validateStepRegistry/permissionMode - error message contains step ID, field name, and valid values", () => {
  const registry = validTypedRegistry({
    permissionMode:
      "invalid-mode" as StepRegistry["steps"][string]["permissionMode"],
  });

  try {
    validateStepRegistry(registry);
    throw new Error("Should have thrown");
  } catch (e) {
    const msg = (e as Error).message;
    // Step ID is present so the developer can locate the problem
    assertEquals(
      msg.includes("initial.test"),
      true,
      `Expected step ID in error, got: ${msg}`,
    );
    // Field name is present for actionability
    assertEquals(
      msg.includes("permissionMode"),
      true,
      `Expected "permissionMode" in error, got: ${msg}`,
    );
    // All valid values are listed so the developer knows the fix
    for (
      const mode of ["default", "plan", "acceptEdits", "bypassPermissions"]
    ) {
      assertEquals(
        msg.includes(mode),
        true,
        `Expected valid mode "${mode}" in error, got: ${msg}`,
      );
    }
  }
});
