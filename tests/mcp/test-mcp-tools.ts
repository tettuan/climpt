/**
 * @fileoverview Minimal test suite for MCP tools
 *
 * Tests the core use cases:
 * 1. Search: Find commands using natural language queries
 * 2. Describe: Get detailed command definitions by c1/c2/c3
 * 3. Execute: Tested via integration tests in tests/mcp_test.ts
 *
 * Note: Execute tool tests are primarily integration tests that verify
 * the command construction and execution logic, tested separately.
 */

import { assertEquals, assertExists } from "@std/assert";
import type { Command } from "../../src/mcp/types.ts";
import { describeCommand, searchCommands } from "../../src/mcp/similarity.ts";
import { createTestLogger } from "../test-utils.ts";

const logger = createTestLogger("mcp-tools");

/**
 * Load registry for testing
 */
const registry = JSON.parse(
  await Deno.readTextFile(".agent/climpt/registry.json"),
);

const commands: Command[] = registry.tools.commands;

/**
 * Test Suite: Search Tool
 */
Deno.test("search: returns top 3 results for git commit query", () => {
  const query = "commit changes to git repository";
  const results = searchCommands(commands, query, 3);

  // Should return exactly 3 results
  assertEquals(results.length, 3);

  // First result should be git-related
  assertExists(results[0].c1);
  assertExists(results[0].c2);
  assertExists(results[0].c3);
  assertExists(results[0].description);
  assertExists(results[0].score);

  // Scores should be in descending order
  assertEquals(results[0].score >= results[1].score, true);
  assertEquals(results[1].score >= results[2].score, true);

  logger.debug("searchCommands git-commit results", {
    results: results.map((r, i) => ({
      rank: i + 1,
      score: r.score.toFixed(3),
      command: `${r.c1} ${r.c2} ${r.c3}`,
    })),
  });
});

Deno.test("search: returns top 3 results for documentation query", () => {
  const query = "create documentation for API";
  const results = searchCommands(commands, query, 3);

  assertEquals(results.length, 3);

  // All results should have required fields
  for (const result of results) {
    assertExists(result.c1);
    assertExists(result.c2);
    assertExists(result.c3);
    assertExists(result.description);
    assertExists(result.score);
  }

  logger.debug("searchCommands documentation results", {
    results: results.map((r, i) => ({
      rank: i + 1,
      score: r.score.toFixed(3),
      command: `${r.c1} ${r.c2} ${r.c3}`,
    })),
  });
});

Deno.test("search: deduplicates commands by c1+c2+c3", () => {
  const query = "analyze code";
  const results = searchCommands(commands, query, 10);

  // Check that no duplicate c1+c2+c3 combinations exist
  const seen = new Set();
  for (const result of results) {
    const key = `${result.c1}:${result.c2}:${result.c3}`;
    assertEquals(seen.has(key), false, `Duplicate found: ${key}`);
    seen.add(key);
  }

  logger.debug("searchCommands deduplication result", {
    uniqueKeys: seen.size,
  });
});

/**
 * Test Suite: Describe Tool
 */
Deno.test("describe: returns command details for valid c1/c2/c3", () => {
  const c1 = "git";
  const c2 = "group-commit";
  const c3 = "unstaged-changes";

  const results = describeCommand(commands, c1, c2, c3);

  // Should find at least one matching command
  assertEquals(results.length >= 1, true);

  // Verify structure
  const cmd = results[0];
  assertEquals(cmd.c1, c1);
  assertEquals(cmd.c2, c2);
  assertEquals(cmd.c3, c3);
  assertExists(cmd.description);

  logger.debug("describeCommand result", {
    command: `${cmd.c1} ${cmd.c2} ${cmd.c3}`,
    description: cmd.description,
    options: cmd.options ?? null,
  });
});

Deno.test("describe: returns empty array for non-existent command", () => {
  const c1 = "nonexistent";
  const c2 = "fake";
  const c3 = "command";

  const results = describeCommand(commands, c1, c2, c3);

  assertEquals(results.length, 0);
  logger.debug("describeCommand non-existent result", {
    resultCount: results.length,
  });
});

Deno.test("describe: returns all variants when multiple options exist", () => {
  // Find a command that appears multiple times (if any)
  const commandCounts = new Map<string, number>();
  for (const cmd of commands) {
    const key = `${cmd.c1}:${cmd.c2}:${cmd.c3}`;
    commandCounts.set(key, (commandCounts.get(key) || 0) + 1);
  }

  const duplicateKey = Array.from(commandCounts.entries()).find(
    ([_, count]) => count > 1,
  );

  if (duplicateKey) {
    const [key, count] = duplicateKey;
    const [c1, c2, c3] = key.split(":");

    const results = describeCommand(commands, c1, c2, c3);

    assertEquals(results.length, count);
    logger.debug("describeCommand variants result", {
      command: `${c1} ${c2} ${c3}`,
      variantCount: count,
    });
  } else {
    logger.debug("describeCommand variants result", {
      duplicatesFound: false,
    });
  }
});

/**
 * Integration Test: Realistic Use Cases
 */
Deno.test("use case: user searches then describes a command", () => {
  // Step 1: User searches for a command
  const query = "run tests for my code";
  const searchResults = searchCommands(commands, query, 3);

  assertEquals(searchResults.length, 3);
  logger.debug("searchCommands workflow input", { query });
  logger.debug("searchCommands workflow results", {
    topResult: searchResults[0],
  });

  // Step 2: User describes the top result
  const top = searchResults[0];
  const describeResults = describeCommand(commands, top.c1, top.c2, top.c3);

  assertEquals(describeResults.length >= 1, true);
  logger.debug("describeCommand workflow result", {
    described: describeResults[0],
  });
  logger.debug("workflow complete", { steps: ["search", "describe"] });
});
