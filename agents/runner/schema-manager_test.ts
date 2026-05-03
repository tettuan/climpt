/**
 * SchemaManager Unit Tests
 *
 * Tests the three public surfaces of SchemaManager:
 *   1. validateFlowSteps() - aggregated error reporting for missing
 *      structuredGate, transitions, and outputSchemaRef
 *   2. loadSchemaForStep() - consecutive failure handling when
 *      SchemaResolver raises SchemaPointerError (2-strike rule)
 *   3. schemaResolutionFailed flag - toggled on first pointer miss,
 *      cleared on next attempt
 *
 * All tests use minimal stubs; no filesystem or real SchemaResolver calls.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import { SchemaManager } from "./schema-manager.ts";
import type { SchemaManagerDeps } from "./schema-manager.ts";
import { AgentSchemaResolutionError } from "./errors.ts";
import { SchemaPointerError } from "../common/schema-resolver.ts";
import type { AgentDefinition, RuntimeContext } from "../src_common/types.ts";
import type { ExtendedStepsRegistry } from "../common/validation-types.ts";
import type { Step } from "../common/step-registry.ts";
import { makeStep } from "../common/step-registry/test-helpers.ts";

const logger = new BreakdownLogger("schema");

// =============================================================================
// Stub Helpers
// =============================================================================

/**
 * Minimal AgentDefinition satisfying SchemaManagerDeps.definition.
 */
function createStubDefinition(): AgentDefinition {
  return {
    name: "test-schema",
    displayName: "Schema Test Agent",
    description: "stub",
    version: "1.0.0",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "./prompts/system.md",
        prompts: { registry: "steps_registry.json", fallbackDir: "./prompts" },
      },
      verdict: { type: "poll:state", config: { maxIterations: 5 } },
    },
  };
}

/**
 * Minimal mock logger satisfying the Logger interface used by
 * validateFlowSteps and loadSchemaForStep.
 */
function createMockLogger() {
  const logs: Array<{ level: string; message: string }> = [];
  return {
    _logs: logs,
    debug: (msg: string) => logs.push({ level: "debug", message: msg }),
    info: (msg: string) => logs.push({ level: "info", message: msg }),
    warn: (msg: string, _data?: Record<string, unknown>) =>
      logs.push({ level: "warn", message: msg }),
    error: (msg: string, _data?: Record<string, unknown>) =>
      logs.push({ level: "error", message: msg }),
    log: () => Promise.resolve(),
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
    addContext: () => {},
    getLogPath: () => "/tmp/claude/mock.log",
    logSdkMessage: () => {},
    setToolContext: () => {},
    clearToolContext: () => {},
  } as unknown as import("../src_common/logger.ts").Logger & {
    _logs: Array<{ level: string; message: string }>;
  };
}

/**
 * Create a minimal Step with optional field overrides.
 */
function createStepDef(
  overrides: Partial<Step> & { stepId: string },
): Step {
  return makeStep({
    kind: "work" as const,
    address: { c1: "steps", c2: "initial", c3: "test", edition: "default" },
    stepId: overrides.stepId,
    name: overrides.stepId,
    ...(overrides as Record<string, unknown>),
  });
}

/**
 * Build an ExtendedStepsRegistry from a set of step definitions.
 */
function createRegistry(
  steps: Record<string, Step>,
): ExtendedStepsRegistry {
  return {
    agentId: "test-schema",
    version: "1.0.0",
    c1: "steps",
    steps,
  };
}

/**
 * Create SchemaManagerDeps with optional overrides for the registry.
 */
function createDeps(
  registry: ExtendedStepsRegistry | null = null,
): SchemaManagerDeps {
  return {
    definition: createStubDefinition(),
    getContext: (): RuntimeContext => ({
      verdictHandler: {} as RuntimeContext["verdictHandler"],
      promptResolver: {} as RuntimeContext["promptResolver"],
      logger: createMockLogger() as unknown as RuntimeContext["logger"],
      cwd: "/tmp/claude/test",
    }),
    getStepsRegistry: () => registry,
  };
}

// =============================================================================
// 1. validateFlowSteps - aggregated error text
// =============================================================================

