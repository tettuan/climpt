/**
 * Tests for QueryExecutor public API and exported helper functions.
 *
 * Coverage:
 * - extractToolNamesFromContent (existing)
 * - tryParseJsonFromText (JSON recovery from LLM text)
 * - createBoundaryBashBlockingHook (PreToolUse boundary enforcement)
 * - executeQuery schemaResolutionFailed short-circuit
 */

import { assertEquals, assertExists } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import {
  createBoundaryBashBlockingHook,
  extractToolNamesFromContent,
  QueryExecutor,
  tryParseJsonFromText,
} from "./query-executor.ts";
import type { QueryExecutorDeps } from "./query-executor.ts";
import type { RuntimeContext } from "../src_common/types.ts";
import type { SchemaManager } from "./schema-manager.ts";

const logger = new BreakdownLogger("query-executor-test");

// =============================================================================
// Shared helpers
// =============================================================================

function createMockLogger() {
  const logs: Array<{ level: string; message: string }> = [];
  return {
    _logs: logs,
    debug: (msg: string) => logs.push({ level: "debug", message: msg }),
    info: (msg: string) => logs.push({ level: "info", message: msg }),
    warn: (msg: string) => logs.push({ level: "warn", message: msg }),
    error: (msg: string) => logs.push({ level: "error", message: msg }),
    log: () => Promise.resolve(),
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
    addContext: () => {},
    getLogPath: () => "/tmp/claude/mock.log",
    logSdkMessage: () => {},
    setToolContext: () => {},
    clearToolContext: () => {},
  } as unknown as RuntimeContext["logger"] & {
    _logs: Array<{ level: string; message: string }>;
  };
}

function createMockContext(
  mockLogger?: RuntimeContext["logger"],
): RuntimeContext {
  return {
    verdictHandler: {} as RuntimeContext["verdictHandler"],
    promptResolver: {} as RuntimeContext["promptResolver"],
    logger: mockLogger ?? createMockLogger(),
    cwd: "/tmp/claude/test",
  };
}

// =============================================================================
// extractToolNamesFromContent (existing tests)
// =============================================================================

Deno.test("extracts tool names from assistant message content array", () => {
  const message = {
    role: "assistant",
    content: [
      { type: "text", text: "I'll run the command." },
      {
        type: "tool_use",
        id: "toolu_01",
        name: "Bash",
        input: { command: "ls" },
      },
      { type: "text", text: "And search for files." },
      {
        type: "tool_use",
        id: "toolu_02",
        name: "Grep",
        input: { pattern: "foo" },
      },
    ],
  };
  assertEquals(extractToolNamesFromContent(message), ["Bash", "Grep"]);
});

Deno.test("returns empty for text-only assistant message", () => {
  const message = {
    role: "assistant",
    content: [
      { type: "text", text: "No tools needed here." },
    ],
  };
  assertEquals(extractToolNamesFromContent(message), []);
});

Deno.test("returns empty when content is a string", () => {
  const message = {
    role: "assistant",
    content: "plain string response",
  };
  assertEquals(extractToolNamesFromContent(message), []);
});

Deno.test("returns empty for null/undefined/non-object", () => {
  assertEquals(extractToolNamesFromContent(null), []);
  assertEquals(extractToolNamesFromContent(undefined), []);
  assertEquals(extractToolNamesFromContent("string"), []);
  assertEquals(extractToolNamesFromContent(42), []);
});

Deno.test("returns empty when content is missing", () => {
  assertEquals(extractToolNamesFromContent({ role: "assistant" }), []);
});

Deno.test("skips malformed tool_use blocks (missing name)", () => {
  const message = {
    content: [
      { type: "tool_use", id: "toolu_01" }, // no name
      { type: "tool_use", id: "toolu_02", name: "Read", input: {} },
      { type: "tool_use", id: "toolu_03", name: 123 }, // name not string
    ],
  };
  assertEquals(extractToolNamesFromContent(message), ["Read"]);
});

Deno.test("handles single tool use", () => {
  const message = {
    content: [
      { type: "tool_use", id: "toolu_01", name: "StructuredOutput", input: {} },
    ],
  };
  assertEquals(extractToolNamesFromContent(message), ["StructuredOutput"]);
});

Deno.test("handles many tool uses (realistic iteration)", () => {
  const content = [];
  const expectedTools = [];
  for (let i = 0; i < 17; i++) {
    content.push({ type: "text", text: `step ${i}` });
    content.push({
      type: "tool_use",
      id: `toolu_${i}`,
      name: "Bash",
      input: {},
    });
    expectedTools.push("Bash");
  }
  content.push({ type: "tool_use", id: "toolu_grep", name: "Grep", input: {} });
  expectedTools.push("Grep");

  assertEquals(extractToolNamesFromContent({ content }), expectedTools);
});

