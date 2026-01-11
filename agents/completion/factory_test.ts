/**
 * Factory tests for completion handler creation
 *
 * Tests the factory functions and registry pattern in factory.ts.
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  createCompletionHandler,
  createCompletionHandlerFromOptions,
} from "./factory.ts";
import { IssueCompletionHandler } from "./issue.ts";
import { ProjectCompletionHandler } from "./project.ts";
import { IterateCompletionHandler } from "./iterate.ts";
import { ManualCompletionHandler } from "./manual.ts";
import type { AgentDefinition } from "../src_common/types.ts";

// ============================================================================
// Test helpers
// ============================================================================

/**
 * Create a minimal AgentDefinition for testing
 */
function createTestDefinition(
  completionType: string,
  completionConfig: Record<string, unknown> = {},
): AgentDefinition {
  return {
    version: "1.0.0",
    name: "test-agent",
    displayName: "Test Agent",
    description: "Test agent for factory tests",
    behavior: {
      systemPromptPath: "test/system.md",
      completionType:
        completionType as AgentDefinition["behavior"]["completionType"],
      completionConfig: {
        maxIterations: 100,
        ...completionConfig,
      },
      allowedTools: ["Read", "Write"],
      permissionMode: "plan",
    },
    parameters: {},
    prompts: {
      registry: "prompts/registry.json",
      fallbackDir: "prompts/fallback",
    },
    logging: {
      directory: "logs",
      format: "jsonl",
    },
  };
}

// ============================================================================
// createCompletionHandlerFromOptions tests
// ============================================================================

Deno.test("createCompletionHandlerFromOptions - creates issue handler when issue provided", () => {
  const handler = createCompletionHandlerFromOptions({
    issue: 123,
  });

  assertEquals(handler instanceof IssueCompletionHandler, true);
  assertEquals(handler.type, "issue");
});

Deno.test("createCompletionHandlerFromOptions - creates issue handler with repository", () => {
  const handler = createCompletionHandlerFromOptions({
    issue: 456,
    repository: "owner/repo",
  });

  assertEquals(handler instanceof IssueCompletionHandler, true);
  assertEquals(handler.type, "issue");
});

Deno.test("createCompletionHandlerFromOptions - creates project handler when project provided", () => {
  const handler = createCompletionHandlerFromOptions({
    project: 42,
  });

  assertEquals(handler instanceof ProjectCompletionHandler, true);
  assertEquals(handler.type, "project");
});

Deno.test("createCompletionHandlerFromOptions - creates project handler with all options", () => {
  const handler = createCompletionHandlerFromOptions({
    project: 42,
    projectOwner: "testowner",
    labelFilter: "priority:high",
    includeCompleted: true,
  });

  assertEquals(handler instanceof ProjectCompletionHandler, true);
  assertEquals(handler.type, "project");
});

Deno.test("createCompletionHandlerFromOptions - creates iterate handler when maxIterations provided", () => {
  const handler = createCompletionHandlerFromOptions({
    maxIterations: 50,
  });

  assertEquals(handler instanceof IterateCompletionHandler, true);
  assertEquals(handler.type, "iterate");
});

Deno.test("createCompletionHandlerFromOptions - creates manual handler when completionKeyword provided", () => {
  const handler = createCompletionHandlerFromOptions({
    completionKeyword: "DONE",
  });

  assertEquals(handler instanceof ManualCompletionHandler, true);
  assertEquals(handler.type, "manual");
});

Deno.test("createCompletionHandlerFromOptions - defaults to iterate handler with 100 iterations", () => {
  const handler = createCompletionHandlerFromOptions({});

  assertEquals(handler instanceof IterateCompletionHandler, true);
  assertEquals(handler.type, "iterate");
});

Deno.test("createCompletionHandlerFromOptions - issue takes priority over project", () => {
  const handler = createCompletionHandlerFromOptions({
    issue: 123,
    project: 42,
  });

  // Issue should be created, not project
  assertEquals(handler instanceof IssueCompletionHandler, true);
  assertEquals(handler.type, "issue");
});

Deno.test("createCompletionHandlerFromOptions - project takes priority over maxIterations", () => {
  const handler = createCompletionHandlerFromOptions({
    project: 42,
    maxIterations: 50,
  });

  // Project should be created, not iterate
  assertEquals(handler instanceof ProjectCompletionHandler, true);
  assertEquals(handler.type, "project");
});

// ============================================================================
// createCompletionHandler tests - Type guard behavior through args
// ============================================================================

