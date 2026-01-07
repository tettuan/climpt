/**
 * Worktree Utility Tests
 *
 * Unit tests and integration tests for worktree operations.
 */

import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import {
  cleanupWorktree,
  generateBranchName,
  getCurrentBranch,
  getRepoRoot,
  listWorktrees,
  setupWorktree,
  worktreeExists,
} from "./worktree.ts";
import type { WorktreeCLIOptions, WorktreeConfig } from "./types.ts";

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
  const tempDir = await Deno.makeTempDir({ prefix: "worktree-test-" });

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
// Unit Tests: generateBranchName
// ============================================================================

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

Deno.test("generateBranchName - generates unique names on consecutive calls", async () => {
  const baseName = "feature";
  const result1 = generateBranchName(baseName);

  // Wait a bit to ensure different timestamp
  await new Promise((resolve) => setTimeout(resolve, 1100));

  const result2 = generateBranchName(baseName);

  // Names should be different (different timestamps)
  // Note: This could theoretically fail if both run in same second
  assertEquals(result1 !== result2, true);
});

// ============================================================================
// Unit Tests: worktreeExists
// ============================================================================

Deno.test("worktreeExists - returns false for non-existent path", async () => {
  const result = await worktreeExists("/non/existent/path/12345");
  assertEquals(result, false);
});

Deno.test("worktreeExists - returns true for existing directory", async () => {
  // Current directory should exist
  const result = await worktreeExists(Deno.cwd());
  assertEquals(result, true);
});

Deno.test("worktreeExists - returns false for file (not directory)", async () => {
  const tempFile = await Deno.makeTempFile({ prefix: "worktree-test-" });
  try {
    const result = await worktreeExists(tempFile);
    assertEquals(result, false);
  } finally {
    await Deno.remove(tempFile);
  }
});

// ============================================================================
// Integration Tests: setupWorktree with --branch option
// ============================================================================