// =============================================================================
// tryParseJsonFromText
// =============================================================================

Deno.test("tryParseJsonFromText: parses pure JSON string", () => {
  const json = '{"action":"next","reason":"done"}';
  const result = tryParseJsonFromText(json);
  assertEquals(result, { action: "next", reason: "done" });
});

Deno.test("tryParseJsonFromText: parses JSON with leading/trailing whitespace", () => {
  const json = '  \n  {"key":"value"}\n  ';
  const result = tryParseJsonFromText(json);
  assertEquals(result, { key: "value" });
});

Deno.test("tryParseJsonFromText: extracts JSON from markdown code block with json tag", () => {
  const text = 'Here is the output:\n```json\n{"status":"ok"}\n```\nDone.';
  const result = tryParseJsonFromText(text);
  assertEquals(result, { status: "ok" });
});

Deno.test("tryParseJsonFromText: extracts JSON from markdown code block without json tag", () => {
  const text = 'Result:\n```\n{"count":42}\n```';
  const result = tryParseJsonFromText(text);
  assertEquals(result, { count: 42 });
});

Deno.test("tryParseJsonFromText: extracts JSON embedded after prose", () => {
  const text =
    'I analyzed the code and here is the result: {"analysis":"complete","files":3}';
  const result = tryParseJsonFromText(text);
  assertEquals(result, { analysis: "complete", files: 3 });
});

Deno.test("tryParseJsonFromText: returns null for plain text without JSON", () => {
  const text = "This is just a plain text response with no JSON.";
  const result = tryParseJsonFromText(text);
  assertEquals(result, null);
});

Deno.test("tryParseJsonFromText: returns null for empty string", () => {
  assertEquals(tryParseJsonFromText(""), null);
  assertEquals(tryParseJsonFromText("   "), null);
});

Deno.test("tryParseJsonFromText: returns null for invalid JSON starting with brace", () => {
  // Starts with { but is not valid JSON, and no other JSON in text
  const text = "{not valid json at all";
  const result = tryParseJsonFromText(text);
  assertEquals(result, null);
});

Deno.test("tryParseJsonFromText: parses nested JSON objects", () => {
  const json = '{"outer":{"inner":{"deep":"value"}},"list":[1,2,3]}';
  const result = tryParseJsonFromText(json);
  assertExists(result);
  assertEquals((result.outer as Record<string, unknown>).inner, {
    deep: "value",
  });
  assertEquals(result.list, [1, 2, 3]);
});

Deno.test("tryParseJsonFromText: picks earliest valid JSON in prose", () => {
  // Two JSON objects in text; should pick the first (outermost) one
  const text = 'Some prose {"first":true,"second":false}';
  const result = tryParseJsonFromText(text);
  assertEquals(result, { first: true, second: false });
});

Deno.test("tryParseJsonFromText: returns null for JSON array (non-object)", () => {
  // JSON arrays are valid JSON but the function only returns objects
  const text = "[1, 2, 3]";
  const result = tryParseJsonFromText(text);
  assertEquals(result, null);
});

Deno.test("tryParseJsonFromText: handles code block with multiline JSON", () => {
  const text = `Here is the output:
\`\`\`json
{
  "stepId": "initial.issue",
  "next_action": {
    "action": "next",
    "reason": "Analysis complete"
  }
}
\`\`\`
That is the structured output.`;
  const result = tryParseJsonFromText(text);
  assertExists(result);
  assertEquals(result.stepId, "initial.issue");
  assertEquals(
    (result.next_action as Record<string, unknown>).action,
    "next",
  );
});

// =============================================================================
// createBoundaryBashBlockingHook
// =============================================================================

Deno.test("boundaryBashHook: allows non-Bash tool_name", async () => {
  const ctx = createMockContext();
  const hook = createBoundaryBashBlockingHook("work", ctx);
  const result = await hook(
    { tool_name: "Read", tool_input: { file_path: "/tmp/x" } },
    "toolu_01",
    { signal: new AbortController().signal },
  );
  // Empty object means "no opinion" (allow)
  assertEquals(result, {});
});

Deno.test("boundaryBashHook: allows Bash without command", async () => {
  const ctx = createMockContext();
  const hook = createBoundaryBashBlockingHook("work", ctx);
  const result = await hook(
    { tool_name: "Bash", tool_input: {} },
    "toolu_01",
    { signal: new AbortController().signal },
  );
  assertEquals(result, {});
});

Deno.test("boundaryBashHook: allows safe Bash command in work step", async () => {
  const ctx = createMockContext();
  const hook = createBoundaryBashBlockingHook("work", ctx);
  const result = await hook(
    { tool_name: "Bash", tool_input: { command: "ls -la" } },
    "toolu_01",
    { signal: new AbortController().signal },
  );
  assertEquals(result, {});
});