Deno.test("createCompletionHandler - creates issue handler when args.issue is number", async () => {
  const definition = createTestDefinition("iterationBudget");
  const args = { issue: 123 };

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler instanceof IssueCompletionHandler, true);
  assertEquals(handler.type, "issue");
});

Deno.test("createCompletionHandler - creates issue handler with repository arg", async () => {
  const definition = createTestDefinition("iterationBudget");
  const args = { issue: 456, repository: "owner/repo" };

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler instanceof IssueCompletionHandler, true);
});

Deno.test("createCompletionHandler - rejects invalid issue number (string)", async () => {
  const definition = createTestDefinition("iterationBudget");
  const args = { issue: "not-a-number" };

  await assertRejects(
    async () => {
      await createCompletionHandler(definition, args, "/tmp/test-agent");
    },
    Error,
    "Invalid issue number",
  );
});

Deno.test("createCompletionHandler - rejects invalid issue number (NaN)", async () => {
  const definition = createTestDefinition("iterationBudget");
  const args = { issue: NaN };

  await assertRejects(
    async () => {
      await createCompletionHandler(definition, args, "/tmp/test-agent");
    },
    Error,
    "Invalid issue number",
  );
});

// ============================================================================
// createCompletionHandler tests - Registry pattern by completionType
// ============================================================================

Deno.test("createCompletionHandler - iterationBudget type creates iterate handler", async () => {
  const definition = createTestDefinition("iterationBudget", {
    maxIterations: 50,
  });
  const args = {};

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler instanceof IterateCompletionHandler, true);
  assertEquals(handler.type, "iterate");
});

Deno.test("createCompletionHandler - keywordSignal type creates manual handler", async () => {
  const definition = createTestDefinition("keywordSignal", {
    completionKeyword: "TASK_COMPLETE",
  });
  const args = {};

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler instanceof ManualCompletionHandler, true);
  assertEquals(handler.type, "manual");
});

Deno.test("createCompletionHandler - phaseCompletion type creates project handler", async () => {
  const definition = createTestDefinition("phaseCompletion");
  const args = { project: 42 };

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler instanceof ProjectCompletionHandler, true);
  assertEquals(handler.type, "project");
});

Deno.test("createCompletionHandler - phaseCompletion rejects when project not provided", async () => {
  const definition = createTestDefinition("phaseCompletion");
  const args = {};

  await assertRejects(
    async () => {
      await createCompletionHandler(definition, args, "/tmp/test-agent");
    },
    Error,
    "Invalid project number",
  );
});

Deno.test("createCompletionHandler - externalState type without issue throws error", async () => {
  const definition = createTestDefinition("externalState");
  const args = {};

  await assertRejects(
    async () => {
      await createCompletionHandler(definition, args, "/tmp/test-agent");
    },
    Error,
    "externalState/issue completion type requires --issue parameter",
  );
});

Deno.test("createCompletionHandler - checkBudget type creates check-budget handler", async () => {
  const definition = createTestDefinition("checkBudget", {
    maxChecks: 10,
  });
  const args = {};

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler.type, "checkBudget");
});

Deno.test("createCompletionHandler - structuredSignal type requires signalType config", async () => {
  const definition = createTestDefinition("structuredSignal", {
    // Missing signalType
  });
  const args = {};

  await assertRejects(
    async () => {
      await createCompletionHandler(definition, args, "/tmp/test-agent");
    },
    Error,
    "structuredSignal completion type requires signalType in completionConfig",
  );
});

Deno.test("createCompletionHandler - structuredSignal with signalType creates handler", async () => {
  const definition = createTestDefinition("structuredSignal", {
    signalType: "completion_signal",
  });
  const args = {};

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler.type, "structuredSignal");
});

Deno.test("createCompletionHandler - stepMachine type creates iterate handler (temporary)", async () => {
  const definition = createTestDefinition("stepMachine", {
    maxIterations: 100,
  });
  const args = {};

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  // stepMachine currently falls back to iterate behavior
  assertEquals(handler instanceof IterateCompletionHandler, true);
});

Deno.test("createCompletionHandler - custom type requires handlerPath", async () => {
  const definition = createTestDefinition("custom", {
    // Missing handlerPath
  });
  const args = {};

  await assertRejects(
    async () => {
      await createCompletionHandler(definition, args, "/tmp/test-agent");
    },
    Error,
    "Custom completion type requires handlerPath in completionConfig",
  );
});

// ============================================================================
// createCompletionHandler tests - Legacy type resolution
// ============================================================================

