/**
 * Flow Executor Tests
 */

import { assertEquals, assertExists, assertThrows } from "@std/assert";
import type { StepRegistry } from "../common/step-registry.ts";
import {
  FlowExecutor,
  getAvailableFlowModes,
  registryHasFlow,
} from "./flow-executor.ts";

// Test registry fixture
const createTestRegistry = (): StepRegistry => ({
  agentId: "test-agent",
  version: "2.0.0",
  c1: "steps",
  flow: {
    issue: ["work", "validate", "complete"],
    simple: ["work"],
  },
  steps: {
    work: {
      stepId: "work",
      name: "Work Step",
      type: "prompt",
      c2: "initial",
      c3: "issue",
      edition: "default",
      fallbackKey: "work",
      uvVariables: ["issue_number"],
      usesStdin: false,
      description: "Main work step",
    },
    validate: {
      stepId: "validate",
      name: "Validate Step",
      type: "prompt",
      c2: "validate",
      c3: "issue",
      edition: "default",
      fallbackKey: "validate",
      uvVariables: [],
      usesStdin: false,
      description: "Validation step",
      context: {
        validators: ["git-clean"],
      },
    },
    complete: {
      stepId: "complete",
      name: "Complete Step",
      type: "prompt",
      c2: "complete",
      c3: "issue",
      edition: "default",
      fallbackKey: "complete",
      uvVariables: ["issue_number"],
      usesStdin: false,
      description: "Completion step",
      context: {
        format: "structuredSignal",
        signalType: "issue-action",
      },
    },
  },
});

// =============================================================================
// FlowExecutor.fromRegistry Tests
// =============================================================================

Deno.test("FlowExecutor.fromRegistry - creates executor for valid mode", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  assertExists(executor);
  assertEquals(executor.getFlowStepIds(), ["work", "validate", "complete"]);
});

Deno.test("FlowExecutor.fromRegistry - throws for invalid mode", () => {
  const registry = createTestRegistry();

  assertThrows(
    () =>
      FlowExecutor.fromRegistry(registry, {
        agentId: "test-agent",
        mode: "nonexistent",
      }),
    Error,
    'No flow defined for mode "nonexistent"',
  );
});

// =============================================================================
// State Management Tests
// =============================================================================

Deno.test("FlowExecutor.getState - returns initial state", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  const state = executor.getState();

  assertEquals(state.currentStepIndex, 0);
  assertEquals(state.totalSteps, 3);
  assertEquals(state.flowName, "issue");
  assertEquals(state.isFlowComplete, false);
  assertEquals(state.currentStep?.stepId, "work");
});

Deno.test("FlowExecutor.getCurrentStep - returns current step", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  const step = executor.getCurrentStep();

  assertExists(step);
  assertEquals(step.stepId, "work");
  assertEquals(step.name, "Work Step");
});

Deno.test("FlowExecutor.getCurrentStepId - returns step ID", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  assertEquals(executor.getCurrentStepId(), "work");
});

// =============================================================================
// Step Advancement Tests
// =============================================================================

Deno.test("FlowExecutor.advanceStep - advances through flow", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  // Initial state
  assertEquals(executor.getCurrentStepId(), "work");
  assertEquals(executor.isComplete(), false);

  // Advance to validate
  assertEquals(executor.advanceStep(), true);
  assertEquals(executor.getCurrentStepId(), "validate");

  // Advance to complete
  assertEquals(executor.advanceStep(), true);
  assertEquals(executor.getCurrentStepId(), "complete");

  // Advance past end
  assertEquals(executor.advanceStep(), true);
  assertEquals(executor.getCurrentStepId(), null);
  assertEquals(executor.isComplete(), true);

  // Cannot advance further
  assertEquals(executor.advanceStep(), false);
});

Deno.test("FlowExecutor.reset - resets to beginning", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  executor.advanceStep();
  executor.advanceStep();
  assertEquals(executor.getCurrentStepId(), "complete");

  executor.reset();
  assertEquals(executor.getCurrentStepId(), "work");
  assertEquals(executor.getState().currentStepIndex, 0);
});

// =============================================================================
// Context Expansion Tests
// =============================================================================

Deno.test("FlowExecutor.expandContext - returns null for step without context", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  // "work" step has no context
  const expanded = executor.expandContext();
  assertEquals(expanded, null);
});

Deno.test("FlowExecutor.expandContext - expands validator context", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  // Advance to validate step
  executor.advanceStep();
  assertEquals(executor.getCurrentStepId(), "validate");

  const expanded = executor.expandContext();

  assertExists(expanded);
  assertEquals(expanded.context.validators, ["git-clean"]);
  assertExists(expanded.validatorInstructions);
  assertEquals(expanded.validatorInstructions?.includes("git status"), true);
});

