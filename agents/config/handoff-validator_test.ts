/**
 * Tests for agents/config/handoff-validator.ts
 *
 * Covers validateHandoffInputs() for handoff-to-inputs compatibility:
 * - Required input with matching handoffFields -> no warning
 * - Required input with no handoffFields -> warning
 * - Required input from non-existent step -> warning
 * - Optional input with no source -> no warning
 * - Required input with handoffFields that do not cover the key -> warning
 * - Required input with empty handoffFields -> warning
 * - No structuredGate on source step -> warning
 * - Multiple inputs with mixed coverage -> partial warnings
 * - Live agent config integration tests
 */

import { assertEquals } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { validateHandoffInputs } from "./handoff-validator.ts";
import { discoverAgents } from "../testing/discover-agents.ts";

const logger = new BreakdownLogger("handoff-validator");

// =============================================================================
// Fixtures
// =============================================================================

/**
 * Build a minimal registry with two steps: source and target.
 * Source step has configurable structuredGate/handoffFields.
 * Target step has configurable inputs.
 */
function twoStepRegistry(opts: {
  sourceHandoffFields?: string[];
  sourceHasGate?: boolean;
  targetInputs?: Record<string, unknown>;
}): Record<string, unknown> {
  const sourceStep: Record<string, unknown> = {
    stepId: "initial.issue",
    c2: "initial",
    c3: "issue",
    edition: "default",
    uvVariables: [],
    usesStdin: false,
  };

  if (opts.sourceHasGate !== false) {
    sourceStep.structuredGate = {
      allowedIntents: ["next", "repeat"],
      intentSchemaRef: "#/properties/next_action/properties/action",
      intentField: "next_action.action",
      ...(opts.sourceHandoffFields !== undefined
        ? { handoffFields: opts.sourceHandoffFields }
        : {}),
    };
  }

  const targetStep: Record<string, unknown> = {
    stepId: "continuation.issue",
    c2: "continuation",
    c3: "issue",
    edition: "default",
    uvVariables: [],
    usesStdin: false,
  };

  if (opts.targetInputs) {
    targetStep.inputs = opts.targetInputs;
  }

  return {
    agentId: "test",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "initial.issue": sourceStep,
      "continuation.issue": targetStep,
    },
  };
}

// =============================================================================
// Required input with matching handoffFields -> no warning
// =============================================================================

Deno.test("handoff-validator - required input with matching handoffFields produces no warning", () => {
  const registry = twoStepRegistry({
    sourceHandoffFields: ["analysis.understanding", "issue.number"],
    targetInputs: {
      context: {
        from: "initial.issue.understanding",
        required: true,
      },
    },
  });

  logger.debug("validateHandoffInputs input", {
    stepCount: Object.keys(
      (registry.steps as Record<string, unknown>) ?? {},
    ).length,
  });
  const result = validateHandoffInputs(registry);
  logger.debug("validateHandoffInputs result", {
    valid: result.valid,
    warningCount: result.warnings.length,
  });

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(
    result.warnings.length,
    0,
    `Expected no warnings but got: ${JSON.stringify(result.warnings)}`,
  );
});

// =============================================================================
// Required input with NO handoffFields -> warning
// =============================================================================

Deno.test("handoff-validator - required input from step with no handoffFields produces warning", () => {
  const registry = twoStepRegistry({
    sourceHasGate: true,
    // No handoffFields in structuredGate
    targetInputs: {
      context: {
        from: "initial.issue.understanding",
        required: true,
      },
    },
  });

  const result = validateHandoffInputs(registry);

  assertEquals(result.valid, true, "warnings do not affect validity");
  assertEquals(result.errors.length, 0);
  assertEquals(
    result.warnings.length,
    1,
    `Expected 1 warning but got: ${JSON.stringify(result.warnings)}`,
  );
  assertEquals(
    result.warnings[0].includes("no handoffFields declared"),
    true,
    `Warning message should mention missing handoffFields: ${
      result.warnings[0]
    }`,
  );
});

// =============================================================================
// Required input from non-existent step -> warning
// =============================================================================

Deno.test("handoff-validator - required input from non-existent step produces warning", () => {
  const registry = twoStepRegistry({
    sourceHandoffFields: ["analysis.understanding"],
    targetInputs: {
      context: {
        from: "nonexistent.step.key",
        required: true,
      },
    },
  });

  const result = validateHandoffInputs(registry);

  assertEquals(result.valid, true, "warnings do not affect validity");
  assertEquals(result.errors.length, 0);
  assertEquals(
    result.warnings.length,
    1,
    `Expected 1 warning but got: ${JSON.stringify(result.warnings)}`,
  );
  assertEquals(
    result.warnings[0].includes("does not exist in steps"),
    true,
    `Warning should mention non-existent step: ${result.warnings[0]}`,
  );
});

// =============================================================================
// Optional input with no source -> no warning
// =============================================================================

Deno.test("handoff-validator - optional input with no matching handoffFields produces no warning", () => {
  const registry = twoStepRegistry({
    sourceHandoffFields: ["analysis.understanding"],
    targetInputs: {
      context: {
        from: "initial.issue.nonexistent_key",
        required: false,
      },
    },
  });

  const result = validateHandoffInputs(registry);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(
    result.warnings.length,
    0,
    `Optional inputs should not produce warnings: ${
      JSON.stringify(result.warnings)
    }`,
  );
});

