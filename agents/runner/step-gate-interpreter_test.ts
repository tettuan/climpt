/**
 * Tests for StepGateInterpreter
 */

import { assertEquals, assertThrows } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import {
  GateInterpretationError,
  getValueAtPath,
  StepGateInterpreter,
} from "./step-gate-interpreter.ts";
import type { PromptStepDefinition } from "../common/step-registry.ts";

const logger = new BreakdownLogger("gate");

Deno.test("getValueAtPath - extracts simple path", () => {
  const obj = { a: "value" };
  assertEquals(getValueAtPath(obj, "a"), "value");
});

Deno.test("getValueAtPath - extracts nested path", () => {
  const obj = { a: { b: { c: "deep" } } };
  logger.debug("getValueAtPath input", { path: "a.b.c" });
  const result = getValueAtPath(obj, "a.b.c");
  logger.debug("getValueAtPath result", { result });
  assertEquals(result, "deep");
});

Deno.test("getValueAtPath - returns undefined for missing path", () => {
  const obj = { a: { b: "value" } };
  assertEquals(getValueAtPath(obj, "a.c"), undefined);
});

Deno.test("getValueAtPath - handles array index", () => {
  const obj = { items: ["first", "second"] };
  assertEquals(getValueAtPath(obj, "items.0"), "first");
});

Deno.test("getValueAtPath - returns undefined for null intermediate", () => {
  const obj = { a: null };
  assertEquals(getValueAtPath(obj, "a.b"), undefined);
});

// Helper to create minimal step definition
function createStepDef(
  overrides: Partial<PromptStepDefinition> = {},
): PromptStepDefinition {
  return {
    stepId: "test.step",
    name: "Test Step",
    c2: "test",
    c3: "step",
    edition: "default",
    fallbackKey: "test_fallback",
    uvVariables: [],
    usesStdin: false,
    ...overrides,
  };
}

Deno.test("StepGateInterpreter - returns fallback when no structuredGate", () => {
  const interpreter = new StepGateInterpreter();
  const result = interpreter.interpret({}, createStepDef());

  assertEquals(result.intent, "next");
  assertEquals(result.usedFallback, true);
  assertEquals(result.reason, "No structuredGate configuration");
});

Deno.test("StepGateInterpreter - extracts intent from simple path", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "closing"],
      intentField: "status",
      intentSchemaRef: "#/test",
    },
  });

  const result = interpreter.interpret({ status: "closing" }, stepDef);

  assertEquals(result.intent, "closing");
  assertEquals(result.usedFallback, false);
});

Deno.test("StepGateInterpreter - extracts intent from nested path", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "repeat", "closing"],
      intentField: "next_action.action",
      intentSchemaRef: "#/test",
    },
  });

  const output = {
    next_action: {
      action: "continue", // maps to "next"
      reason: "Task in progress",
    },
  };

  logger.debug("nested intent input", {
    intentField: "next_action.action",
    rawAction: output.next_action.action,
  });
  const result = interpreter.interpret(output, stepDef);
  logger.debug("nested intent result", {
    intent: result.intent,
    usedFallback: result.usedFallback,
  });

  assertEquals(result.intent, "next");
  assertEquals(result.usedFallback, false);
});

Deno.test("StepGateInterpreter - maps common aliases", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "repeat", "closing", "abort"],
      intentField: "action",
      intentSchemaRef: "#/test",
    },
  });

  // Test continue -> next
  const nextResult = interpreter.interpret({ action: "continue" }, stepDef);
  logger.debug("alias mapping", {
    input: "continue",
    output: nextResult.intent,
  });
  assertEquals(nextResult.intent, "next");

  // Test retry -> repeat
  const repeatResult = interpreter.interpret({ action: "retry" }, stepDef);
  logger.debug("alias mapping", {
    input: "retry",
    output: repeatResult.intent,
  });
  assertEquals(repeatResult.intent, "repeat");

  // Test done -> closing
  const closingResult = interpreter.interpret({ action: "done" }, stepDef);
  logger.debug("alias mapping", {
    input: "done",
    output: closingResult.intent,
  });
  assertEquals(closingResult.intent, "closing");

  // Test escalate -> escalate (now a first-class intent for verification steps)
  const verificationDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "repeat", "escalate"],
      intentField: "action",
      intentSchemaRef: "#/test",
    },
  });
  assertEquals(
    interpreter.interpret({ action: "escalate" }, verificationDef).intent,
    "escalate",
  );
});

Deno.test("StepGateInterpreter - validates against allowedIntents (with failFast=false)", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "repeat"], // "closing" not allowed
      intentField: "action",
      intentSchemaRef: "#/test",
      failFast: false, // Explicitly disable for fallback test
      fallbackIntent: "next",
    },
  });

  const result = interpreter.interpret({ action: "closing" }, stepDef);

  assertEquals(result.intent, "next"); // Falls back
  assertEquals(result.usedFallback, true);
  assertEquals(result.reason, "Intent 'closing' not in allowedIntents");
});

Deno.test("StepGateInterpreter - uses fallbackIntent when extraction fails (with failFast=false)", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "repeat", "closing"],
      intentField: "missing.path",
      intentSchemaRef: "#/test",
      failFast: false, // Explicitly disable for fallback test
      fallbackIntent: "repeat",
    },
  });

  logger.debug("fallback input", {
    intentField: "missing.path",
    failFast: false,
    fallbackIntent: "repeat",
  });
  const result = interpreter.interpret({ other: "data" }, stepDef);
  logger.debug("fallback result", {
    intent: result.intent,
    usedFallback: result.usedFallback,
  });

  assertEquals(result.intent, "repeat");
  assertEquals(result.usedFallback, true);
});

