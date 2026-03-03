/**
 * StepValidator Tests
 */

import { assertEquals } from "@std/assert";
import type { ValidatorRegistry } from "./types.ts";
import { StepValidator } from "./validator.ts";
import { checkSuccessCondition } from "./command-runner.ts";

// Mock logger (simplified for testing)
const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as import("../../src_common/logger.ts").Logger;

// checkSuccessCondition tests
Deno.test("checkSuccessCondition - empty condition returns true when stdout is empty", () => {
  const result = checkSuccessCondition("empty", {
    success: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
  });
  assertEquals(result, true);
});

Deno.test("checkSuccessCondition - empty condition returns false when stdout has content", () => {
  const result = checkSuccessCondition("empty", {
    success: true,
    exitCode: 0,
    stdout: "M file.ts",
    stderr: "",
  });
  assertEquals(result, false);
});

Deno.test("checkSuccessCondition - exitCode:0 returns true when exit code is 0", () => {
  const result = checkSuccessCondition("exitCode:0", {
    success: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
  });
  assertEquals(result, true);
});

Deno.test("checkSuccessCondition - exitCode:0 returns false when exit code is non-zero", () => {
  const result = checkSuccessCondition("exitCode:0", {
    success: false,
    exitCode: 1,
    stdout: "",
    stderr: "error",
  });
  assertEquals(result, false);
});

Deno.test("checkSuccessCondition - contains returns true when string is found", () => {
  const result = checkSuccessCondition("contains:success", {
    success: true,
    exitCode: 0,
    stdout: "test success message",
    stderr: "",
  });
  assertEquals(result, true);
});

Deno.test("checkSuccessCondition - contains returns false when string is not found", () => {
  const result = checkSuccessCondition("contains:success", {
    success: true,
    exitCode: 0,
    stdout: "test failure message",
    stderr: "",
  });
  assertEquals(result, false);
});

// StepValidator tests
Deno.test("StepValidator - skips unknown validators", async () => {
  const registry: ValidatorRegistry = {
    validators: {},
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
  });

  const result = await validator.validate([
    { validator: "unknown-validator" },
  ]);

  assertEquals(result.valid, true);
});