Deno.test("createCompletionHandler - legacy 'issue' type resolves to externalState", async () => {
  const definition = createTestDefinition("issue");
  const args = { issue: 123 };

  // Should work with --issue arg
  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler instanceof IssueCompletionHandler, true);
});

Deno.test("createCompletionHandler - legacy 'iterate' type resolves to iterationBudget", async () => {
  const definition = createTestDefinition("iterate", {
    maxIterations: 25,
  });
  const args = {};

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler instanceof IterateCompletionHandler, true);
});

Deno.test("createCompletionHandler - legacy 'manual' type resolves to keywordSignal", async () => {
  const definition = createTestDefinition("manual", {
    completionKeyword: "FINISH",
  });
  const args = {};

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler instanceof ManualCompletionHandler, true);
});

Deno.test("createCompletionHandler - legacy 'project' type resolves to phaseCompletion", async () => {
  const definition = createTestDefinition("project");
  const args = { project: 99 };

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler instanceof ProjectCompletionHandler, true);
});

Deno.test("createCompletionHandler - legacy 'facilitator' type resolves to composite", async () => {
  const definition = createTestDefinition("facilitator");
  const args = { project: 42 };

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  // Legacy facilitator behavior uses FacilitatorCompletionHandler
  assertEquals(handler.type, "facilitator");
});

Deno.test("createCompletionHandler - legacy 'stepFlow' type resolves to stepMachine", async () => {
  const definition = createTestDefinition("stepFlow", {
    maxIterations: 50,
  });
  const args = {};

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  // stepMachine currently uses iterate handler
  assertEquals(handler instanceof IterateCompletionHandler, true);
});

// ============================================================================
// createCompletionHandler tests - Unknown type
// ============================================================================

Deno.test("createCompletionHandler - unknown type throws error", async () => {
  const definition = createTestDefinition("unknownType" as never);
  const args = {};

  await assertRejects(
    async () => {
      await createCompletionHandler(definition, args, "/tmp/test-agent");
    },
    Error,
    "Unknown completion type: unknownType",
  );
});

// ============================================================================
// createCompletionHandler tests - Optional parameter type guards
// ============================================================================

Deno.test("createCompletionHandler - phaseCompletion with optional string label", async () => {
  const definition = createTestDefinition("phaseCompletion");
  const args = { project: 42, label: "priority:high" };

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler instanceof ProjectCompletionHandler, true);
});

Deno.test("createCompletionHandler - phaseCompletion with undefined label", async () => {
  const definition = createTestDefinition("phaseCompletion");
  const args = { project: 42, label: undefined };

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler instanceof ProjectCompletionHandler, true);
});

Deno.test("createCompletionHandler - phaseCompletion with optional boolean includeCompleted", async () => {
  const definition = createTestDefinition("phaseCompletion");
  const args = { project: 42, includeCompleted: true };

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler instanceof ProjectCompletionHandler, true);
});

Deno.test("createCompletionHandler - phaseCompletion with undefined includeCompleted", async () => {
  const definition = createTestDefinition("phaseCompletion");
  const args = { project: 42, includeCompleted: undefined };

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler instanceof ProjectCompletionHandler, true);
});

Deno.test("createCompletionHandler - issue handler with optional string repository", async () => {
  const definition = createTestDefinition("iterationBudget");
  const args = { issue: 123, repository: "owner/repo" };

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler instanceof IssueCompletionHandler, true);
});

Deno.test("createCompletionHandler - issue handler ignores non-string repository", async () => {
  const definition = createTestDefinition("iterationBudget");
  const args = { issue: 123, repository: 12345 }; // Number, not string

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  // Should still create issue handler, just without repository
  assertEquals(handler instanceof IssueCompletionHandler, true);
});

// ============================================================================
// createCompletionHandler tests - composite type with conditions
// ============================================================================

Deno.test("createCompletionHandler - composite with conditions creates CompositeCompletionHandler", async () => {
  const definition = createTestDefinition("composite", {
    operator: "and",
    conditions: [
      { type: "iterationBudget", config: { maxIterations: 10 } },
      { type: "checkBudget", config: { maxChecks: 5 } },
    ],
  });
  const args = {};

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  assertEquals(handler.type, "composite");
});

Deno.test("createCompletionHandler - composite without conditions falls back to facilitator", async () => {
  const definition = createTestDefinition("composite", {
    // No operator or conditions
  });
  const args = { project: 42 };

  const handler = await createCompletionHandler(
    definition,
    args,
    "/tmp/test-agent",
  );

  // Falls back to FacilitatorCompletionHandler
  assertEquals(handler.type, "facilitator");
});
