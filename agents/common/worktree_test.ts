/**
 * Worktree Utility Tests
 */

import { assertEquals, assertMatch } from "@std/assert";
import { generateBranchName, worktreeExists } from "./worktree.ts";

Deno.test("generateBranchName - creates timestamped branch name", () => {
  const baseName = "feature/test";
  const result = generateBranchName(baseName);

  // Should start with the base name
  assertEquals(result.startsWith("feature/test-"), true);

  // Should match pattern: baseName-yyyymmdd-hhmmss
  assertMatch(result, /^feature\/test-\d{8}-\d{6}$/);
});

Deno.test("generateBranchName - handles simple branch names", () => {
  const baseName = "develop";
  const result = generateBranchName(baseName);

  assertEquals(result.startsWith("develop-"), true);
  assertMatch(result, /^develop-\d{8}-\d{6}$/);
});

Deno.test("worktreeExists - returns false for non-existent path", async () => {
  const result = await worktreeExists("/non/existent/path/12345");
  assertEquals(result, false);
});

Deno.test("worktreeExists - returns true for existing directory", async () => {
  // Current directory should exist
  const result = await worktreeExists(Deno.cwd());
  assertEquals(result, true);
});