// =============================================================================
// Required input with handoffFields that do not cover the key -> warning
// =============================================================================

Deno.test("handoff-validator - required input with non-matching handoffFields produces warning", () => {
  const registry = twoStepRegistry({
    sourceHandoffFields: ["analysis.approach", "issue.title"],
    targetInputs: {
      context: {
        from: "initial.issue.understanding",
        required: true,
      },
    },
  });

  const result = validateHandoffInputs(registry);

  assertEquals(result.valid, true, "warnings do not affect validity");
  assertEquals(result.errors.length, 0);
  assertEquals(
    result.warnings.length,
    1,
    `Expected 1 warning but got: ${JSON.stringify(result.warnings)}`,
  );
  assertEquals(
    result.warnings[0].includes('do not produce a key named "understanding"'),
    true,
    `Warning should identify the missing key: ${result.warnings[0]}`,
  );
});

// =============================================================================
// Required input with empty handoffFields -> warning
// =============================================================================

Deno.test("handoff-validator - required input from step with empty handoffFields produces warning", () => {
  const registry = twoStepRegistry({
    sourceHandoffFields: [],
    targetInputs: {
      context: {
        from: "initial.issue.understanding",
        required: true,
      },
    },
  });

  const result = validateHandoffInputs(registry);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(
    result.warnings.length,
    1,
    `Expected 1 warning but got: ${JSON.stringify(result.warnings)}`,
  );
  assertEquals(
    result.warnings[0].includes("empty handoffFields"),
    true,
    `Warning should mention empty handoffFields: ${result.warnings[0]}`,
  );
});

// =============================================================================
// No structuredGate on source step -> warning
// =============================================================================

Deno.test("handoff-validator - required input from step with no structuredGate produces warning", () => {
  const registry = twoStepRegistry({
    sourceHasGate: false,
    targetInputs: {
      context: {
        from: "initial.issue.understanding",
        required: true,
      },
    },
  });

  const result = validateHandoffInputs(registry);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(
    result.warnings.length,
    1,
    `Expected 1 warning but got: ${JSON.stringify(result.warnings)}`,
  );
  assertEquals(
    result.warnings[0].includes("no structuredGate configuration"),
    true,
    `Warning should mention missing structuredGate: ${result.warnings[0]}`,
  );
});

// =============================================================================
// Multiple inputs with mixed coverage -> partial warnings
// =============================================================================

Deno.test("handoff-validator - multiple inputs with mixed coverage produce correct warnings", () => {
  const registry = twoStepRegistry({
    sourceHandoffFields: ["analysis.understanding", "issue.number"],
    targetInputs: {
      covered: {
        from: "initial.issue.understanding",
        required: true,
      },
      uncovered: {
        from: "initial.issue.missing_key",
        required: true,
      },
      optional_missing: {
        from: "initial.issue.also_missing",
        required: false,
      },
    },
  });

  const result = validateHandoffInputs(registry);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  // Only the uncovered required input should produce a warning
  assertEquals(
    result.warnings.length,
    1,
    `Expected 1 warning (for uncovered required) but got: ${
      JSON.stringify(result.warnings)
    }`,
  );
  assertEquals(
    result.warnings[0].includes("uncovered"),
    true,
    `Warning should reference the uncovered input: ${result.warnings[0]}`,
  );
});

// =============================================================================
// No inputs defined -> no warnings
// =============================================================================

Deno.test("handoff-validator - steps with no inputs produce no warnings", () => {
  const registry = twoStepRegistry({
    sourceHandoffFields: ["analysis.understanding"],
  });

  const result = validateHandoffInputs(registry);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

// =============================================================================
// Empty registry -> no warnings
// =============================================================================

Deno.test("handoff-validator - empty registry produces no warnings", () => {
  const result = validateHandoffInputs({});

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 0);
});

// =============================================================================
// Live agent configs - Integration tests (discovered dynamically)
//
// `.agent/<name>/*` is user-side config; hardcoding specific agent names
// partial-enumerates the consumer set. See agents/testing/discover-agents.ts.
// =============================================================================

const handoffAgents = await discoverAgents();

Deno.test("handoff-validator/integration - at least one agent discovered (non-vacuity)", () => {
  assertEquals(
    handoffAgents.length > 0,
    true,
    `No agents found under .agent/*/steps_registry.json. ` +
      `Iterating an empty set would vacuously pass.`,
  );
});

for (const { name: agent, registryPath } of handoffAgents) {
  Deno.test(`handoff-validator/integration - ${agent} steps_registry handoff-inputs valid`, async () => {
    const text = await Deno.readTextFile(registryPath);
    const data = JSON.parse(text);

    const result = validateHandoffInputs(data);

    assertEquals(
      result.valid,
      true,
      `Handoff-input errors in ${registryPath}: ${
        JSON.stringify(result.errors)
      }`,
    );
    if (result.warnings.length > 0) {
      logger.debug(`${agent} handoff-input warnings`, {
        count: result.warnings.length,
      });
    }
  });
}
