/**
 * Tests for StepGateInterpreter
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  GateInterpretationError,
  getValueAtPath,
  StepGateInterpreter,
} from "./step-gate-interpreter.ts";
import type { PromptStepDefinition } from "../common/step-registry.ts";

Deno.test("getValueAtPath - extracts simple path", () => {
  const obj = { a: "value" };
  assertEquals(getValueAtPath(obj, "a"), "value");
});

Deno.test("getValueAtPath - extracts nested path", () => {
  const obj = { a: { b: { c: "deep" } } };
  assertEquals(getValueAtPath(obj, "a.b.c"), "deep");
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
    },
  });

  const output = {
    next_action: {
      action: "continue", // maps to "next"
      reason: "Task in progress",
    },
  };

  const result = interpreter.interpret(output, stepDef);

  assertEquals(result.intent, "next");
  assertEquals(result.usedFallback, false);
});

Deno.test("StepGateInterpreter - maps common aliases", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "repeat", "closing", "abort"],
      intentField: "action",
    },
  });

  // Test continue -> next
  assertEquals(
    interpreter.interpret({ action: "continue" }, stepDef).intent,
    "next",
  );

  // Test retry -> repeat
  assertEquals(
    interpreter.interpret({ action: "retry" }, stepDef).intent,
    "repeat",
  );

  // Test done -> closing
  assertEquals(
    interpreter.interpret({ action: "done" }, stepDef).intent,
    "closing",
  );

  // Test escalate -> escalate (now a first-class intent for verification steps)
  const verificationDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "repeat", "escalate"],
      intentField: "action",
    },
  });
  assertEquals(
    interpreter.interpret({ action: "escalate" }, verificationDef).intent,
    "escalate",
  );
});

Deno.test("StepGateInterpreter - validates against allowedIntents", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "repeat"], // "closing" not allowed
      intentField: "action",
      fallbackIntent: "next",
    },
  });

  const result = interpreter.interpret({ action: "closing" }, stepDef);

  assertEquals(result.intent, "next"); // Falls back
  assertEquals(result.usedFallback, true);
  assertEquals(result.reason, "Intent 'closing' not in allowedIntents");
});

Deno.test("StepGateInterpreter - uses fallbackIntent when extraction fails", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "repeat", "closing"],
      intentField: "missing.path",
      fallbackIntent: "repeat",
    },
  });

  const result = interpreter.interpret({ other: "data" }, stepDef);

  assertEquals(result.intent, "repeat");
  assertEquals(result.usedFallback, true);
});

Deno.test("StepGateInterpreter - extracts target for jump intent", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "jump", "closing"],
      intentField: "action",
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
      handoffFields: ["analysis.understanding", "issue.number"],
    },
  });

  const output = {
    status: "next",
    analysis: { understanding: "Problem identified" },
    issue: { number: 123, title: "Test issue" },
  };

  const result = interpreter.interpret(output, stepDef);

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

Deno.test("StepGateInterpreter - infers intentField from common patterns", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: ["next", "closing"],
      // No intentField specified
    },
  });

  // Should find next_action.action
  const output = {
    next_action: { action: "closing" },
  };

  const result = interpreter.interpret(output, stepDef);

  assertEquals(result.intent, "closing");
  assertEquals(result.usedFallback, false);
});

Deno.test("StepGateInterpreter - throws when no valid fallback", () => {
  const interpreter = new StepGateInterpreter();
  const stepDef = createStepDef({
    structuredGate: {
      allowedIntents: [], // Empty - can't fallback
      intentField: "missing",
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
      handoffFields: ["missing.field", "also.missing"],
    },
  });

  const result = interpreter.interpret({ status: "next" }, stepDef);

  assertEquals(result.intent, "next");
  assertEquals(result.handoff, undefined);
});