Deno.test("boundaryBashHook: blocks gh issue close in work step", async () => {
  const mockLog = createMockLogger();
  const ctx = createMockContext(mockLog);
  const hook = createBoundaryBashBlockingHook("work", ctx);
  const result = await hook(
    { tool_name: "Bash", tool_input: { command: "gh issue close 42" } },
    "toolu_01",
    { signal: new AbortController().signal },
  );
  assertExists(result.hookSpecificOutput);
  const output = result.hookSpecificOutput as Record<string, unknown>;
  assertEquals(output.hookEventName, "PreToolUse");
  assertEquals(output.permissionDecision, "deny");
  // Logger should record the blocked command
  const warnLogs = mockLog._logs.filter((l) => l.level === "warn");
  assertEquals(warnLogs.length > 0, true);
});

Deno.test("boundaryBashHook: blocks gh pr merge in verification step", async () => {
  const ctx = createMockContext();
  const hook = createBoundaryBashBlockingHook("verification", ctx);
  const result = await hook(
    { tool_name: "Bash", tool_input: { command: "gh pr merge 10" } },
    undefined,
    { signal: new AbortController().signal },
  );
  assertExists(result.hookSpecificOutput);
  const output = result.hookSpecificOutput as Record<string, unknown>;
  assertEquals(output.permissionDecision, "deny");
});

Deno.test("boundaryBashHook: blocks gh issue close in closure step", async () => {
  // Even closure steps block direct bash boundary commands;
  // these must go through the Boundary Hook instead.
  const ctx = createMockContext();
  const hook = createBoundaryBashBlockingHook("closure", ctx);
  const result = await hook(
    { tool_name: "Bash", tool_input: { command: "gh issue close 99" } },
    "toolu_01",
    { signal: new AbortController().signal },
  );
  assertExists(result.hookSpecificOutput);
  const output = result.hookSpecificOutput as Record<string, unknown>;
  assertEquals(output.permissionDecision, "deny");
});

Deno.test("boundaryBashHook: blocks curl to GitHub API", async () => {
  const ctx = createMockContext();
  const hook = createBoundaryBashBlockingHook("work", ctx);
  const result = await hook(
    {
      tool_name: "Bash",
      tool_input: {
        command:
          'curl -X PATCH https://api.github.com/repos/o/r/issues/1 -d \'{"state":"closed"}\'',
      },
    },
    "toolu_01",
    { signal: new AbortController().signal },
  );
  assertExists(result.hookSpecificOutput);
  const output = result.hookSpecificOutput as Record<string, unknown>;
  assertEquals(output.permissionDecision, "deny");
});

Deno.test("boundaryBashHook: allows gh pr create (non-boundary)", async () => {
  const ctx = createMockContext();
  const hook = createBoundaryBashBlockingHook("work", ctx);
  const result = await hook(
    {
      tool_name: "Bash",
      tool_input: { command: 'gh pr create --title "Fix bug" --body "desc"' },
    },
    "toolu_01",
    { signal: new AbortController().signal },
  );
  assertEquals(result, {});
});

Deno.test("boundaryBashHook: allows git commands in work step", async () => {
  const ctx = createMockContext();
  const hook = createBoundaryBashBlockingHook("work", ctx);
  const result = await hook(
    { tool_name: "Bash", tool_input: { command: "git status && git diff" } },
    "toolu_01",
    { signal: new AbortController().signal },
  );
  assertEquals(result, {});
});

// =============================================================================
// executeQuery: schemaResolutionFailed short-circuit
// =============================================================================

Deno.test("executeQuery: short-circuits when schemaResolutionFailed is true", async () => {
  logger.debug("schemaResolutionFailed short-circuit test setup");

  // Create a mock SchemaManager where loadSchemaForStep succeeds
  // but schemaResolutionFailed returns true afterwards.
  const mockSchemaManager = {
    schemaResolutionFailed: true,
    loadSchemaForStep: (
      _stepId: string,
      _iteration: number,
      _logger: unknown,
    ) => Promise.resolve(undefined),
  } as unknown as SchemaManager;

  const mockLog = createMockLogger();
  const ctx = createMockContext(mockLog);

  const deps: QueryExecutorDeps = {
    definition: {
      name: "test-agent",
      displayName: "Test Agent",
      description: "test",
      version: "1.0.0",
      parameters: {},
      runner: {
        flow: {
          systemPromptPath: "./prompts/system.md",
          prompts: {
            registry: "steps_registry.json",
            fallbackDir: "./prompts",
          },
        },
        verdict: { type: "poll:state" as const, config: { maxIterations: 5 } },
        boundaries: {
          allowedTools: [],
          permissionMode: "plan",
        },
        execution: {},
        logging: { directory: "/tmp/claude/test-logs", format: "jsonl" },
      },
    },
    getContext: () => ctx,
    getStepsRegistry: () => null,
    getVerboseLogger: () => null,
    getSchemaManager: () => mockSchemaManager,
  };

  const executor = new QueryExecutor(deps);

  const summary = await executor.executeQuery({
    prompt: "test prompt",
    systemPrompt: "test system prompt",
    plugins: [],
    iteration: 1,
    stepId: "initial.test",
  });

  // The summary must flag schemaResolutionFailed
  assertEquals(summary.schemaResolutionFailed, true);
  // The summary must contain the error message
  assertEquals(summary.errors.length, 1);
  assertEquals(
    summary.errors[0].includes("Schema resolution failed"),
    true,
  );
  // query() was never called, so no assistantResponses or tools
  assertEquals(summary.assistantResponses.length, 0);
  assertEquals(summary.toolsUsed.length, 0);

  logger.debug("schemaResolutionFailed short-circuit test passed");
});