Deno.test("FlowExecutor.expandContext - expands completion context", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  // Advance to complete step
  executor.advanceStep();
  executor.advanceStep();
  assertEquals(executor.getCurrentStepId(), "complete");

  const expanded = executor.expandContext();

  assertExists(expanded);
  assertEquals(expanded.format, "structuredSignal");
  assertEquals(expanded.signalType, "issue-action");
});

// =============================================================================
// Variable Building Tests
// =============================================================================

Deno.test("FlowExecutor.buildStepVariables - builds variables for work step", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  const variables = executor.buildStepVariables({
    "uv-issue_number": "123",
  });

  assertEquals(variables["uv-issue_number"], "123");
  assertEquals(variables["uv-current_step"], "work");
  assertEquals(variables["uv-current_step_name"], "Work Step");
  assertEquals(variables["uv-step_index"], "1");
  assertEquals(variables["uv-total_steps"], "3");
});

Deno.test("FlowExecutor.buildStepVariables - includes validator instructions", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  executor.advanceStep(); // Move to validate step

  const variables = executor.buildStepVariables();

  assertExists(variables["uv-validator_instructions"]);
  assertEquals(
    variables["uv-validator_instructions"].includes("git status"),
    true,
  );
  assertEquals(variables["uv-step_index"], "2");
});

Deno.test("FlowExecutor.buildStepVariables - includes completion format", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  executor.advanceStep();
  executor.advanceStep(); // Move to complete step

  const variables = executor.buildStepVariables();

  assertEquals(variables["uv-output_format"], "structuredSignal");
  assertEquals(variables["uv-signal_type"], "issue-action");
  assertEquals(variables["uv-step_index"], "3");
});

// =============================================================================
// Helper Method Tests
// =============================================================================

Deno.test("FlowExecutor.getFlowSteps - returns all steps in order", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  const steps = executor.getFlowSteps();

  assertEquals(steps.length, 3);
  assertEquals(steps[0].stepId, "work");
  assertEquals(steps[1].stepId, "validate");
  assertEquals(steps[2].stepId, "complete");
});

Deno.test("FlowExecutor.hasStep - checks step existence in flow", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  assertEquals(executor.hasStep("work"), true);
  assertEquals(executor.hasStep("validate"), true);
  assertEquals(executor.hasStep("complete"), true);
  assertEquals(executor.hasStep("nonexistent"), false);
});

Deno.test("FlowExecutor.getStep - returns step definition", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  const step = executor.getStep("validate");

  assertExists(step);
  assertEquals(step.stepId, "validate");
  assertEquals(step.context?.validators, ["git-clean"]);
});

// =============================================================================
// Utility Function Tests
// =============================================================================

Deno.test("registryHasFlow - checks flow existence", () => {
  const registry = createTestRegistry();

  assertEquals(registryHasFlow(registry, "issue"), true);
  assertEquals(registryHasFlow(registry, "simple"), true);
  assertEquals(registryHasFlow(registry, "nonexistent"), false);
});

Deno.test("getAvailableFlowModes - returns all modes", () => {
  const registry = createTestRegistry();

  const modes = getAvailableFlowModes(registry);

  assertEquals(modes.sort(), ["issue", "simple"]);
});

Deno.test("getAvailableFlowModes - returns empty for registry without flow", () => {
  const registry: StepRegistry = {
    agentId: "test",
    version: "1.0.0",
    c1: "steps",
    steps: {},
  };

  const modes = getAvailableFlowModes(registry);

  assertEquals(modes, []);
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("FlowExecutor - handles single-step flow", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "simple",
  });

  assertEquals(executor.getFlowStepIds(), ["work"]);
  assertEquals(executor.getCurrentStepId(), "work");

  executor.advanceStep();
  assertEquals(executor.isComplete(), true);
  assertEquals(executor.getCurrentStepId(), null);
});

Deno.test("FlowExecutor - custom validator templates", () => {
  const registry = createTestRegistry();
  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
    validatorTemplates: {
      "git-clean": "Custom git validation instruction",
    },
  });

  executor.advanceStep(); // Move to validate step

  const variables = executor.buildStepVariables();

  assertEquals(
    variables["uv-validator_instructions"],
    "Custom git validation instruction",
  );
});

Deno.test("FlowExecutor - unknown validator falls back to generic", () => {
  const registry: StepRegistry = {
    ...createTestRegistry(),
    steps: {
      ...createTestRegistry().steps,
      validate: {
        stepId: "validate",
        name: "Validate Step",
        type: "prompt",
        c2: "validate",
        c3: "issue",
        edition: "default",
        fallbackKey: "validate",
        uvVariables: [],
        usesStdin: false,
        context: {
          validators: ["unknown-validator"],
        },
      },
    },
  };

  const executor = FlowExecutor.fromRegistry(registry, {
    agentId: "test-agent",
    mode: "issue",
  });

  executor.advanceStep();

  const variables = executor.buildStepVariables();

  assertEquals(
    variables["uv-validator_instructions"].includes("unknown-validator"),
    true,
  );
});
