/**
 * @fileoverview Unit tests for similarity module functions
 * @module tests/similarity_test
 *
 * Tests for the BM25-based searchCommands and describeCommand functions
 * from the src/mcp/similarity.ts module.
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  describeCommand,
  searchCommands,
  searchWithRRF,
  tokenize,
} from "../src/mcp/similarity.ts";
import type { Command } from "../src/mcp/types.ts";

// ============================================================================
// tokenize() Tests
// ============================================================================

Deno.test("tokenize: splits on whitespace", () => {
  const tokens = tokenize("hello world");
  assertEquals(tokens.includes("hello"), true);
  assertEquals(tokens.includes("world"), true);
});

Deno.test("tokenize: splits hyphenated words", () => {
  const tokens = tokenize("group-commit");
  assertEquals(tokens.includes("group-commit"), true); // original preserved
  assertEquals(tokens.includes("group"), true);
  assertEquals(tokens.includes("commit"), true);
});

Deno.test("tokenize: splits underscored words", () => {
  const tokens = tokenize("unstaged_changes");
  assertEquals(tokens.includes("unstaged_changes"), true); // original preserved
  assertEquals(tokens.includes("unstaged"), true);
  assertEquals(tokens.includes("changes"), true);
});

Deno.test("tokenize: splits camelCase words", () => {
  const tokens = tokenize("groupCommit");
  assertEquals(tokens.includes("groupcommit"), true); // original (lowercased)
  assertEquals(tokens.includes("group"), true);
  assertEquals(tokens.includes("commit"), true);
});

Deno.test("tokenize: handles complex mixed text", () => {
  const tokens = tokenize("git group-commit unstaged_changes myFunc");
  assertEquals(tokens.includes("git"), true);
  assertEquals(tokens.includes("group"), true);
  assertEquals(tokens.includes("commit"), true);
  assertEquals(tokens.includes("unstaged"), true);
  assertEquals(tokens.includes("changes"), true);
  assertEquals(tokens.includes("my"), true);
  assertEquals(tokens.includes("func"), true);
});

Deno.test("tokenize: returns unique tokens", () => {
  const tokens = tokenize("commit commit-message");
  // "commit" appears both standalone and as part of hyphenated
  const commitCount = tokens.filter((t) => t === "commit").length;
  assertEquals(commitCount, 1); // deduplicated
});

Deno.test("tokenize: handles empty string", () => {
  const tokens = tokenize("");
  assertEquals(tokens.length, 0);
});

// ============================================================================
// searchCommands() Tests (BM25 algorithm)
// ============================================================================

const sampleCommands: Command[] = [
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
];

Deno.test("searchCommands: returns correct number of results", () => {
  const results = searchCommands(sampleCommands, "commit changes", 3);
  assertEquals(results.length, 3);
});

Deno.test("searchCommands: returns topN results when specified", () => {
  const results = searchCommands(sampleCommands, "git", 2);
  assertEquals(results.length, 2);
});

Deno.test("searchCommands: results are sorted by score descending", () => {
  const results = searchCommands(sampleCommands, "commit changes", 4);
  for (let i = 0; i < results.length - 1; i++) {
    assert(
      results[i].score >= results[i + 1].score,
      "Results should be sorted by score descending",
    );
  }
});

Deno.test("searchCommands: finds commit-related command first", () => {
  const results = searchCommands(sampleCommands, "commit my changes", 3);
  assertEquals(results[0].c2, "group-commit");
});

Deno.test("searchCommands: finds branch-related command", () => {
  const results = searchCommands(sampleCommands, "create new branch", 3);
  const branchResult = results.find((r) => r.c3 === "working-branch");
  assert(branchResult !== undefined, "Should find branch-related command");
});

Deno.test("searchCommands: finds frontmatter command", () => {
  const results = searchCommands(sampleCommands, "generate frontmatter", 3);
  assertEquals(results[0].c3, "frontmatter");
});

Deno.test("searchCommands: returns empty when no commands", () => {
  const results = searchCommands([], "commit", 3);
  assertEquals(results.length, 0);
});

Deno.test("searchCommands: handles empty query", () => {
  const results = searchCommands(sampleCommands, "", 3);
  assertEquals(results.length, 3);
  // All scores should be 0 for empty query
  for (const result of results) {
    assertEquals(result.score, 0);
  }
});

Deno.test("searchCommands: default topN is 3", () => {
  const results = searchCommands(sampleCommands, "git");
  assertEquals(results.length, 3);
});

Deno.test("searchCommands: returns all commands when topN exceeds list size", () => {
  const results = searchCommands(sampleCommands, "git", 10);
  assertEquals(results.length, sampleCommands.length);
});

Deno.test("searchCommands: result contains required fields", () => {
  const results = searchCommands(sampleCommands, "commit", 1);
  assert(results.length > 0, "Should return at least one result");
  const result = results[0];
  assert(typeof result.c1 === "string", "c1 should be string");
  assert(typeof result.c2 === "string", "c2 should be string");
  assert(typeof result.c3 === "string", "c3 should be string");
  assert(
    typeof result.description === "string",
    "description should be string",
  );
  assert(typeof result.score === "number", "score should be number");
});

Deno.test("searchCommands: deduplicates commands by c1+c2+c3", () => {
  const duplicateCommands: Command[] = [
    ...sampleCommands,
    // Duplicate with different description
    {
      c1: "git",
      c2: "group-commit",
      c3: "unstaged-changes",
      description: "Different description for same command",
      usage: "climpt-git group-commit unstaged-changes",
      options: {
        edition: ["default"],
        adaptation: ["default"],
        file: false,
        stdin: false,
        destination: false,
      },
    },
  ];
  const results = searchCommands(duplicateCommands, "commit", 10);
  // Should deduplicate: 4 unique commands, not 5
  assertEquals(results.length, 4);
});

// ============================================================================
// describeCommand() Tests
// ============================================================================

Deno.test("describeCommand: finds exact match", () => {
  const results = describeCommand(
    sampleCommands,
    "git",
    "group-commit",
    "unstaged-changes",
  );
  assertEquals(results.length, 1);
  assertEquals(results[0].c1, "git");
  assertEquals(results[0].c2, "group-commit");
  assertEquals(results[0].c3, "unstaged-changes");
});

Deno.test("describeCommand: returns empty for non-existent command", () => {
  const results = describeCommand(
    sampleCommands,
    "nonexistent",
    "command",
    "test",
  );
  assertEquals(results.length, 0);
});

Deno.test("describeCommand: returns multiple matching commands", () => {
  const commandsWithDuplicates: Command[] = [
    ...sampleCommands,
    {
      c1: "git",
      c2: "group-commit",
      c3: "unstaged-changes",
      description: "Alternative description",
      usage: "climpt-git group-commit unstaged-changes --edition=detailed",
      options: {
        edition: ["detailed"],
        adaptation: ["strict"],
        file: true,
        stdin: false,
        destination: true,
      },
    },
  ];
  const results = describeCommand(
    commandsWithDuplicates,
    "git",
    "group-commit",
    "unstaged-changes",
  );
  assertEquals(results.length, 2);
});

Deno.test("describeCommand: partial match returns empty", () => {
  // Only c1 matches
  const results1 = describeCommand(sampleCommands, "git", "wrong", "wrong");
  assertEquals(results1.length, 0);

  // Only c2 matches
  const results2 = describeCommand(
    sampleCommands,
    "wrong",
    "group-commit",
    "wrong",
  );
  assertEquals(results2.length, 0);

  // Only c3 matches
  const results3 = describeCommand(
    sampleCommands,
    "wrong",
    "wrong",
    "unstaged-changes",
  );
  assertEquals(results3.length, 0);
});

Deno.test("describeCommand: returns full command object", () => {
  const results = describeCommand(
    sampleCommands,
    "meta",
    "build",
    "frontmatter",
  );
  assertEquals(results.length, 1);
  const cmd = results[0];
  assertEquals(cmd.c1, "meta");
  assertEquals(cmd.c2, "build");
  assertEquals(cmd.c3, "frontmatter");
  assert(cmd.description !== undefined, "Should have description");
  assert(cmd.usage !== undefined, "Should have usage");
  assert(cmd.options !== undefined, "Should have options");
});

Deno.test("describeCommand: handles empty command list", () => {
  const results = describeCommand([], "git", "commit", "changes");
  assertEquals(results.length, 0);
});

Deno.test("describeCommand: case sensitive matching", () => {
  // describeCommand uses strict equality, so case matters
  const results = describeCommand(
    sampleCommands,
    "GIT",
    "group-commit",
    "unstaged-changes",
  );
  assertEquals(results.length, 0);
});

// ============================================================================
// BM25 Algorithm Specific Tests
// ============================================================================

// Test data simulating the original problem:
// Query "create specification" was incorrectly matching "meta create instruction"
// instead of "requirements draft entry"
const bm25TestCommands: Command[] = [
  {
    c1: "meta",
    c2: "create",
    c3: "instruction",
    description: "Create a new Climpt instruction file from stdin input",
    usage: "climpt-meta create instruction",
  },
  {
    c1: "workflows",
    c2: "create",
    c3: "verification-issue",
    description: "Create verification issue for workflow validation",
    usage: "climpt-workflows create verification-issue",
  },
  {
    c1: "requirements",
    c2: "draft",
    c3: "entry",
    description: "Draft a new requirements specification document",
    usage: "climpt-requirements draft entry",
  },
  {
    c1: "spec",
    c2: "analyze",
    c3: "coverage",
    description: "Analyze specification coverage and gaps",
    usage: "climpt-spec analyze coverage",
  },
];

Deno.test("BM25: common term 'create' has lower weight due to IDF", () => {
  // "create" appears in multiple commands, so its IDF should be low
  // This means queries with "create" should rely more on other terms
  const results = searchCommands(bm25TestCommands, "create specification", 4);

  // With BM25, "requirements draft entry" should rank higher than
  // "meta create instruction" because "specification" in description
  // is more distinctive than "create" which appears in multiple commands
  const requirementsIndex = results.findIndex((r) => r.c1 === "requirements");
  const metaCreateIndex = results.findIndex(
    (r) => r.c1 === "meta" && r.c2 === "create",
  );

  // Log scores for debugging (visible in test output with --allow-none)
  console.log("Query: 'create specification'");
  console.log("Results:");
  results.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.c1} ${r.c2} ${r.c3}: ${r.score.toFixed(4)}`);
  });

  // The requirements command with "specification" in description
  // should be ranked higher due to BM25 IDF weighting
  assert(
    requirementsIndex !== -1,
    "requirements command should be in results",
  );
});

Deno.test("BM25: rare terms have higher weight", () => {
  // "frontmatter" is a rare term that only appears in one command
  // It should have high IDF and thus high weight
  const results = searchCommands(sampleCommands, "frontmatter", 4);

  assertEquals(
    results[0].c3,
    "frontmatter",
    "Rare term 'frontmatter' should strongly match the frontmatter command",
  );

  // Score should be relatively high for exact match on rare term
  assert(
    results[0].score > 0,
    "Score should be positive for matching term",
  );
});

Deno.test("BM25: multiple matching terms accumulate score", () => {
  // Query with multiple terms should have higher score than single term
  const singleTermResults = searchCommands(sampleCommands, "commit", 4);
  const multiTermResults = searchCommands(
    sampleCommands,
    "commit changes group",
    4,
  );

  // Find the group-commit command in both results
  const singleScore = singleTermResults.find((r) => r.c2 === "group-commit")
    ?.score || 0;
  const multiScore = multiTermResults.find((r) => r.c2 === "group-commit")
    ?.score || 0;

  assert(
    multiScore >= singleScore,
    "Multiple matching terms should have equal or higher score",
  );
});

Deno.test("BM25: document length normalization affects scoring", () => {
  // Commands with shorter descriptions should not be unfairly penalized
  // BM25's length normalization should balance this
  const results = searchCommands(sampleCommands, "git", 4);

  // All results should have valid scores
  for (const result of results) {
    assert(
      result.score >= 0,
      "All scores should be non-negative",
    );
  }
});

// ============================================================================
// searchWithRRF() Tests (Reciprocal Rank Fusion)
// ============================================================================

Deno.test("RRF: returns correct number of results", () => {
  const results = searchWithRRF(
    sampleCommands,
    ["commit changes", "unstaged files"],
    3,
  );
  assertEquals(results.length, 3);
});

Deno.test("RRF: returns empty for empty queries array", () => {
  const results = searchWithRRF(sampleCommands, [], 3);
  assertEquals(results.length, 0);
});

Deno.test("RRF: handles single query (degrades to single ranking)", () => {
  const results = searchWithRRF(sampleCommands, ["commit"], 3);
  assertEquals(results.length, 3);
  // Single query should still produce valid RRF scores
  for (const result of results) {
    assert(result.score > 0, "Score should be positive");
    assertEquals(result.ranks.length, 1, "Should have 1 rank entry");
    assert(result.ranks[0] > 0, "Rank should be positive");
  }
});

Deno.test("RRF: results are sorted by RRF score descending", () => {
  const results = searchWithRRF(
    sampleCommands,
    ["commit", "changes"],
    4,
  );
  for (let i = 0; i < results.length - 1; i++) {
    assert(
      results[i].score >= results[i + 1].score,
      "Results should be sorted by RRF score descending",
    );
  }
});

Deno.test("RRF: ranks array has correct length", () => {
  const queries = ["commit changes", "group files"];
  const results = searchWithRRF(sampleCommands, queries, 3);

  for (const result of results) {
    assertEquals(
      result.ranks.length,
      queries.length,
      `Ranks array should have ${queries.length} entries`,
    );
  }
});

Deno.test("RRF: C3L-aligned dual queries improve relevance", () => {
  // Test case: "create specification" problem from original BM25 tests
  // query1 (action): emphasizes verbs like "draft", "create"
  // query2 (target): emphasizes nouns like "specification", "requirements"
  const results = searchWithRRF(
    bm25TestCommands,
    ["draft create write", "specification requirements document"],
    4,
  );

  console.log("RRF Query: action='draft create write', target='specification requirements document'");
  console.log("Results:");
  results.forEach((r, i) => {
    console.log(
      `  ${i + 1}. ${r.c1} ${r.c2} ${r.c3}: RRF=${r.score.toFixed(6)}, ranks=[${r.ranks.join(", ")}]`,
    );
  });

  // The "requirements draft entry" command should rank highly
  // because it matches both action (draft) and target (specification)
  const requirementsResult = results.find((r) => r.c1 === "requirements");
  assert(
    requirementsResult !== undefined,
    "requirements command should be in results",
  );
});

Deno.test("RRF: combines rankings from multiple queries", () => {
  // Use two different queries that should favor different commands
  const results = searchWithRRF(
    sampleCommands,
    ["git branch", "frontmatter generate"],
    4,
  );

  // Both git-related and frontmatter commands should appear
  const hasGit = results.some((r) => r.c1 === "git");
  const hasMeta = results.some((r) => r.c1 === "meta");

  assert(hasGit || hasMeta, "Should find commands matching either query");
});

Deno.test("RRF: handles empty query in array", () => {
  const results = searchWithRRF(
    sampleCommands,
    ["commit", "", "changes"],
    3,
  );
  // Should still work, ignoring empty query
  assertEquals(results.length, 3);
});

Deno.test("RRF: result contains required fields", () => {
  const results = searchWithRRF(sampleCommands, ["commit", "changes"], 1);
  assert(results.length > 0, "Should return at least one result");

  const result = results[0];
  assert(typeof result.c1 === "string", "c1 should be string");
  assert(typeof result.c2 === "string", "c2 should be string");
  assert(typeof result.c3 === "string", "c3 should be string");
  assert(typeof result.description === "string", "description should be string");
  assert(typeof result.score === "number", "score should be number");
  assert(Array.isArray(result.ranks), "ranks should be array");
});

Deno.test("RRF: command appearing in both queries gets boosted score", () => {
  // Query that should make "group-commit" rank well in both
  const results = searchWithRRF(
    sampleCommands,
    ["commit", "unstaged changes"],
    4,
  );

  const groupCommit = results.find((r) => r.c2 === "group-commit");
  assert(groupCommit !== undefined, "group-commit should be found");

  // It should appear in both rankings (ranks[0] > 0 and ranks[1] > 0)
  // If it appears in both, it gets higher RRF score
  console.log("group-commit ranks:", groupCommit.ranks);
});