Deno.test("setupWorktree - uses exact branch name when --branch specified", async () => {
  const repo = await createTempGitRepo();

  try {
    const config: WorktreeConfig = {
      forceWorktree: true,
      worktreeRoot: "../worktree",
    };

    const options: WorktreeCLIOptions = {
      branch: "my-feature-branch",
    };

    const result = await setupWorktree(config, options, repo.path);

    // Branch name should be exactly what was specified
    assertEquals(result.branchName, "my-feature-branch");
    assertEquals(result.created, true);

    // Verify worktree was created
    const exists = await worktreeExists(result.worktreePath);
    assertEquals(exists, true);

    // Cleanup
    await cleanupWorktree(result.worktreePath, repo.path);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("setupWorktree - generates timestamped name when --branch not specified", async () => {
  const repo = await createTempGitRepo();

  try {
    const config: WorktreeConfig = {
      forceWorktree: true,
      worktreeRoot: "../worktree",
    };

    const options: WorktreeCLIOptions = {
      // branch not specified
    };

    const result = await setupWorktree(config, options, repo.path);

    // Branch name should be timestamped (baseBranch-yyyymmdd-hhmmss)
    assertMatch(result.branchName, /^master-\d{8}-\d{6}$|^main-\d{8}-\d{6}$/);
    assertEquals(result.created, true);

    // Cleanup
    await cleanupWorktree(result.worktreePath, repo.path);
  } finally {
    await repo.cleanup();
  }
});

// ============================================================================
// Integration Tests: setupWorktree with --base-branch option
// ============================================================================

Deno.test("setupWorktree - uses specified base branch when --base-branch specified", async () => {
  const repo = await createTempGitRepo();

  try {
    // Create a develop branch
    await runGit(["checkout", "-b", "develop"], repo.path);
    await addCommit(
      repo.path,
      "develop.txt",
      "develop content",
      "Develop commit",
    );

    const config: WorktreeConfig = {
      forceWorktree: true,
      worktreeRoot: "../worktree",
    };

    const options: WorktreeCLIOptions = {
      branch: "feature-from-develop",
      baseBranch: "develop",
    };

    const result = await setupWorktree(config, options, repo.path);

    assertEquals(result.baseBranch, "develop");
    assertEquals(result.branchName, "feature-from-develop");
    assertEquals(result.created, true);

    // Cleanup
    await cleanupWorktree(result.worktreePath, repo.path);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("setupWorktree - uses current branch as base when --base-branch not specified", async () => {
  const repo = await createTempGitRepo();

  try {
    // Get current branch (should be master or main)
    const currentBranch = await getCurrentBranch(repo.path);

    const config: WorktreeConfig = {
      forceWorktree: true,
      worktreeRoot: "../worktree",
    };

    const options: WorktreeCLIOptions = {
      branch: "feature-from-current",
      // baseBranch not specified
    };

    const result = await setupWorktree(config, options, repo.path);

    // Base branch should be current branch
    assertEquals(result.baseBranch, currentBranch);

    // Cleanup
    await cleanupWorktree(result.worktreePath, repo.path);
  } finally {
    await repo.cleanup();
  }
});

// ============================================================================
// Integration Tests: Branch name sanitization
// ============================================================================

Deno.test("setupWorktree - sanitizes branch name for filesystem (/ to -)", async () => {
  const repo = await createTempGitRepo();

  try {
    const config: WorktreeConfig = {
      forceWorktree: true,
      worktreeRoot: "../worktree",
    };

    const options: WorktreeCLIOptions = {
      branch: "feature/test-branch",
    };

    const result = await setupWorktree(config, options, repo.path);

    // Branch name should still have /
    assertEquals(result.branchName, "feature/test-branch");

    // But worktree path should have sanitized name (/ replaced with -)
    assertStringIncludes(result.worktreePath, "feature-test-branch");
    assertEquals(result.worktreePath.includes("feature/test-branch"), false);

    // Cleanup
    await cleanupWorktree(result.worktreePath, repo.path);
  } finally {
    await repo.cleanup();
  }
});

// ============================================================================
// Integration Tests: Worktree lifecycle
// ============================================================================

Deno.test("worktree lifecycle - create, verify, list, cleanup", async () => {
  const repo = await createTempGitRepo();

  try {
    const config: WorktreeConfig = {
      forceWorktree: true,
      worktreeRoot: "../worktree",
    };

    const options: WorktreeCLIOptions = {
      branch: "lifecycle-test-branch",
    };

    // 1. Create worktree
    const result = await setupWorktree(config, options, repo.path);
    assertEquals(result.created, true);

    // 2. Verify it exists
    const existsAfterCreate = await worktreeExists(result.worktreePath);
    assertEquals(existsAfterCreate, true);

    // 3. List worktrees should include the new one
    const worktrees = await listWorktrees(repo.path);
    assertEquals(worktrees.length >= 2, true); // main + new worktree

    // 4. Cleanup
    await cleanupWorktree(result.worktreePath, repo.path);

    // 5. Verify it no longer exists
    const existsAfterCleanup = await worktreeExists(result.worktreePath);
    assertEquals(existsAfterCleanup, false);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("setupWorktree - reuses existing worktree if already exists", async () => {
  const repo = await createTempGitRepo();

  try {
    const config: WorktreeConfig = {
      forceWorktree: true,
      worktreeRoot: "../worktree",
    };

    const options: WorktreeCLIOptions = {
      branch: "reuse-test-branch",
    };

    // First setup creates the worktree
    const result1 = await setupWorktree(config, options, repo.path);
    assertEquals(result1.created, true);

    // Second setup should reuse existing
    const result2 = await setupWorktree(config, options, repo.path);
    assertEquals(result2.created, false);
    assertEquals(result2.worktreePath, result1.worktreePath);

    // Cleanup
    await cleanupWorktree(result1.worktreePath, repo.path);
  } finally {
    await repo.cleanup();
  }
});

// ============================================================================
// Integration Tests: Git operations
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

Deno.test("getRepoRoot - returns repository root directory", async () => {
  const repo = await createTempGitRepo();

  try {
    const repoRoot = await getRepoRoot(repo.path);

    // The repo root should be the temp directory we created
    // Note: On macOS, temp directories might have symlinks resolved
    // So we just check that it ends with the expected directory name
    const tempDirName = repo.path.split("/").pop();
    const repoRootName = repoRoot.split("/").pop();
    assertEquals(tempDirName, repoRootName);
  } finally {
    await repo.cleanup();
  }
});

Deno.test("listWorktrees - returns at least main worktree", async () => {
  const repo = await createTempGitRepo();

  try {
    const worktrees = await listWorktrees(repo.path);

    // Should have at least the main worktree
    assertEquals(worktrees.length >= 1, true);
  } finally {
    await repo.cleanup();
  }
});

// ============================================================================
// Integration Tests: cleanupWorktree edge cases
// ============================================================================

Deno.test("cleanupWorktree - handles non-existent worktree gracefully", async () => {
  const repo = await createTempGitRepo();

  try {
    // This should not throw
    await cleanupWorktree("/non/existent/worktree/path", repo.path);
  } finally {
    await repo.cleanup();
  }
});