Deno.test("SchemaManager - validateFlowSteps throws aggregated error for missing structuredGate, transitions, and outputSchemaRef", () => {
  const registry = createRegistry({
    "step.alpha": createStepDef({
      stepId: "step.alpha",
      // missing structuredGate, transitions, outputSchemaRef
    }),
    "step.beta": createStepDef({
      stepId: "step.beta",
      structuredGate: {
        allowedIntents: ["next"],
        intentSchemaRef: "#/definitions/beta",
        intentField: "next_action.action",
      },
      // missing transitions and outputSchemaRef
    }),
    // section.* steps should be skipped
    "section.intro": createStepDef({
      stepId: "section.intro",
      // no structuredGate/transitions/outputSchemaRef, but section.* is exempt
    }),
  });

  const deps = createDeps(registry);
  const manager = new SchemaManager(deps);
  const mockLog = createMockLogger();

  let thrownError: Error | null = null;
  try {
    manager.validateFlowSteps(
      registry,
      mockLog as unknown as import("../src_common/logger.ts").Logger,
    );
  } catch (e) {
    thrownError = e as Error;
  }

  // Must throw
  if (!thrownError) {
    throw new Error("Expected validateFlowSteps to throw, but it did not");
  }

  logger.debug("validateFlowSteps error message", {
    message: thrownError.message,
  });

  // Aggregated message must mention all three missing fields
  assertStringIncludes(thrownError.message, "structuredGate");
  assertStringIncludes(thrownError.message, "transitions");
  assertStringIncludes(thrownError.message, "outputSchemaRef");

  // step.alpha should appear in all three missing lists
  assertStringIncludes(thrownError.message, "step.alpha");

  // step.beta should appear in transitions and outputSchemaRef but NOT structuredGate
  assertStringIncludes(thrownError.message, "step.beta");

  // section.intro should NOT appear in the error
  assertEquals(thrownError.message.includes("section.intro"), false);
});

Deno.test("SchemaManager - validateFlowSteps passes when all flow steps have required fields", () => {
  const registry = createRegistry({
    "step.complete": createStepDef({
      stepId: "step.complete",
      structuredGate: {
        allowedIntents: ["next"],
        intentSchemaRef: "#/definitions/complete",
        intentField: "next_action.action",
      },
      transitions: { next: { target: null } },
      outputSchemaRef: { file: "output.schema.json", schema: "complete" },
    }),
  });

  const deps = createDeps(registry);
  const manager = new SchemaManager(deps);
  const mockLog = createMockLogger();

  // Should not throw
  manager.validateFlowSteps(
    registry,
    mockLog as unknown as import("../src_common/logger.ts").Logger,
  );
});

// =============================================================================
// 2. loadSchemaForStep - SchemaPointerError → AgentSchemaResolutionError
// =============================================================================

Deno.test("SchemaManager - loadSchemaForStep throws AgentSchemaResolutionError after 2 consecutive SchemaPointerErrors", async () => {
  const stepId = "initial.issue";
  const registry = createRegistry({
    [stepId]: createStepDef({
      stepId,
      outputSchemaRef: {
        file: "steps.schema.json",
        schema: "#/definitions/initial.issue",
      },
    }),
  });

  const deps = createDeps(registry);
  const manager = new SchemaManager(deps);
  const mockLog = createMockLogger();

  // Stub SchemaResolver.resolve by intercepting loadSchemaFromRef via the
  // private method. Since loadSchemaFromRef calls `new SchemaResolver(...).resolve(...)`,
  // we need the file system to raise SchemaPointerError. We achieve this by
  // monkey-patching the private method on the prototype for this test scope.
  const originalMethod =
    (SchemaManager.prototype as unknown as Record<string, unknown>)[
      "loadSchemaFromRef"
    ];
  (SchemaManager.prototype as unknown as Record<string, unknown>)[
    "loadSchemaFromRef"
  ] = function (
    _ref: { file: string; schema: string },
    _logger: unknown,
  ): Promise<Record<string, unknown> | undefined> {
    throw new SchemaPointerError(
      "#/definitions/initial.issue",
      "steps.schema.json",
    );
  };

  try {
    // First call: failure count = 1, returns undefined, sets schemaResolutionFailed
    const result1 = await manager.loadSchemaForStep(
      stepId,
      1,
      mockLog as unknown as import("../src_common/logger.ts").Logger,
    );
    assertEquals(result1, undefined);
    assertEquals(manager.schemaResolutionFailed, true);

    logger.debug("first failure handled gracefully", {
      schemaResolutionFailed: manager.schemaResolutionFailed,
    });

    // Second call: failure count = 2, should throw AgentSchemaResolutionError
    await assertRejects(
      () =>
        manager.loadSchemaForStep(
          stepId,
          2,
          mockLog as unknown as import("../src_common/logger.ts").Logger,
        ),
      AgentSchemaResolutionError,
      "consecutive times",
    );
  } finally {
    // Restore original method
    (SchemaManager.prototype as unknown as Record<string, unknown>)[
      "loadSchemaFromRef"
    ] = originalMethod;
  }
});

