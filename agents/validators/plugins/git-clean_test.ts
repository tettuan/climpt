/**
 * Tests for git-clean validator
 */

import { assertEquals, assertExists } from "@std/assert";
import { gitCleanValidator } from "./git-clean.ts";
import type { ValidatorContext } from "../types.ts";
import type { Logger } from "../../src_common/logger.ts";

// Mock logger for testing
const mockLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  setToolContext: () => {},
  clearToolContext: () => {},
  logSdkMessage: () => {},
  close: () => Promise.resolve(),
  getLogPath: () => undefined,
} as unknown as Logger;

Deno.test("gitCleanValidator", async (t) => {
  await t.step("has correct metadata", () => {
    assertEquals(gitCleanValidator.id, "git-clean");
    assertEquals(gitCleanValidator.name, "Git Clean Validator");
    assertExists(gitCleanValidator.description);
  });

  await t.step("returns valid for clean git directory", async () => {
    // Create a temp directory with a git repo
    const tempDir = await Deno.makeTempDir();

    try {
      // Initialize git repo
      const init = new Deno.Command("git", {
        args: ["init"],
        cwd: tempDir,
        stdout: "null",
        stderr: "null",
      });
      await init.output();

      // Configure git for the test
      const configName = new Deno.Command("git", {
        args: ["config", "user.name", "Test"],
        cwd: tempDir,
        stdout: "null",
        stderr: "null",
      });
      await configName.output();

      const configEmail = new Deno.Command("git", {
        args: ["config", "user.email", "test@test.com"],
        cwd: tempDir,
        stdout: "null",
        stderr: "null",
      });
      await configEmail.output();

      const ctx: ValidatorContext = {
        agentId: "test",
        workingDir: tempDir,
        logger: mockLogger,
      };

      const result = await gitCleanValidator.validate(ctx);
      assertEquals(result.valid, true);
      assertEquals(result.error, undefined);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  await t.step("returns invalid for untracked files", async () => {
    const tempDir = await Deno.makeTempDir();

    try {
      // Initialize git repo
      const init = new Deno.Command("git", {
        args: ["init"],
        cwd: tempDir,
        stdout: "null",
        stderr: "null",
      });
      await init.output();

      // Create an untracked file
      await Deno.writeTextFile(`${tempDir}/untracked.txt`, "test content");

      const ctx: ValidatorContext = {
        agentId: "test",
        workingDir: tempDir,
        logger: mockLogger,
      };

      const result = await gitCleanValidator.validate(ctx);
      assertEquals(result.valid, false);
      assertExists(result.error);
      assertEquals(result.error?.includes("Uncommitted changes"), true);
      assertExists(result.details);
      assertEquals((result.details?.length ?? 0) > 0, true);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  await t.step("returns invalid for modified files", async () => {
    const tempDir = await Deno.makeTempDir();

    try {
      // Initialize git repo
      const init = new Deno.Command("git", {
        args: ["init"],
        cwd: tempDir,
        stdout: "null",
        stderr: "null",
      });
      await init.output();

      // Configure git for the test
      const configName = new Deno.Command("git", {
        args: ["config", "user.name", "Test"],
        cwd: tempDir,
        stdout: "null",
        stderr: "null",
      });
      await configName.output();

      const configEmail = new Deno.Command("git", {
        args: ["config", "user.email", "test@test.com"],
        cwd: tempDir,
        stdout: "null",
        stderr: "null",
      });
      await configEmail.output();

      // Create and commit a file
      await Deno.writeTextFile(`${tempDir}/test.txt`, "initial content");

      const add = new Deno.Command("git", {
        args: ["add", "test.txt"],
        cwd: tempDir,
        stdout: "null",
        stderr: "null",
      });
      await add.output();

      const commit = new Deno.Command("git", {
        args: ["commit", "-m", "initial"],
        cwd: tempDir,
        stdout: "null",
        stderr: "null",
      });
      await commit.output();

      // Modify the file
      await Deno.writeTextFile(`${tempDir}/test.txt`, "modified content");

      const ctx: ValidatorContext = {
        agentId: "test",
        workingDir: tempDir,
        logger: mockLogger,
      };

      const result = await gitCleanValidator.validate(ctx);
      assertEquals(result.valid, false);
      assertExists(result.error);
      assertExists(result.details);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  await t.step("returns error for non-git directory", async () => {
    const tempDir = await Deno.makeTempDir();

    try {
      const ctx: ValidatorContext = {
        agentId: "test",
        workingDir: tempDir,
        logger: mockLogger,
      };

      const result = await gitCleanValidator.validate(ctx);
      assertEquals(result.valid, false);
      assertExists(result.error);
      // Git status fails in non-git directory
      assertEquals(
        result.error?.includes("Failed to check git status") ||
          result.error?.includes("not a git repository"),
        true,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});