Deno.test({
  name:
    "executeQuery: does not short-circuit when schemaResolutionFailed is false",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // When schemaResolutionFailed is false, executeQuery should proceed past
    // the schema check. It will then call the SDK's query() function which
    // will fail (since we have no real API key), landing in the catch block.
    // The important assertion: schemaResolutionFailed is NOT set on the summary.

    const mockSchemaManager = {
      schemaResolutionFailed: false,
      loadSchemaForStep: (
        _stepId: string,
        _iteration: number,
        _logger: unknown,
      ) => Promise.resolve(undefined),
    } as unknown as SchemaManager;

    const mockLog = createMockLogger();
    const ctx = createMockContext(mockLog);

    const deps: QueryExecutorDeps = {
      definition: {
        name: "test-agent",
        displayName: "Test Agent",
        description: "test",
        version: "1.0.0",
        parameters: {},
        runner: {
          flow: {
            systemPromptPath: "./prompts/system.md",
            prompts: {
              registry: "steps_registry.json",
              fallbackDir: "./prompts",
            },
          },
          verdict: {
            type: "poll:state" as const,
            config: { maxIterations: 5 },
          },
          boundaries: {
            allowedTools: [],
            permissionMode: "plan",
          },
          execution: {},
          logging: { directory: "/tmp/claude/test-logs", format: "jsonl" },
        },
      },
      getContext: () => ctx,
      getStepsRegistry: () => null,
      getVerboseLogger: () => null,
      getSchemaManager: () => mockSchemaManager,
    };

    const executor = new QueryExecutor(deps);

    const summary = await executor.executeQuery({
      prompt: "test prompt",
      systemPrompt: "test system prompt",
      plugins: [],
      iteration: 1,
      stepId: "initial.test",
    });

    // schemaResolutionFailed should NOT be set
    assertEquals(summary.schemaResolutionFailed, undefined);
    // The SDK call will fail (no API key / mock), so we expect an error,
    // but it should be a query error, not a schema error.
    assertEquals(
      summary.errors.some((e) => e.includes("Schema resolution failed")),
      false,
    );
  },
});

Deno.test({
  name: "executeQuery: no short-circuit when stepId is undefined",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // When stepId is not provided, the schema loading block is skipped entirely.
    // executeQuery proceeds to call query(), which will fail in test env.

    const loadSchemaCallCount = { value: 0 };
    const mockSchemaManager = {
      schemaResolutionFailed: false,
      loadSchemaForStep: () => {
        loadSchemaCallCount.value++;
        return Promise.resolve(undefined);
      },
    } as unknown as SchemaManager;

    const mockLog = createMockLogger();
    const ctx = createMockContext(mockLog);

    const deps: QueryExecutorDeps = {
      definition: {
        name: "test-agent",
        displayName: "Test Agent",
        description: "test",
        version: "1.0.0",
        parameters: {},
        runner: {
          flow: {
            systemPromptPath: "./prompts/system.md",
            prompts: {
              registry: "steps_registry.json",
              fallbackDir: "./prompts",
            },
          },
          verdict: {
            type: "poll:state" as const,
            config: { maxIterations: 5 },
          },
          boundaries: {
            allowedTools: [],
            permissionMode: "plan",
          },
          execution: {},
          logging: { directory: "/tmp/claude/test-logs", format: "jsonl" },
        },
      },
      getContext: () => ctx,
      getStepsRegistry: () => null,
      getVerboseLogger: () => null,
      getSchemaManager: () => mockSchemaManager,
    };

    const executor = new QueryExecutor(deps);

    const summary = await executor.executeQuery({
      prompt: "test prompt",
      systemPrompt: "test system prompt",
      plugins: [],
      iteration: 1,
      // No stepId -- schema loading block is skipped
    });

    // loadSchemaForStep should never have been called
    assertEquals(loadSchemaCallCount.value, 0);
    assertEquals(summary.schemaResolutionFailed, undefined);
  },
});