Deno.test("SchemaManager - loadSchemaForStep resets failure count on success", async () => {
  const stepId = "initial.test";
  const registry = createRegistry({
    [stepId]: createStepDef({
      stepId,
      outputSchemaRef: { file: "out.schema.json", schema: "test" },
    }),
  });

  const deps = createDeps(registry);
  const manager = new SchemaManager(deps);
  const mockLog = createMockLogger();

  let callCount = 0;
  const originalMethod =
    (SchemaManager.prototype as unknown as Record<string, unknown>)[
      "loadSchemaFromRef"
    ];
  (SchemaManager.prototype as unknown as Record<string, unknown>)[
    "loadSchemaFromRef"
  ] = function (
    _ref: { file: string; schema: string },
    _logger: unknown,
  ): Promise<Record<string, unknown> | undefined> {
    callCount++;
    if (callCount === 1) {
      // First call: pointer error
      throw new SchemaPointerError("test", "out.schema.json");
    }
    // Second call: success
    return Promise.resolve({ type: "object", properties: {} });
  };

  try {
    // Call 1: failure (count -> 1)
    const r1 = await manager.loadSchemaForStep(
      stepId,
      1,
      mockLog as unknown as import("../src_common/logger.ts").Logger,
    );
    assertEquals(r1, undefined);
    assertEquals(manager.schemaResolutionFailed, true);

    // Call 2: success (count -> 0)
    const r2 = await manager.loadSchemaForStep(
      stepId,
      2,
      mockLog as unknown as import("../src_common/logger.ts").Logger,
    );
    assertEquals(r2, { type: "object", properties: {} });
    assertEquals(manager.schemaResolutionFailed, false);

    // Call 3: simulate another failure - count starts from 0 again so only 1
    callCount = 0; // reset to trigger failure path again
    const r3 = await manager.loadSchemaForStep(
      stepId,
      3,
      mockLog as unknown as import("../src_common/logger.ts").Logger,
    );
    assertEquals(r3, undefined);
    assertEquals(manager.schemaResolutionFailed, true);
  } finally {
    (SchemaManager.prototype as unknown as Record<string, unknown>)[
      "loadSchemaFromRef"
    ] = originalMethod;
  }
});

// =============================================================================
// 3. schemaResolutionFailed flag toggle
// =============================================================================

Deno.test("SchemaManager - schemaResolutionFailed is toggled on pointer miss and cleared on next attempt", async () => {
  const stepId = "continuation.task";
  const registry = createRegistry({
    [stepId]: createStepDef({
      stepId,
      outputSchemaRef: { file: "task.schema.json", schema: "task" },
    }),
  });

  const deps = createDeps(registry);
  const manager = new SchemaManager(deps);
  const mockLog = createMockLogger();

  // Initial state: flag is false
  assertEquals(manager.schemaResolutionFailed, false);

  let shouldFail = true;
  const originalMethod =
    (SchemaManager.prototype as unknown as Record<string, unknown>)[
      "loadSchemaFromRef"
    ];
  (SchemaManager.prototype as unknown as Record<string, unknown>)[
    "loadSchemaFromRef"
  ] = function (
    _ref: { file: string; schema: string },
    _logger: unknown,
  ): Promise<Record<string, unknown> | undefined> {
    if (shouldFail) {
      throw new SchemaPointerError("task", "task.schema.json");
    }
    return Promise.resolve({ type: "object" });
  };

  try {
    // Attempt 1: pointer miss -> flag = true
    await manager.loadSchemaForStep(
      stepId,
      1,
      mockLog as unknown as import("../src_common/logger.ts").Logger,
    );
    assertEquals(
      manager.schemaResolutionFailed,
      true,
      "flag should be true after first pointer miss",
    );

    logger.debug("flag after pointer miss", {
      schemaResolutionFailed: manager.schemaResolutionFailed,
    });

    // Attempt 2: success -> flag = false (reset at start of loadSchemaForStep)
    shouldFail = false;
    await manager.loadSchemaForStep(
      stepId,
      2,
      mockLog as unknown as import("../src_common/logger.ts").Logger,
    );
    assertEquals(
      manager.schemaResolutionFailed,
      false,
      "flag should be false after successful resolution",
    );

    logger.debug("flag after success", {
      schemaResolutionFailed: manager.schemaResolutionFailed,
    });
  } finally {
    (SchemaManager.prototype as unknown as Record<string, unknown>)[
      "loadSchemaFromRef"
    ] = originalMethod;
  }
});

Deno.test("SchemaManager - loadSchemaForStep returns undefined when registry is null", async () => {
  const deps = createDeps(null);
  const manager = new SchemaManager(deps);
  const mockLog = createMockLogger();

  const result = await manager.loadSchemaForStep(
    "any.step",
    1,
    mockLog as unknown as import("../src_common/logger.ts").Logger,
  );
  assertEquals(result, undefined);
  assertEquals(manager.schemaResolutionFailed, false);
});

Deno.test("SchemaManager - loadSchemaForStep throws AgentSchemaResolutionError for malformed outputSchemaRef", async () => {
  const stepId = "bad.ref";
  const registry = createRegistry({
    [stepId]: createStepDef({
      stepId,
      // Set outputSchemaRef to a malformed value (string instead of object)
      outputSchemaRef: "just-a-string" as unknown as {
        file: string;
        schema: string;
      },
    }),
  });

  const deps = createDeps(registry);
  const manager = new SchemaManager(deps);
  const mockLog = createMockLogger();

  await assertRejects(
    () =>
      manager.loadSchemaForStep(
        stepId,
        1,
        mockLog as unknown as import("../src_common/logger.ts").Logger,
      ),
    AgentSchemaResolutionError,
    "Invalid outputSchemaRef format",
  );
});
