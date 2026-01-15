/**
 * Closer Tests
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { Closer, CLOSER_OUTPUT_SCHEMA, createCloser } from "./mod.ts";
import type { CloserInput, CloserQueryFn, CloserResult } from "./types.ts";

// No-op test logger (lint-compliant)
const testLogger = {
  debug: (_msg: string) => {},
  info: (_msg: string) => {},
  warn: (_msg: string) => {},
  error: (_msg: string) => {},
};

Deno.test("Closer - exports", () => {
  // Verify exports
  assertExists(Closer);
  assertExists(createCloser);
  assertExists(CLOSER_OUTPUT_SCHEMA);
});

Deno.test("Closer - schema structure", () => {
  // Verify schema has required properties
  assertEquals(CLOSER_OUTPUT_SCHEMA.type, "object");
  assertExists(CLOSER_OUTPUT_SCHEMA.properties.checklist);
  assertExists(CLOSER_OUTPUT_SCHEMA.properties.allComplete);
  assertExists(CLOSER_OUTPUT_SCHEMA.properties.summary);

  // Required fields
  assertEquals(CLOSER_OUTPUT_SCHEMA.required, [
    "checklist",
    "allComplete",
    "summary",
  ]);
});

Deno.test("Closer - createCloser factory", () => {
  const closer = createCloser({
    workingDir: Deno.cwd(),
    agentId: "iterator",
    logger: testLogger,
  });

  assertExists(closer);
  assertEquals(typeof closer.check, "function");
});

Deno.test("Closer - check with mock query (complete)", async () => {
  const closer = createCloser({
    workingDir: Deno.cwd(),
    agentId: "iterator",
    logger: testLogger,
  });

  const input: CloserInput = {
    structuredOutput: {
      tests_passed: true,
      type_check_passed: true,
      lint_passed: true,
      git_clean: true,
    },
    stepId: "complete.issue",
    c3l: { c2: "complete", c3: "issue" },
  };

  // Mock query that returns complete status
  const mockQuery: CloserQueryFn = (_prompt, _options) => {
    const output = {
      checklist: [
        { id: "tests", description: "Tests pass", completed: true },
        { id: "types", description: "Type check passes", completed: true },
        { id: "lint", description: "Lint passes", completed: true },
        { id: "git", description: "Git clean", completed: true },
      ],
      allComplete: true,
      summary: "All completion requirements met",
    };
    return Promise.resolve({
      structuredOutput: output as Record<string, unknown>,
    });
  };

  const result = await closer.check(input, mockQuery);

  assertEquals(result.complete, true);
  assertEquals(result.output.allComplete, true);
  assertEquals(result.output.checklist.length, 4);
  assertEquals(result.error, undefined);
});

Deno.test("Closer - check with mock query (incomplete)", async () => {
  const closer = createCloser({
    workingDir: Deno.cwd(),
    agentId: "iterator",
    logger: testLogger,
  });

  const input: CloserInput = {
    structuredOutput: {
      tests_passed: false,
      type_check_passed: true,
      lint_passed: true,
      git_clean: false,
    },
    stepId: "complete.issue",
    c3l: { c2: "complete", c3: "issue" },
  };

  // Mock query that returns incomplete status
  const mockQuery: CloserQueryFn = (_prompt, _options) => {
    const output = {
      checklist: [
        {
          id: "tests",
          description: "Tests pass",
          completed: false,
          evidence: "tests_passed is false",
        },
        { id: "types", description: "Type check passes", completed: true },
        { id: "lint", description: "Lint passes", completed: true },
        {
          id: "git",
          description: "Git clean",
          completed: false,
          evidence: "git_clean is false",
        },
      ],
      allComplete: false,
      summary: "Tests failing and git working directory dirty",
      pendingActions: ["Fix failing tests", "Commit or stash changes"],
    };
    return Promise.resolve({
      structuredOutput: output as Record<string, unknown>,
    });
  };

  const result = await closer.check(input, mockQuery);

  assertEquals(result.complete, false);
  assertEquals(result.output.allComplete, false);
  assertExists(result.output.pendingActions);
  assertEquals(result.output.pendingActions?.length, 2);
});

Deno.test("Closer - check with allComplete true completes", async () => {
  const closer = createCloser({
    workingDir: Deno.cwd(),
    agentId: "iterator",
    logger: testLogger,
  });

  const input: CloserInput = {
    structuredOutput: {},
    stepId: "complete.issue",
    c3l: { c2: "complete", c3: "issue" },
  };

  // Mock query that returns allComplete true
  const mockQuery: CloserQueryFn = (_prompt, _options) => {
    const output = {
      checklist: [
        { id: "tests", description: "Tests pass", completed: true },
      ],
      allComplete: true,
      summary: "All tasks complete",
    };
    return Promise.resolve({
      structuredOutput: output as Record<string, unknown>,
    });
  };

  const result = await closer.check(input, mockQuery);

  // Should be complete when allComplete is true
  assertEquals(result.complete, true);
  assertEquals(result.output.allComplete, true);
});

Deno.test("Closer - check with query error", async () => {
  const closer = createCloser({
    workingDir: Deno.cwd(),
    agentId: "iterator",
    logger: testLogger,
  });

  const input: CloserInput = {
    structuredOutput: { tests_passed: true },
    stepId: "complete.issue",
    c3l: { c2: "complete", c3: "issue" },
  };

  // Mock query that returns error
  const mockQuery: CloserQueryFn = (_prompt, _options) => {
    return Promise.resolve({ error: "API error" });
  };

  const result = await closer.check(input, mockQuery);

  assertEquals(result.complete, false);
  assertExists(result.error);
  assertEquals(result.output.allComplete, false);
});

Deno.test("Closer - check with invalid structured output", async () => {
  const closer = createCloser({
    workingDir: Deno.cwd(),
    agentId: "iterator",
    logger: testLogger,
  });

  const input: CloserInput = {
    structuredOutput: { tests_passed: true },
    stepId: "complete.issue",
    c3l: { c2: "complete", c3: "issue" },
  };

  // Mock query that returns invalid output
  const mockQuery: CloserQueryFn = (_prompt, _options) => {
    return Promise.resolve({
      structuredOutput: {
        invalid: "output",
      },
    });
  };

  const result = await closer.check(input, mockQuery);

  assertEquals(result.complete, false);
  assertExists(result.error);
});

Deno.test("Closer - types are exported correctly", () => {
  // Type checking at compile time
  const input: CloserInput = {
    structuredOutput: {},
    stepId: "test",
    c3l: { c2: "complete", c3: "issue" },
  };

  const result: CloserResult = {
    complete: true,
    output: {
      checklist: [],
      allComplete: true,
      summary: "test",
    },
  };

  assertExists(input);
  assertExists(result);
});
