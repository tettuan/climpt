/**
 * @fileoverview Plugin sync tests for BM25 similarity module
 * @module tests/plugin-sync/similarity-sync_test
 *
 * Verifies that MCP and Plugin versions of BM25 similarity functions
 * produce identical outputs for identical inputs.
 */

import { assertEquals } from "@std/assert";

import {
  describeCommand as mcpDescribeCommand,
  searchCommands as mcpSearchCommands,
  searchWithRRF as mcpSearchWithRRF,
  tokenize as mcpTokenize,
} from "../../src/mcp/similarity.ts";

import {
  describeCommand as pluginDescribeCommand,
  searchCommands as pluginSearchCommands,
  searchWithRRF as pluginSearchWithRRF,
  tokenize as pluginTokenize,
} from "../../plugins/climpt-agent/lib/similarity.ts";

import type { Command as MCPCommand } from "../../src/mcp/types.ts";
import type { Command as PluginCommand } from "../../plugins/climpt-agent/lib/types.ts";

// Shared test data (satisfies both Command types)
const testCommands: MCPCommand[] & PluginCommand[] = [
  {
    c1: "git",
    c2: "group-commit",
    c3: "unstaged-changes",
    description:
      "Group file changes by semantic proximity and execute multiple commits sequentially",
    usage: "climpt-git group-commit unstaged-changes",
    options: {
      edition: ["default"],
      adaptation: ["default", "detailed"],
      file: true,
      stdin: false,
      destination: true,
    },
  },
  {
    c1: "git",
    c2: "decide-branch",
    c3: "working-branch",
    description:
      "Decide whether to create a new branch or continue on the current branch",
    usage: "climpt-git decide-branch working-branch",
    options: {
      edition: ["default"],
      adaptation: ["default"],
      file: false,
      stdin: true,
      destination: false,
    },
  },
  {
    c1: "meta",
    c2: "build",
    c3: "frontmatter",
    description:
      "Generate C3L v0.5 compliant frontmatter for instruction files",
    usage: "climpt-meta build frontmatter",
    options: {
      edition: ["default"],
      adaptation: ["default", "detailed"],
      file: false,
      stdin: true,
      destination: true,
    },
  },
  {
    c1: "meta",
    c2: "create",
    c3: "instruction",
    description: "Create a new Climpt instruction file from stdin input",
    usage: "climpt-meta create instruction",
    options: {
      edition: ["default"],
      adaptation: ["default", "detailed"],
      file: false,
      stdin: true,
      destination: true,
    },
  },
  {
    c1: "requirements",
    c2: "draft",
    c3: "entry",
    description: "Draft a new requirements specification document",
    usage: "climpt-requirements draft entry",
  },
];

// ============================================================================
// tokenize() Sync Tests
// ============================================================================

Deno.test("plugin-sync/similarity: tokenize produces identical output for simple text", () => {
  const input = "hello world";
  assertEquals(mcpTokenize(input), pluginTokenize(input));
});

Deno.test("plugin-sync/similarity: tokenize produces identical output for hyphenated words", () => {
  const input = "group-commit unstaged-changes";
  assertEquals(mcpTokenize(input), pluginTokenize(input));
});

Deno.test("plugin-sync/similarity: tokenize produces identical output for underscored words", () => {
  const input = "unstaged_changes my_variable";
  assertEquals(mcpTokenize(input), pluginTokenize(input));
});

Deno.test("plugin-sync/similarity: tokenize produces identical output for camelCase", () => {
  const input = "groupCommit decideBranch";
  assertEquals(mcpTokenize(input), pluginTokenize(input));
});

Deno.test("plugin-sync/similarity: tokenize produces identical output for mixed text", () => {
  const input = "git group-commit unstaged_changes myFunc CamelCase";
  assertEquals(mcpTokenize(input), pluginTokenize(input));
});

Deno.test("plugin-sync/similarity: tokenize produces identical output for empty string", () => {
  assertEquals(mcpTokenize(""), pluginTokenize(""));
});

// ============================================================================
// searchCommands() Sync Tests
// ============================================================================

Deno.test("plugin-sync/similarity: searchCommands returns identical results for exact match query", () => {
  const query = "group-commit unstaged-changes";
  const mcpResults = mcpSearchCommands(testCommands, query, 3);
  const pluginResults = pluginSearchCommands(testCommands, query, 3);
  assertEquals(mcpResults, pluginResults);
});

Deno.test("plugin-sync/similarity: searchCommands returns identical results for fuzzy query", () => {
  const query = "create specification";
  const mcpResults = mcpSearchCommands(testCommands, query, 3);
  const pluginResults = pluginSearchCommands(testCommands, query, 3);
  assertEquals(mcpResults, pluginResults);
});

