// deno-lint-ignore-file require-await
/**
 * Flow Agent Loop Tests
 */

import { assertEquals, assertExists } from "@std/assert";
import type { AgentDefinition } from "../src_common/types.ts";
import type {
  CheckContext,
  CompletionContract,
} from "../src_common/contracts.ts";
import type { StepRegistry } from "../common/step-registry.ts";
import type { SdkMessage } from "../bridge/sdk-bridge.ts";
import {
  createStepPromptBuilder,
  FlowAgentLoop,
  type FlowLoopContext,
} from "./flow-agent-loop.ts";
import type { ExpandedContext } from "./flow-executor.ts";

// =============================================================================
// Test Fixtures
// =============================================================================

const createTestDefinition = (): AgentDefinition => ({
  name: "test-agent",
  displayName: "Test Agent",
  version: "1.0.0",
  description: "Test agent for unit tests",
  behavior: {
    systemPromptPath: "prompts/system.md",
    completionType: "issue",
    completionConfig: {},
    allowedTools: ["Read", "Write"],
    permissionMode: "bypassPermissions",
  },
  parameters: {},
  logging: {
    directory: ".logs",
    format: "jsonl",
  },
  prompts: {
    registry: "prompts/registry.json",
    fallbackDir: "prompts",
  },
});

const createTestRegistry = (): StepRegistry => ({
  agentId: "test-agent",
  version: "2.0.0",
  c1: "steps",
  flow: {
    issue: ["work", "validate", "complete"],
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
      context: {
        format: "structuredSignal",
        signalType: "issue-action",
      },
    },
  },
});

// Mock completion handler
class MockCompletionHandler implements CompletionContract {
  private completeAfterIteration: number;
  private currentIteration = 0;

  constructor(completeAfter = 3) {
    this.completeAfterIteration = completeAfter;
  }

  check(context: CheckContext): { complete: boolean; reason?: string } {
    this.currentIteration = context.iteration;
    if (context.iteration >= this.completeAfterIteration) {
      return { complete: true, reason: "Mock completion" };
    }
    return { complete: false };
  }

  transition(): "continue" | "complete" {
    return this.currentIteration >= this.completeAfterIteration
      ? "complete"
      : "continue";
  }

  buildPrompt(): string {
    return "Mock prompt";
  }

  getCompletionCriteria(): { summary: string; detailed: string } {
    return { summary: "Mock", detailed: "Mock completion criteria" };
  }
}

// Mock query function
function createMockQueryFn(
  responses: string[] = ["Mock response"],
): (
  prompt: string,
  systemPrompt: string,
  sessionId?: string,
) => AsyncIterable<SdkMessage> {
  let callCount = 0;
  return async function* (
    _prompt: string,
    _systemPrompt: string,
    _sessionId?: string,
  ): AsyncIterable<SdkMessage> {
    const response = responses[callCount % responses.length];
    callCount++;

    yield {
      type: "assistant",
      message: { content: response },
    } as unknown as SdkMessage;

    yield {
      type: "result",
      session_id: `session-${callCount}`,
    } as unknown as SdkMessage;
  };
}

// =============================================================================
// FlowAgentLoop.executeWithFlow Tests
// =============================================================================

Deno.test("FlowAgentLoop.executeWithFlow - executes steps in flow order", async () => {
  const loop = new FlowAgentLoop();
  const prompts: { stepId: string; variables: Record<string, string> }[] = [];

  const context: FlowLoopContext = {
    definition: createTestDefinition(),
    cwd: "/test",
    args: { issue: 123 },
    completionHandler: new MockCompletionHandler(4),
    buildSystemPrompt: async () => "System prompt",
    buildStepPrompt: async (stepId, variables, _expandedContext) => {
      prompts.push({ stepId, variables: { ...variables } });
      return `Prompt for ${stepId}`;
    },
    registry: createTestRegistry(),
  };

  const result = await loop.executeWithFlow(context, createMockQueryFn(), {
    agentId: "test-agent",
    mode: "issue",
  });

  assertEquals(result.success, true);
  assertEquals(result.stepsExecuted, ["work", "validate", "complete"]);

  // Verify prompts were built for each step
  assertEquals(prompts.length, 3);
  assertEquals(prompts[0].stepId, "work");
  assertEquals(prompts[1].stepId, "validate");
  assertEquals(prompts[2].stepId, "complete");

  // Verify issue number was passed
  assertEquals(prompts[0].variables["uv-issue_number"], "123");
});

Deno.test("FlowAgentLoop.executeWithFlow - includes context in variables", async () => {
  const loop = new FlowAgentLoop();
  const capturedVariables: Record<string, string>[] = [];

  const context: FlowLoopContext = {
    definition: createTestDefinition(),
    cwd: "/test",
    args: { issue: 456 },
    completionHandler: new MockCompletionHandler(4),
    buildSystemPrompt: async () => "System prompt",
    buildStepPrompt: async (_stepId, variables, _expandedContext) => {
      capturedVariables.push({ ...variables });
      return "Prompt";
    },
    registry: createTestRegistry(),
  };

  await loop.executeWithFlow(context, createMockQueryFn(), {
    agentId: "test-agent",
    mode: "issue",
  });

  // Validate step should have validator instructions
  const validateVars = capturedVariables[1];
  assertExists(validateVars["uv-validator_instructions"]);
  assertEquals(
    validateVars["uv-validator_instructions"].includes("git status"),
    true,
  );

  // Complete step should have signal type
  const completeVars = capturedVariables[2];
  assertEquals(completeVars["uv-output_format"], "structuredSignal");
  assertEquals(completeVars["uv-signal_type"], "issue-action");
});

