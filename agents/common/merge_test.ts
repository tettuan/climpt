/**
 * Merge Utility Tests
 *
 * Unit tests and integration tests for merge operations.
 */

import { assertEquals } from "@std/assert";
import {
  checkoutBranch,
  getCurrentBranch,
  hasUncommittedChanges,
  ITERATOR_MERGE_ORDER,
  mergeBranch,
  REVIEWER_MERGE_ORDER,
} from "./merge.ts";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Execute a git command in a directory
 */
async function runGit(args: string[], cwd: string): Promise<string> {
  const command = new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await command.output();

  if (code !== 0) {
    const errorMessage = new TextDecoder().decode(stderr);
    throw new Error(
      `Git command failed: git ${args.join(" ")}\n${errorMessage}`,
    );
  }

  return new TextDecoder().decode(stdout).trim();
}

/**
 * Create a temporary Git repository for testing
 */
async function createTempGitRepo(): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await Deno.makeTempDir({ prefix: "merge-test-" });

  await runGit(["init"], tempDir);
  await runGit(["config", "user.email", "test@example.com"], tempDir);
  await runGit(["config", "user.name", "Test User"], tempDir);

  // Create initial commit
  await Deno.writeTextFile(`${tempDir}/README.md`, "# Test Repo");
  await runGit(["add", "."], tempDir);
  await runGit(["commit", "-m", "Initial commit"], tempDir);

  return {
    path: tempDir,
    cleanup: async () => {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore errors during cleanup
      }
    },
  };
}

/**
 * Add a commit to a git repository
 */
async function addCommit(
  repoPath: string,
  fileName: string,
  content: string,
  message: string,
): Promise<void> {
  await Deno.writeTextFile(`${repoPath}/${fileName}`, content);
  await runGit(["add", fileName], repoPath);
  await runGit(["commit", "-m", message], repoPath);
}

// ============================================================================
// Unit Tests: Merge Order Constants
// ============================================================================

Deno.test("ITERATOR_MERGE_ORDER - squash is first priority", () => {
  assertEquals(ITERATOR_MERGE_ORDER[0], "squash");
  assertEquals(ITERATOR_MERGE_ORDER[1], "fast-forward");
  assertEquals(ITERATOR_MERGE_ORDER[2], "merge-commit");
});

Deno.test("REVIEWER_MERGE_ORDER - fast-forward is first priority", () => {
  assertEquals(REVIEWER_MERGE_ORDER[0], "fast-forward");
  assertEquals(REVIEWER_MERGE_ORDER[1], "squash");
  assertEquals(REVIEWER_MERGE_ORDER[2], "merge-commit");
});

Deno.test("ITERATOR_MERGE_ORDER - has 3 strategies", () => {
  assertEquals(ITERATOR_MERGE_ORDER.length, 3);
});

Deno.test("REVIEWER_MERGE_ORDER - has 3 strategies", () => {
  assertEquals(REVIEWER_MERGE_ORDER.length, 3);
});

// ============================================================================
// Integration Tests: checkoutBranch
// ============================================================================

Deno.test("checkoutBranch - successfully checks out existing branch", async () => {
  const repo = await createTempGitRepo();

  try {
    // Get initial branch name (master or main)
    const initialBranch = await getCurrentBranch(repo.path);

    // Create a branch
    await runGit(["checkout", "-b", "test-branch"], repo.path);
    await runGit(["checkout", initialBranch], repo.path);

    // Checkout using our function
    const success = await checkoutBranch("test-branch", repo.path);
    assertEquals(success, true);

    // Verify we're on the correct branch
    const currentBranch = await getCurrentBranch(repo.path);
    assertEquals(currentBranch, "test-branch");
  } finally {
    await repo.cleanup();
  }
});

Deno.test("checkoutBranch - returns false for non-existent branch", async () => {
  const repo = await createTempGitRepo();

  try {
    const success = await checkoutBranch("non-existent-branch", repo.path);
    assertEquals(success, false);
  } finally {
    await repo.cleanup();
  }
});

// ============================================================================
// Integration Tests: hasUncommittedChanges
// ============================================================================

