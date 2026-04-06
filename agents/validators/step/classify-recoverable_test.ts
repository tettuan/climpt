/**
 * Tests for classifyRecoverable
 *
 * Validates the recoverability classification logic for command validator failures.
 * Covers exit codes, stderr patterns, and the recoverableByDefault fallback.
 */

import { assertEquals } from "@std/assert";
import { classifyRecoverable } from "./validator.ts";

// =============================================================================
// Unrecoverable: exit code classification
// =============================================================================

Deno.test("classifyRecoverable - exit code 126 (permission denied) is unrecoverable", () => {
  const result = classifyRecoverable(126, "", undefined);
  assertEquals(result, false, "exit code 126 should be unrecoverable");
});

Deno.test("classifyRecoverable - exit code 127 (command not found) is unrecoverable", () => {
  const result = classifyRecoverable(
    127,
    "sh: unknown-cmd: not found",
    undefined,
  );
  assertEquals(result, false, "exit code 127 should be unrecoverable");
});

// =============================================================================
// Unrecoverable: stderr pattern classification
// =============================================================================

Deno.test("classifyRecoverable - stderr with EACCES is unrecoverable", () => {
  const result = classifyRecoverable(
    1,
    "Error: EACCES: permission denied, open '/etc/config'",
    undefined,
  );
  assertEquals(result, false, "EACCES in stderr should be unrecoverable");
});

Deno.test("classifyRecoverable - stderr with Permission denied is unrecoverable", () => {
  const result = classifyRecoverable(
    1,
    "bash: ./script.sh: Permission denied",
    undefined,
  );
  assertEquals(
    result,
    false,
    "Permission denied in stderr should be unrecoverable",
  );
});

// =============================================================================
// Recoverable: normal failures
// =============================================================================

Deno.test("classifyRecoverable - exit code 1 with test failure is recoverable", () => {
  const result = classifyRecoverable(
    1,
    "FAILED: 3 tests failed",
    undefined,
  );
  assertEquals(result, true, "test failures should be recoverable");
});

Deno.test("classifyRecoverable - exit code 1 with lint errors is recoverable", () => {
  const result = classifyRecoverable(
    1,
    "error: Found 5 lint violations",
    undefined,
  );
  assertEquals(result, true, "lint errors should be recoverable");
});

Deno.test("classifyRecoverable - exit code 0 with empty stderr is recoverable", () => {
  const result = classifyRecoverable(0, "", undefined);
  assertEquals(
    result,
    true,
    "successful exit with empty stderr should be recoverable",
  );
});

// =============================================================================
// recoverableByDefault fallback
// =============================================================================

Deno.test("classifyRecoverable - recoverableByDefault false overrides default", () => {
  // Exit code 1, no special stderr, but validator says unrecoverable by default
  const result = classifyRecoverable(1, "some error", false);
  assertEquals(
    result,
    false,
    "recoverableByDefault=false should make it unrecoverable",
  );
});

Deno.test("classifyRecoverable - recoverableByDefault true preserves recoverable", () => {
  const result = classifyRecoverable(1, "some error", true);
  assertEquals(
    result,
    true,
    "recoverableByDefault=true should keep it recoverable",
  );
});

Deno.test("classifyRecoverable - unrecoverable exit code overrides recoverableByDefault true", () => {
  // Exit code 127 is always unrecoverable, regardless of recoverableByDefault
  const result = classifyRecoverable(127, "", true);
  assertEquals(
    result,
    false,
    "exit code 127 should be unrecoverable even with recoverableByDefault=true",
  );
});

Deno.test("classifyRecoverable - EACCES overrides recoverableByDefault true", () => {
  const result = classifyRecoverable(
    1,
    "Error: EACCES: no write access",
    true,
  );
  assertEquals(
    result,
    false,
    "EACCES should be unrecoverable even with recoverableByDefault=true",
  );
});