Deno.test("FlowAgentLoop.executeWithFlow - stops early on completion", async () => {
  const loop = new FlowAgentLoop();

  const context: FlowLoopContext = {
    definition: createTestDefinition(),
    cwd: "/test",
    args: { issue: 789 },
    completionHandler: new MockCompletionHandler(2), // Complete after 2 iterations
    buildSystemPrompt: async () => "System prompt",
    buildStepPrompt: async () => "Prompt",
    registry: createTestRegistry(),
  };

  const result = await loop.executeWithFlow(context, createMockQueryFn(), {
    agentId: "test-agent",
    mode: "issue",
  });

  assertEquals(result.success, true);
  assertEquals(result.iterations, 2);
  assertEquals(result.stepsExecuted, ["work", "validate"]);
  assertEquals(result.finalStep, "validate");
});

Deno.test("FlowAgentLoop.executeWithFlow - stores step outputs in context", async () => {
  const loop = new FlowAgentLoop();

  const context: FlowLoopContext = {
    definition: createTestDefinition(),
    cwd: "/test",
    args: { issue: 111 },
    completionHandler: new MockCompletionHandler(2),
    buildSystemPrompt: async () => "System prompt",
    buildStepPrompt: async () => "Prompt",
    registry: createTestRegistry(),
  };

  await loop.executeWithFlow(
    context,
    createMockQueryFn(["Response 1", "Response 2"]),
    {
      agentId: "test-agent",
      mode: "issue",
    },
  );

  const stepContext = loop.getStepContext();

  // Check that work step output was stored
  const workOutput = stepContext.getAll("work");
  assertExists(workOutput);
  assertEquals(workOutput.iteration, 1);
  assertExists(workOutput.responses);
});

// =============================================================================
// createStepPromptBuilder Tests
// =============================================================================

Deno.test("createStepPromptBuilder - merges expanded context", async () => {
  let capturedVariables: Record<string, string> = {};

  const mockResolver = {
    resolve: async (_stepId: string, variables: Record<string, string>) => {
      capturedVariables = variables;
      return "Resolved prompt";
    },
  };

  const builder = createStepPromptBuilder(mockResolver);

  const expandedContext: ExpandedContext = {
    context: { validators: ["git-clean"] },
    validatorInstructions: "Check git status",
    format: "structuredSignal",
    signalType: "issue-action",
  };

  await builder(
    "validate",
    { "uv-issue_number": "123" },
    expandedContext,
  );

  assertEquals(capturedVariables["uv-issue_number"], "123");
  assertEquals(
    capturedVariables["uv-validator_instructions"],
    "Check git status",
  );
  assertEquals(capturedVariables["uv-output_format"], "structuredSignal");
  assertEquals(capturedVariables["uv-signal_type"], "issue-action");
});

Deno.test("createStepPromptBuilder - handles null expanded context", async () => {
  let capturedVariables: Record<string, string> = {};

  const mockResolver = {
    resolve: async (_stepId: string, variables: Record<string, string>) => {
      capturedVariables = variables;
      return "Resolved prompt";
    },
  };

  const builder = createStepPromptBuilder(mockResolver);

  await builder("work", { "uv-issue_number": "456" }, null);

  assertEquals(capturedVariables["uv-issue_number"], "456");
  assertEquals(capturedVariables["uv-validator_instructions"], undefined);
});

Deno.test("createStepPromptBuilder - falls back on resolver error", async () => {
  const mockResolver = {
    resolve: async () => {
      throw new Error("Not found");
    },
  };

  const builder = createStepPromptBuilder(mockResolver);

  const result = await builder("unknown-step", { "uv-foo": "bar" }, null);

  assertEquals(result.includes("Execute step: unknown-step"), true);
  assertEquals(result.includes("uv-foo"), true);
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test("FlowAgentLoop.executeWithFlow - handles single-step flow", async () => {
  const loop = new FlowAgentLoop();

  const registry: StepRegistry = {
    agentId: "test-agent",
    version: "2.0.0",
    c1: "steps",
    flow: {
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
        uvVariables: [],
        usesStdin: false,
      },
    },
  };

  const context: FlowLoopContext = {
    definition: createTestDefinition(),
    cwd: "/test",
    args: {},
    completionHandler: new MockCompletionHandler(2),
    buildSystemPrompt: async () => "System prompt",
    buildStepPrompt: async () => "Prompt",
    registry,
  };

  const result = await loop.executeWithFlow(context, createMockQueryFn(), {
    agentId: "test-agent",
    mode: "simple",
  });

  // Single step flow, completion at 2, so should complete after 1 step
  assertEquals(result.stepsExecuted, ["work"]);
});

Deno.test("FlowAgentLoop.executeWithFlow - max iterations limit", async () => {
  const loop = new FlowAgentLoop();

  // Create definition with low max iterations
  const definition = createTestDefinition();
  definition.behavior.completionType = "iterate";
  definition.behavior.completionConfig = { maxIterations: 2 };

  // Use completion handler that never completes
  const neverCompleteHandler: CompletionContract = {
    check: () => ({ complete: false }),
    transition: () => "continue" as const,
  };

  const context: FlowLoopContext = {
    definition,
    cwd: "/test",
    args: {},
    completionHandler: neverCompleteHandler,
    buildSystemPrompt: async () => "System prompt",
    buildStepPrompt: async () => "Prompt",
    registry: createTestRegistry(),
  };

  const result = await loop.executeWithFlow(context, createMockQueryFn(), {
    agentId: "test-agent",
    mode: "issue",
  });

  assertEquals(result.success, false);
  assertEquals(result.iterations, 2);
  assertEquals(result.reason.includes("Max iterations"), true);
});