Deno.test("hasUncommittedChanges - returns false for clean repository", async () => {
  const repo = await createTempGitRepo();

  try {
    const hasChanges = await hasUncommittedChanges(repo.path);
    assertEquals(hasChanges, false);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("hasUncommittedChanges - returns true when file modified", async () => {
  const repo = await createTempGitRepo();

  try {
    // Modify a file without committing
    await Deno.writeTextFile(`${repo.path}/README.md`, "# Modified");

    const hasChanges = await hasUncommittedChanges(repo.path);
    assertEquals(hasChanges, true);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("hasUncommittedChanges - returns true when file staged", async () => {
  const repo = await createTempGitRepo();

  try {
    // Create and stage a new file
    await Deno.writeTextFile(`${repo.path}/new-file.txt`, "content");
    await runGit(["add", "new-file.txt"], repo.path);

    const hasChanges = await hasUncommittedChanges(repo.path);
    assertEquals(hasChanges, true);
  } finally {
    await repo.cleanup();
  }
});

// ============================================================================
// Integration Tests: mergeBranch - Fast-Forward
// ============================================================================

Deno.test("mergeBranch - fast-forward succeeds when no divergence", async () => {
  const repo = await createTempGitRepo();

  try {
    // Get initial branch name (master or main)
    const initialBranch = await getCurrentBranch(repo.path);

    // Create a feature branch with new commits
    await runGit(["checkout", "-b", "feature"], repo.path);
    await addCommit(
      repo.path,
      "feature.txt",
      "feature content",
      "Feature commit",
    );

    // Go back to initial branch
    await runGit(["checkout", initialBranch], repo.path);

    // Merge feature into initial branch using fast-forward strategy
    const result = await mergeBranch(
      "feature",
      initialBranch,
      ["fast-forward"],
      repo.path,
    );

    assertEquals(result.success, true);
    assertEquals(result.strategy, "fast-forward");
  } finally {
    await repo.cleanup();
  }
});

Deno.test("mergeBranch - fast-forward fails when branches diverged", async () => {
  const repo = await createTempGitRepo();

  try {
    const initialBranch = await getCurrentBranch(repo.path);

    // Create a feature branch
    await runGit(["checkout", "-b", "feature"], repo.path);
    await addCommit(
      repo.path,
      "feature.txt",
      "feature content",
      "Feature commit",
    );

    // Go back to initial branch and add a commit there too (causes divergence)
    await runGit(["checkout", initialBranch], repo.path);
    await addCommit(repo.path, "main.txt", "main content", "Main commit");

    // Try fast-forward merge (should fail)
    const result = await mergeBranch(
      "feature",
      initialBranch,
      ["fast-forward"],
      repo.path,
    );

    assertEquals(result.success, false);
    assertEquals(result.strategy, "fast-forward");
  } finally {
    await repo.cleanup();
  }
});

// ============================================================================
// Integration Tests: mergeBranch - Squash
// ============================================================================

Deno.test("mergeBranch - squash succeeds with multiple commits", async () => {
  const repo = await createTempGitRepo();

  try {
    const initialBranch = await getCurrentBranch(repo.path);

    // Create a feature branch with multiple commits
    await runGit(["checkout", "-b", "feature"], repo.path);
    await addCommit(repo.path, "file1.txt", "content1", "Commit 1");
    await addCommit(repo.path, "file2.txt", "content2", "Commit 2");
    await addCommit(repo.path, "file3.txt", "content3", "Commit 3");

    // Go back to initial branch
    await runGit(["checkout", initialBranch], repo.path);

    // Squash merge
    const result = await mergeBranch(
      "feature",
      initialBranch,
      ["squash"],
      repo.path,
    );

    assertEquals(result.success, true);
    assertEquals(result.strategy, "squash");

    // Verify files are merged
    const file1Exists = await Deno.stat(`${repo.path}/file1.txt`).then(
      () => true,
      () => false,
    );
    assertEquals(file1Exists, true);
  } finally {
    await repo.cleanup();
  }
});

// ============================================================================
// Integration Tests: mergeBranch - Merge-Commit
// ============================================================================

Deno.test("mergeBranch - merge-commit succeeds when ff fails", async () => {
  const repo = await createTempGitRepo();

  try {
    const initialBranch = await getCurrentBranch(repo.path);

    // Create a feature branch
    await runGit(["checkout", "-b", "feature"], repo.path);
    await addCommit(
      repo.path,
      "feature.txt",
      "feature content",
      "Feature commit",
    );

    // Go back to initial branch and add a commit (causes divergence)
    await runGit(["checkout", initialBranch], repo.path);
    await addCommit(repo.path, "main.txt", "main content", "Main commit");

    // Use merge-commit strategy
    const result = await mergeBranch(
      "feature",
      initialBranch,
      ["merge-commit"],
      repo.path,
    );

    assertEquals(result.success, true);
    assertEquals(result.strategy, "merge-commit");

    // Verify both files exist after merge
    const featureFileExists = await Deno.stat(`${repo.path}/feature.txt`).then(
      () => true,
      () => false,
    );
    const mainFileExists = await Deno.stat(`${repo.path}/main.txt`).then(
      () => true,
      () => false,
    );
    assertEquals(featureFileExists, true);
    assertEquals(mainFileExists, true);
  } finally {
    await repo.cleanup();
  }
});

// ============================================================================
// Integration Tests: mergeBranch - Strategy Fallback
// ============================================================================

Deno.test("mergeBranch - falls back to merge-commit when ff fails", async () => {
  const repo = await createTempGitRepo();

  try {
    const initialBranch = await getCurrentBranch(repo.path);

    // Create a feature branch
    await runGit(["checkout", "-b", "feature"], repo.path);
    await addCommit(
      repo.path,
      "feature.txt",
      "feature content",
      "Feature commit",
    );

    // Go back to initial branch and add a commit (causes divergence, ff will fail)
    await runGit(["checkout", initialBranch], repo.path);
    await addCommit(repo.path, "main.txt", "main content", "Main commit");

    // Try ff first, then merge-commit
    const result = await mergeBranch(
      "feature",
      initialBranch,
      ["fast-forward", "merge-commit"],
      repo.path,
    );

    // Should succeed with merge-commit since ff failed
    assertEquals(result.success, true);
    assertEquals(result.strategy, "merge-commit");
  } finally {
    await repo.cleanup();
  }
});

Deno.test("mergeBranch - uses ff when available even if merge-commit listed", async () => {
  const repo = await createTempGitRepo();

  try {
    const initialBranch = await getCurrentBranch(repo.path);

    // Create a feature branch (no divergence)
    await runGit(["checkout", "-b", "feature"], repo.path);
    await addCommit(
      repo.path,
      "feature.txt",
      "feature content",
      "Feature commit",
    );

    // Go back to initial branch (no new commits = ff possible)
    await runGit(["checkout", initialBranch], repo.path);

    // Try ff first (should succeed)
    const result = await mergeBranch(
      "feature",
      initialBranch,
      ["fast-forward", "merge-commit"],
      repo.path,
    );

    assertEquals(result.success, true);
    assertEquals(result.strategy, "fast-forward");
  } finally {
    await repo.cleanup();
  }
});

// ============================================================================
// Integration Tests: mergeBranch - Conflict Handling
// ============================================================================

Deno.test("mergeBranch - returns conflict info when conflict occurs", async () => {
  const repo = await createTempGitRepo();

  try {
    const initialBranch = await getCurrentBranch(repo.path);

    // Create a feature branch and modify the same file
    await runGit(["checkout", "-b", "feature"], repo.path);
    await Deno.writeTextFile(`${repo.path}/README.md`, "# Feature version");
    await runGit(["add", "README.md"], repo.path);
    await runGit(["commit", "-m", "Feature change to README"], repo.path);

    // Go back to initial branch and modify the same file differently
    await runGit(["checkout", initialBranch], repo.path);
    await Deno.writeTextFile(`${repo.path}/README.md`, "# Main version");
    await runGit(["add", "README.md"], repo.path);
    await runGit(["commit", "-m", "Main change to README"], repo.path);

    // Try to merge (should conflict)
    const result = await mergeBranch(
      "feature",
      initialBranch,
      ["merge-commit"],
      repo.path,
    );

    assertEquals(result.success, false);
    assertEquals(result.strategy, "merge-commit");
    assertEquals(result.conflictFiles !== undefined, true);
    assertEquals(result.conflictFiles!.length > 0, true);
    assertEquals(result.conflictFiles!.includes("README.md"), true);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("mergeBranch - squash returns conflict info when conflict occurs", async () => {
  const repo = await createTempGitRepo();

  try {
    const initialBranch = await getCurrentBranch(repo.path);

    // Create a feature branch and modify the same file
    await runGit(["checkout", "-b", "feature"], repo.path);
    await Deno.writeTextFile(
      `${repo.path}/README.md`,
      "# Squash Feature version",
    );
    await runGit(["add", "README.md"], repo.path);
    await runGit(["commit", "-m", "Squash Feature change"], repo.path);

    // Go back to initial branch and modify the same file differently
    await runGit(["checkout", initialBranch], repo.path);
    await Deno.writeTextFile(`${repo.path}/README.md`, "# Squash Main version");
    await runGit(["add", "README.md"], repo.path);
    await runGit(["commit", "-m", "Squash Main change"], repo.path);

    // Try to squash merge (should conflict)
    const result = await mergeBranch(
      "feature",
      initialBranch,
      ["squash"],
      repo.path,
    );

    assertEquals(result.success, false);
    assertEquals(result.strategy, "squash");
    assertEquals(result.conflictFiles !== undefined, true);
    assertEquals(result.conflictFiles!.length > 0, true);
  } finally {
    await repo.cleanup();
  }
});

// ============================================================================
// Integration Tests: mergeBranch - Edge Cases
// ============================================================================

Deno.test("mergeBranch - fails when target branch does not exist", async () => {
  const repo = await createTempGitRepo();

  try {
    // Create a feature branch
    await runGit(["checkout", "-b", "feature"], repo.path);
    await addCommit(repo.path, "feature.txt", "content", "Feature commit");

    // Try to merge into non-existent branch
    const result = await mergeBranch(
      "feature",
      "non-existent-branch",
      ["fast-forward"],
      repo.path,
    );

    assertEquals(result.success, false);
    assertEquals(result.error !== undefined, true);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("mergeBranch - returns error when all strategies fail", async () => {
  const repo = await createTempGitRepo();

  try {
    const initialBranch = await getCurrentBranch(repo.path);

    // Create a feature branch with conflicting changes
    await runGit(["checkout", "-b", "feature"], repo.path);
    await Deno.writeTextFile(`${repo.path}/README.md`, "# Conflict Feature");
    await runGit(["add", "README.md"], repo.path);
    await runGit(["commit", "-m", "Conflict feature"], repo.path);

    // Modify same file on initial branch
    await runGit(["checkout", initialBranch], repo.path);
    await Deno.writeTextFile(`${repo.path}/README.md`, "# Conflict Main");
    await runGit(["add", "README.md"], repo.path);
    await runGit(["commit", "-m", "Conflict main"], repo.path);

    // Try only fast-forward (will fail due to divergence and conflict)
    const result = await mergeBranch(
      "feature",
      initialBranch,
      ["fast-forward"],
      repo.path,
    );

    assertEquals(result.success, false);
  } finally {
    await repo.cleanup();
  }
});

// ============================================================================
// Integration Tests: getCurrentBranch
// ============================================================================

Deno.test("getCurrentBranch - returns correct branch name", async () => {
  const repo = await createTempGitRepo();

  try {
    // Default branch (master or main)
    const defaultBranch = await getCurrentBranch(repo.path);
    assertEquals(defaultBranch === "master" || defaultBranch === "main", true);

    // Create and switch to new branch
    await runGit(["checkout", "-b", "test-branch"], repo.path);
    const newBranch = await getCurrentBranch(repo.path);
    assertEquals(newBranch, "test-branch");
  } finally {
    await repo.cleanup();
  }
});