Deno.test("plugin-sync/similarity: searchCommands returns identical results for single-term query", () => {
  const query = "git";
  const mcpResults = mcpSearchCommands(testCommands, query, 5);
  const pluginResults = pluginSearchCommands(testCommands, query, 5);
  assertEquals(mcpResults, pluginResults);
});

Deno.test("plugin-sync/similarity: searchCommands returns identical results for empty query", () => {
  const query = "";
  const mcpResults = mcpSearchCommands(testCommands, query, 3);
  const pluginResults = pluginSearchCommands(testCommands, query, 3);
  assertEquals(mcpResults, pluginResults);
});

Deno.test("plugin-sync/similarity: searchCommands returns identical results for empty command list", () => {
  const mcpResults = mcpSearchCommands([], "commit", 3);
  const pluginResults = pluginSearchCommands([], "commit", 3);
  assertEquals(mcpResults, pluginResults);
});

Deno.test("plugin-sync/similarity: searchCommands returns identical results with default topN", () => {
  const query = "commit changes";
  const mcpResults = mcpSearchCommands(testCommands, query);
  const pluginResults = pluginSearchCommands(testCommands, query);
  assertEquals(mcpResults, pluginResults);
});

Deno.test("plugin-sync/similarity: searchCommands returns identical results for multi-word query", () => {
  const query = "draft requirements specification document";
  const mcpResults = mcpSearchCommands(testCommands, query, 5);
  const pluginResults = pluginSearchCommands(testCommands, query, 5);
  assertEquals(mcpResults, pluginResults);
});

// ============================================================================
// searchWithRRF() Sync Tests
// ============================================================================

Deno.test("plugin-sync/similarity: searchWithRRF returns identical results for dual queries", () => {
  const queries = ["commit changes", "unstaged files"];
  const mcpResults = mcpSearchWithRRF(testCommands, queries, 3);
  const pluginResults = pluginSearchWithRRF(testCommands, queries, 3);
  assertEquals(mcpResults, pluginResults);
});

Deno.test("plugin-sync/similarity: searchWithRRF returns identical results for empty queries", () => {
  const mcpResults = mcpSearchWithRRF(testCommands, [], 3);
  const pluginResults = pluginSearchWithRRF(testCommands, [], 3);
  assertEquals(mcpResults, pluginResults);
});

Deno.test("plugin-sync/similarity: searchWithRRF returns identical results for single query", () => {
  const queries = ["frontmatter"];
  const mcpResults = mcpSearchWithRRF(testCommands, queries, 3);
  const pluginResults = pluginSearchWithRRF(testCommands, queries, 3);
  assertEquals(mcpResults, pluginResults);
});

Deno.test("plugin-sync/similarity: searchWithRRF returns identical results for C3L-aligned queries", () => {
  const queries = ["draft create write", "specification requirements document"];
  const mcpResults = mcpSearchWithRRF(testCommands, queries, 5);
  const pluginResults = pluginSearchWithRRF(testCommands, queries, 5);
  assertEquals(mcpResults, pluginResults);
});

Deno.test("plugin-sync/similarity: searchWithRRF handles empty query in array identically", () => {
  const queries = ["commit", "", "changes"];
  const mcpResults = mcpSearchWithRRF(testCommands, queries, 3);
  const pluginResults = pluginSearchWithRRF(testCommands, queries, 3);
  assertEquals(mcpResults, pluginResults);
});

// ============================================================================
// describeCommand() Sync Tests
// ============================================================================

Deno.test("plugin-sync/similarity: describeCommand returns identical results for exact match", () => {
  const mcpResults = mcpDescribeCommand(
    testCommands,
    "git",
    "group-commit",
    "unstaged-changes",
  );
  const pluginResults = pluginDescribeCommand(
    testCommands,
    "git",
    "group-commit",
    "unstaged-changes",
  );
  assertEquals(mcpResults, pluginResults);
});

Deno.test("plugin-sync/similarity: describeCommand returns identical results for no match", () => {
  const mcpResults = mcpDescribeCommand(
    testCommands,
    "nonexistent",
    "command",
    "test",
  );
  const pluginResults = pluginDescribeCommand(
    testCommands,
    "nonexistent",
    "command",
    "test",
  );
  assertEquals(mcpResults, pluginResults);
});

Deno.test("plugin-sync/similarity: describeCommand returns identical results for empty list", () => {
  const mcpResults = mcpDescribeCommand([], "git", "commit", "changes");
  const pluginResults = pluginDescribeCommand([], "git", "commit", "changes");
  assertEquals(mcpResults, pluginResults);
});

Deno.test("plugin-sync/similarity: describeCommand case sensitivity is identical", () => {
  const mcpResults = mcpDescribeCommand(
    testCommands,
    "GIT",
    "group-commit",
    "unstaged-changes",
  );
  const pluginResults = pluginDescribeCommand(
    testCommands,
    "GIT",
    "group-commit",
    "unstaged-changes",
  );
  assertEquals(mcpResults, pluginResults);
});