Deno.test("StepGateInterpreter - extracts target for jump intent", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "jump", "closing"],
      intentField: "action",
      intentSchemaRef: "#/test",
      targetField: "details.target",
    },
  });

  const output = {
    action: "jump",
    details: { target: "s_review" },
  };

  const result = interpreter.interpret(output, stepDef);

  assertEquals(result.intent, "jump");
  assertEquals(result.target, "s_review");
  assertEquals(result.usedFallback, false);
});

Deno.test("StepGateInterpreter - extracts handoff fields", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "closing"],
      intentField: "status",
      intentSchemaRef: "#/test",
      handoffFields: ["analysis.understanding", "issue.number"],
    },
  });

  const output = {
    status: "next",
    analysis: { understanding: "Problem identified" },
    issue: { number: 123, title: "Test issue" },
  };

  const result = interpreter.interpret(output, stepDef);
  logger.debug("handoff extraction", {
    handoffFields: stepDef.structuredGate?.handoffFields,
    result: result.handoff,
  });

  assertEquals(result.intent, "next");
  assertEquals(result.handoff, {
    understanding: "Problem identified",
    number: 123,
  });
});

Deno.test("StepGateInterpreter - extracts reason from output", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "closing"],
      intentField: "next_action.action",
      intentSchemaRef: "#/test",
    },
  });

  const output = {
    next_action: {
      action: "closing",
      reason: "All tests passed",
    },
  };

  const result = interpreter.interpret(output, stepDef);

  assertEquals(result.intent, "closing");
  assertEquals(result.reason, "All tests passed");
});

Deno.test("StepGateInterpreter - missing intentField uses fallback (defensive, failFast=false)", () => {
  // NOTE: intentField is now required in StructuredGate interface.
  // This test covers the defensive runtime check for bad data with failFast=false.
  const interpreter = new StepGateInterpreter();

  // Force cast to bypass TypeScript - simulating bad runtime data
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "closing"],
      intentSchemaRef: "#/test",
      failFast: false, // Explicitly disable for fallback test
      // intentField intentionally omitted to test defensive check
    } as unknown as import("../common/step-registry.ts").StructuredGate,
  });

  const output = {
    next_action: { action: "closing" },
  };

  const result = interpreter.interpret(output, stepDef);

  // Should use fallback since intentField is missing
  assertEquals(result.intent, "next"); // First allowed intent as fallback
  assertEquals(result.usedFallback, true);
  assertEquals(
    result.reason,
    "intentField is required but missing - config error",
  );
});

Deno.test("StepGateInterpreter - throws when no valid fallback", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: [], // Empty - can't fallback
      intentField: "missing",
      intentSchemaRef: "#/test",
    },
  });

  assertThrows(
    () => interpreter.interpret({}, stepDef),
    GateInterpretationError,
    "Cannot determine intent",
  );
});

Deno.test("StepGateInterpreter - case insensitive intent matching", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "closing"],
      intentField: "status",
      intentSchemaRef: "#/test",
    },
  });

  assertEquals(
    interpreter.interpret({ status: "CLOSING" }, stepDef).intent,
    "closing",
  );

  assertEquals(
    interpreter.interpret({ status: "Next" }, stepDef).intent,
    "next",
  );
});

Deno.test("StepGateInterpreter - handles empty handoff when no fields match", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next"],
      intentField: "status",
      intentSchemaRef: "#/test",
      handoffFields: ["missing.field", "also.missing"],
    },
  });

  const result = interpreter.interpret({ status: "next" }, stepDef);

  assertEquals(result.intent, "next");
  assertEquals(result.handoff, undefined);
});

// =============================================================================
// failFast Mode Tests (Design Doc Section 4/6)
// =============================================================================

Deno.test("StepGateInterpreter - failFast throws when intent cannot be determined", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "closing"],
      intentField: "missing.path",
      intentSchemaRef: "#/test",
      failFast: true,
    },
  });

  logger.debug("failFast input", {
    intentField: "missing.path",
    failFast: true,
    output: {},
  });
  assertThrows(
    () => interpreter.interpret({}, stepDef),
    GateInterpretationError,
    "failFast",
  );
});

Deno.test("StepGateInterpreter - failFast throws when intent not in allowedIntents", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "repeat"], // closing not allowed
      intentField: "action",
      intentSchemaRef: "#/test",
      failFast: true,
    },
  });

  assertThrows(
    () => interpreter.interpret({ action: "closing" }, stepDef),
    GateInterpretationError,
    "failFast",
  );
});

Deno.test("StepGateInterpreter - failFast error includes stepId", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    stepId: "test.failfast.step",
    structuredGate: {
      allowedIntents: ["next"],
      intentField: "missing",
      intentSchemaRef: "#/test",
      failFast: true,
    },
  });

  try {
    interpreter.interpret({}, stepDef);
    throw new Error("Should have thrown");
  } catch (e) {
    if (e instanceof GateInterpretationError) {
      assertEquals(e.stepId, "test.failfast.step");
    } else {
      throw e;
    }
  }
});

Deno.test("StepGateInterpreter - failFast=false uses fallback (default behavior)", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "closing"],
      intentField: "missing.path",
      intentSchemaRef: "#/test",
      failFast: false,
      fallbackIntent: "next",
    },
  });

  // Should NOT throw, should use fallback
  const result = interpreter.interpret({}, stepDef);
  assertEquals(result.intent, "next");
  assertEquals(result.usedFallback, true);
});
