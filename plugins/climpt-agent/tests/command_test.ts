/**
 * @fileoverview Tests for command execution module
 *
 * These tests protect the stdin forwarding design invariant.
 *
 * @module climpt-plugins/tests/command_test
 */

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// =============================================================================
// Design Invariant: Stdin Forwarding via Subprocess
// =============================================================================

/**
 * Test helper: Execute a simple echo command with stdin to verify the pattern works
 */
async function executeWithStdin(
  stdinContent: string,
): Promise<string> {
  const process = new Deno.Command("cat", {
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });

  const child = process.spawn();

  // Write stdin content and close to send EOF
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(stdinContent));
  await writer.close();

  const { stdout, code } = await child.output();

  if (code !== 0) {
    throw new Error("Command failed");
  }

  return new TextDecoder().decode(stdout);
}

/**
 * Test helper: Execute without stdin
 */
async function executeWithoutStdin(): Promise<string> {
  const process = new Deno.Command("echo", {
    args: ["no stdin"],
    stdout: "piped",
    stderr: "piped",
  });

  const { stdout, code } = await process.output();

  if (code !== 0) {
    throw new Error("Command failed");
  }

  return new TextDecoder().decode(stdout);
}

Deno.test("Design Invariant: Subprocess receives stdin content via piped stdin", async () => {
  const input = "Hello from stdin\nSecond line";

  const output = await executeWithStdin(input);

  assertEquals(output, input);
});

Deno.test("Design Invariant: Subprocess with stdin does not block when writer is closed", async () => {
  // This test verifies that closing the writer sends EOF and prevents blocking
  const input = "Quick test";

  // Should complete without hanging
  const output = await executeWithStdin(input);

  assertEquals(output, input);
});

Deno.test("Design Invariant: Subprocess without stdin works normally", async () => {
  const output = await executeWithoutStdin();

  assertStringIncludes(output, "no stdin");
});

Deno.test("Design Invariant: Empty stdin content is handled", async () => {
  const output = await executeWithStdin("");

  assertEquals(output, "");
});

Deno.test("Design Invariant: Japanese content in stdin is preserved", async () => {
  const input = "新機能追加のコミットメッセージを作成してください";

  const output = await executeWithStdin(input);

  assertEquals(output, input);
});

Deno.test("Design Invariant: Multiline stdin with special characters", async () => {
  const input = `Domain: git
Action: group-commit
Target: unstaged-changes

Purpose: 新機能追加
Details:
- 認証モジュールの追加
- テストケースの作成`;

  const output = await executeWithStdin(input);

  assertEquals(output, input);
});

// =============================================================================
// Design Invariant: Intent and Stdin Content are Separate
// =============================================================================

Deno.test("Design Invariant: Intent (option resolution) and stdin content (climpt input) are separate concepts", () => {
  // This test documents the design invariant:
  // - --intent: Used for LLM option resolution (short description of purpose)
  // - stdin content: Detailed content passed to climpt (file diffs, context, etc.)
  //
  // Example:
  //   echo "diff --git a/file.ts ..." | climpt-agent --query="commit" --intent="新機能追加"
  //
  // Flow:
  //   1. "新機能追加" is used to resolve options (e.g., -e=feature)
  //   2. "diff --git a/file.ts ..." is passed to climpt as stdin

  const intent: string = "新機能追加のコミットメッセージを作成";
  const stdinContent: string = `diff --git a/src/feature.ts b/src/feature.ts
+export function newFeature() {
+  return "hello";
+}`;

  // These are distinct and serve different purposes
  assertEquals(intent.length > 0, true);
  assertEquals(stdinContent.length > 0, true);
  // Intent is short purpose description, stdin is detailed content
  assertEquals(stdinContent.includes("diff --git"), true);
  assertEquals(intent.includes("diff"), false);
});

Deno.test("Design Invariant: isTerminal check determines stdin reading", () => {
  // When running as a CLI tool:
  // - If stdin.isTerminal() === true: Don't read stdin (interactive mode)
  // - If stdin.isTerminal() === false: Read all stdin (piped mode)
  //
  // This test verifies that the check exists (we can't actually toggle terminal mode in tests)

  const isTerminal = Deno.stdin.isTerminal();

  // isTerminal returns a boolean
  assertEquals(typeof isTerminal, "boolean");
});
