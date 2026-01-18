/**
 * Tests for validator registry
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import {
  clearValidators,
  getValidator,
  hasValidator,
  listValidators,
  registerValidator,
  resetValidators,
  runValidators,
} from "./registry.ts";
import type { Validator, ValidatorContext, ValidatorResult } from "./types.ts";
import type { Logger } from "../src_common/logger.ts";

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

// Helper to create a mock validator
function createMockValidator(
  id: string,
  result: ValidatorResult,
): Validator {
  return {
    id,
    name: `Mock ${id}`,
    description: `Mock validator for ${id}`,
    validate: () => Promise.resolve(result),
  };
}

Deno.test("validator registry", async (t) => {
  // Reset validators before each test group
  await t.step("setup", () => {
    resetValidators();
  });

  await t.step("getValidator returns git-clean by default", () => {
    const validator = getValidator("git-clean");
    assertExists(validator);
    assertEquals(validator.id, "git-clean");
    assertEquals(validator.name, "Git Clean Validator");
  });

  await t.step("hasValidator returns true for registered validators", () => {
    assertEquals(hasValidator("git-clean"), true);
    assertEquals(hasValidator("nonexistent"), false);
  });

  await t.step("listValidators includes builtin validators", () => {
    const validators = listValidators();
    assertEquals(validators.length >= 1, true);
    assertEquals(validators.some((v) => v.id === "git-clean"), true);
  });

  await t.step("registerValidator adds new validator", () => {
    const customValidator = createMockValidator("custom-test", { valid: true });
    registerValidator(customValidator);

    const retrieved = getValidator("custom-test");
    assertExists(retrieved);
    assertEquals(retrieved.id, "custom-test");
  });

  await t.step("registerValidator throws on duplicate ID", () => {
    // git-clean is already registered
    const duplicate = createMockValidator("git-clean", { valid: true });

    try {
      registerValidator(duplicate);
      throw new Error("Should have thrown");
    } catch (error) {
      assertEquals(
        (error as Error).message,
        "Validator with ID 'git-clean' is already registered",
      );
    }
  });

  await t.step("clearValidators removes all validators", () => {
    clearValidators();
    assertEquals(listValidators().length, 0);
    assertEquals(hasValidator("git-clean"), false);
  });

  await t.step("resetValidators restores builtin validators", () => {
    resetValidators();
    assertEquals(hasValidator("git-clean"), true);
  });
});

Deno.test("runValidators", async (t) => {
  await t.step("setup", () => {
    resetValidators();
  });

  await t.step("returns valid when all validators pass", async () => {
    const successValidator = createMockValidator("success-1", { valid: true });
    registerValidator(successValidator);

    const ctx: ValidatorContext = {
      agentId: "test",
      workingDir: "/tmp",
      logger: mockLogger,
    };

    const result = await runValidators(["success-1"], ctx);
    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
    assertEquals(result.details.length, 0);
  });

  await t.step("returns invalid when any validator fails", async () => {
    const failValidator = createMockValidator("fail-1", {
      valid: false,
      error: "Test failure",
      details: ["file1.ts", "file2.ts"],
    });
    registerValidator(failValidator);

    const ctx: ValidatorContext = {
      agentId: "test",
      workingDir: "/tmp",
      logger: mockLogger,
    };

    const result = await runValidators(["fail-1"], ctx);
    assertEquals(result.valid, false);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0], "[fail-1] Test failure");
    assertEquals(result.details.length, 2);
  });

  await t.step("aggregates results from multiple validators", async () => {
    const pass = createMockValidator("multi-pass", { valid: true });
    const fail = createMockValidator("multi-fail", {
      valid: false,
      error: "Multi failure",
    });
    registerValidator(pass);
    registerValidator(fail);

    const ctx: ValidatorContext = {
      agentId: "test",
      workingDir: "/tmp",
      logger: mockLogger,
    };

    const result = await runValidators(["multi-pass", "multi-fail"], ctx);
    assertEquals(result.valid, false);
    assertEquals(Object.keys(result.results).length, 2);
    assertEquals(result.results["multi-pass"].valid, true);
    assertEquals(result.results["multi-fail"].valid, false);
  });

  await t.step("handles missing validators gracefully", async () => {
    const ctx: ValidatorContext = {
      agentId: "test",
      workingDir: "/tmp",
      logger: mockLogger,
    };

    const result = await runValidators(["nonexistent-validator"], ctx);
    assertEquals(result.valid, true); // No validators ran, so valid
    assertEquals(Object.keys(result.results).length, 0);
  });

  await t.step("handles validator errors gracefully", async () => {
    const errorValidator: Validator = {
      id: "error-validator",
      name: "Error Validator",
      description: "Throws an error",
      validate: () => {
        return Promise.reject(new Error("Validator exploded"));
      },
    };
    registerValidator(errorValidator);

    const ctx: ValidatorContext = {
      agentId: "test",
      workingDir: "/tmp",
      logger: mockLogger,
    };

    const result = await runValidators(["error-validator"], ctx);
    assertEquals(result.valid, false);
    assertEquals(
      result.errors[0].includes("Validator error: Validator exploded"),
      true,
    );
  });
});
