/**
 * @fileoverview Unit tests for similarity module functions
 * @module tests/similarity_test
 *
 * Tests for the cosineSimilarity, searchCommands, and describeCommand functions
 * from the src/mcp/similarity.ts module.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cosineSimilarity,
  describeCommand,
  searchCommands,
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
// cosineSimilarity() Tests
// ============================================================================

Deno.test("cosineSimilarity: identical strings return approximately 1.0", () => {
  const score = cosineSimilarity("hello world", "hello world");
  // Due to floating point precision, we use assertAlmostEquals
  assertAlmostEquals(score, 1.0, 1e-10);
});

Deno.test("cosineSimilarity: identical single word returns 1.0", () => {
  const score = cosineSimilarity("commit", "commit");
  assertEquals(score, 1.0);
});

Deno.test("cosineSimilarity: completely different strings return 0.0", () => {
  const score = cosineSimilarity("abc xyz", "def ghij");
  assertEquals(score, 0.0);
});

Deno.test("cosineSimilarity: empty strings behavior", () => {
  // With enhanced tokenization, empty strings result in empty token arrays
  // Empty vectors have zero magnitude, resulting in similarity of 0
  const score = cosineSimilarity("", "");
  assertEquals(score, 0);
});

Deno.test("cosineSimilarity: one empty string returns 0", () => {
  const score1 = cosineSimilarity("hello", "");
  const score2 = cosineSimilarity("", "world");
  assertEquals(score1, 0);
  assertEquals(score2, 0);
});

Deno.test("cosineSimilarity: partial match returns between 0 and 1", () => {
  const score = cosineSimilarity("commit changes", "git commit");
  assert(score > 0, "Score should be greater than 0");
  assert(score < 1, "Score should be less than 1");
});

Deno.test("cosineSimilarity: word overlap produces positive score", () => {
  const score = cosineSimilarity("create new branch", "new branch creation");
  assert(score > 0.5, "Score should be relatively high due to word overlap");
});

Deno.test("cosineSimilarity: case insensitive comparison", () => {
  const score1 = cosineSimilarity("Hello World", "hello world");
  const score2 = cosineSimilarity("COMMIT CHANGES", "commit changes");
  // Due to floating point precision, use assertAlmostEquals
  assertAlmostEquals(score1, 1.0, 1e-10);
  assertAlmostEquals(score2, 1.0, 1e-10);
});

Deno.test("cosineSimilarity: order independence", () => {
  const score1 = cosineSimilarity("git commit push", "push commit git");
  // Should be approximately 1.0 since same words in different order
  // Word order doesn't matter in bag-of-words cosine similarity
  assertAlmostEquals(score1, 1.0, 1e-10);
});

Deno.test("cosineSimilarity: repeated words affect vector magnitude", () => {
  const score1 = cosineSimilarity("commit commit", "commit");
  // In the current implementation, "commit commit" has vector [2] for "commit"
  // and "commit" has vector [1], giving dot product = 2, magnitudes sqrt(4) and sqrt(1)
  // Cosine = 2 / (2 * 1) = 1.0
  // This documents that repeated words in bag-of-words still give similarity 1.0
  // for the same unique word set
  assertAlmostEquals(score1, 1.0, 1e-10);
});

Deno.test("cosineSimilarity: symmetric property", () => {
  const score1 = cosineSimilarity("git commit", "commit changes");
  const score2 = cosineSimilarity("commit changes", "git commit");
  assertEquals(score1, score2, "Similarity should be symmetric");
});

Deno.test("cosineSimilarity: whitespace handling", () => {
  // Multiple spaces should be treated as single delimiter
  const score1 = cosineSimilarity("hello  world", "hello world");
  // The split on /\s+/ should handle this, but empty strings may appear
  assert(score1 >= 0 && score1 <= 1, "Score should be valid range");
});

Deno.test("cosineSimilarity: hyphen splitting improves matching", () => {
  // Query "commit" should match "group-commit" better with hyphen splitting
  const scoreWithHyphen = cosineSimilarity("commit", "group-commit");
  // Before: "commit" vs "group-commit" would be 0 (no word match)
  // After: "commit" matches because "group-commit" → ["group-commit", "group", "commit"]
  assert(scoreWithHyphen > 0, "Should match due to hyphen splitting");
});

Deno.test("cosineSimilarity: underscore splitting improves matching", () => {
  const score = cosineSimilarity("changes", "unstaged_changes");
  assert(score > 0, "Should match due to underscore splitting");
});

Deno.test("cosineSimilarity: camelCase splitting improves matching", () => {
  const score = cosineSimilarity("commit", "groupCommit");
  assert(score > 0, "Should match due to camelCase splitting");
});

// ============================================================================
// searchCommands() Tests
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
