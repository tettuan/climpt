/**
 * Tests for issue-action handler with pre-close validation
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { type IssueActionContext, IssueActionHandler } from "./issue-action.ts";
import type { DetectedAction } from "../types.ts";
import type { Logger } from "../../src_common/logger.ts";
import {
  clearValidators,
  registerValidator,
  resetValidators,
} from "../../validators/registry.ts";
import type { Validator } from "../../validators/types.ts";

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

// Create a mock validator that always passes
function createPassingValidator(id: string): Validator {
  return {
    id,
    name: `Passing ${id}`,
    description: "Always passes",
    validate: () => Promise.resolve({ valid: true }),
  };
}

// Create a mock validator that always fails
function createFailingValidator(
  id: string,
  error: string,
  details?: string[],
): Validator {
  return {
    id,
    name: `Failing ${id}`,
    description: "Always fails",
    validate: () =>
      Promise.resolve({
        valid: false,
        error,
        details,
      }),
  };
}

Deno.test("IssueActionHandler", async (t) => {
  const handler = new IssueActionHandler();

  await t.step("setup", () => {
    resetValidators();
  });

  await t.step("has correct type", () => {
    assertEquals(handler.type, "issue-action");
  });

  await t.step("rejects invalid JSON", async () => {
    const action: DetectedAction = {
      type: "issue-action",
      content: "invalid json",
      metadata: {},
      raw: "not valid json",
    };

    const ctx: IssueActionContext = {
      agentName: "test",
      iteration: 1,
      logger: mockLogger,
      cwd: "/tmp",
    };

    const result = await handler.execute(action, ctx);
    assertEquals(result.success, false);
    assertEquals(result.error?.includes("parse"), true);
  });

  await t.step("rejects missing required fields", async () => {
    const action: DetectedAction = {
      type: "issue-action",
      content: "",
      metadata: {},
      raw: '{"action": "close"}', // missing issue
    };

    const ctx: IssueActionContext = {
      agentName: "test",
      iteration: 1,
      logger: mockLogger,
      cwd: "/tmp",
    };

    const result = await handler.execute(action, ctx);
    assertEquals(result.success, false);
    assertEquals(result.error?.includes("requires"), true);
  });

  await t.step(
    "blocks close when self-reported validation is missing",
    async () => {
      clearValidators();

      const action: DetectedAction = {
        type: "issue-action",
        content: "",
        metadata: {},
        raw: '{"action": "close", "issue": 123}',
      };

      const ctx: IssueActionContext = {
        agentName: "test",
        iteration: 1,
        logger: mockLogger,
        cwd: "/tmp",
      };

      const result = await handler.execute(action, ctx);
      assertEquals(result.success, false);
      assertExists(result.error);
      assertEquals(result.error?.includes("validation results"), true);
      assertEquals(
        (result.result as { validationFailed?: boolean })?.validationFailed,
        true,
      );
    },
  );

  await t.step(
    "blocks close when self-reported git_clean is false",
    async () => {
      clearValidators();

      const action: DetectedAction = {
        type: "issue-action",
        content: "",
        metadata: {},
        raw: JSON.stringify({
          action: "close",
          issue: 123,
          validation: {
            git_clean: false,
            type_check_passed: true,
          },
        }),
      };

      const ctx: IssueActionContext = {
        agentName: "test",
        iteration: 1,
        logger: mockLogger,
        cwd: "/tmp",
      };

      const result = await handler.execute(action, ctx);
      assertEquals(result.success, false);
      assertExists(result.error);
      assertEquals(result.error?.includes("git_clean is false"), true);
    },
  );

  await t.step("blocks close when evidence contradicts claims", async () => {
    clearValidators();

    const action: DetectedAction = {
      type: "issue-action",
      content: "",
      metadata: {},
      raw: JSON.stringify({
        action: "close",
        issue: 123,
        validation: {
          git_clean: true,
          type_check_passed: true,
        },
        evidence: {
          git_status_output: " M some-file.ts",
        },
      }),
    };

    const ctx: IssueActionContext = {
      agentName: "test",
      iteration: 1,
      logger: mockLogger,
      cwd: "/tmp",
    };

    const result = await handler.execute(action, ctx);
    assertEquals(result.success, false);
    assertExists(result.error);
    assertEquals(result.error?.includes("contradicts"), true);
  });

  await t.step("blocks close when pre-close validation fails", async () => {
    // Register a failing validator
    clearValidators();
    const failValidator = createFailingValidator(
      "test-fail",
      "Test validation failed",
      ["file1.ts", "file2.ts"],
    );
    registerValidator(failValidator);

    const action: DetectedAction = {
      type: "issue-action",
      content: "",
      metadata: {},
      raw: JSON.stringify({
        action: "close",
        issue: 123,
        validation: {
          git_clean: true,
          type_check_passed: true,
        },
      }),
    };

    const ctx: IssueActionContext = {
      agentName: "test",
      iteration: 1,
      logger: mockLogger,
      cwd: "/tmp",
      agentConfig: {
        behavior: {
          preCloseValidation: {
            enabled: true,
            validators: ["test-fail"],
            onFailure: "block",
          },
        },
      },
    };

    const result = await handler.execute(action, ctx);
    assertEquals(result.success, false);
    assertExists(result.error);
    assertEquals(
      (result.result as { validationFailed?: boolean })?.validationFailed,
      true,
    );
  });

  await t.step("allows close when all validations pass", async () => {
    // Register a passing validator
    clearValidators();
    const passValidator = createPassingValidator("test-pass");
    registerValidator(passValidator);

    const action: DetectedAction = {
      type: "issue-action",
      content: "",
      metadata: {},
      raw: JSON.stringify({
        action: "close",
        issue: 123,
        validation: {
          git_clean: true,
          type_check_passed: true,
        },
        evidence: {
          git_status_output: "",
        },
      }),
    };

    // Note: This will fail because gh command isn't available in test
    // but we're testing that validation passes and proceeds to execution
    const ctx: IssueActionContext = {
      agentName: "test",
      iteration: 1,
      logger: mockLogger,
      cwd: "/tmp",
      agentConfig: {
        behavior: {
          preCloseValidation: {
            enabled: true,
            validators: ["test-pass"],
            onFailure: "block",
          },
        },
      },
    };

    const result = await handler.execute(action, ctx);
    // The close will fail because gh isn't available, but validation passed
    // So check that the error is NOT validation-related
    if (!result.success) {
      assertEquals(
        result.error?.includes("validation"),
        false,
        "Error should not be validation failure",
      );
    }
  });

  await t.step("skips pre-close validation when disabled", async () => {
    // Register a failing validator that should not be called
    clearValidators();
    let validatorCalled = false;
    const failValidator: Validator = {
      id: "should-not-call",
      name: "Should Not Call",
      description: "Should not be called",
      validate: () => {
        validatorCalled = true;
        return Promise.resolve({ valid: false, error: "Should not run" });
      },
    };
    registerValidator(failValidator);

    const action: DetectedAction = {
      type: "issue-action",
      content: "",
      metadata: {},
      raw: JSON.stringify({
        action: "close",
        issue: 123,
        validation: {
          git_clean: true,
          type_check_passed: true,
        },
      }),
    };

    const ctx: IssueActionContext = {
      agentName: "test",
      iteration: 1,
      logger: mockLogger,
      cwd: "/tmp",
      agentConfig: {
        behavior: {
          preCloseValidation: {
            enabled: false,
            validators: ["should-not-call"],
          },
        },
      },
    };

    await handler.execute(action, ctx);
    assertEquals(
      validatorCalled,
      false,
      "Validator should not have been called",
    );
  });

  await t.step("warns but proceeds when onFailure is warn", async () => {
    clearValidators();
    const failValidator = createFailingValidator(
      "test-warn",
      "Warning only",
    );
    registerValidator(failValidator);

    const action: DetectedAction = {
      type: "issue-action",
      content: "",
      metadata: {},
      raw: JSON.stringify({
        action: "close",
        issue: 123,
        validation: {
          git_clean: true,
          type_check_passed: true,
        },
      }),
    };

    const ctx: IssueActionContext = {
      agentName: "test",
      iteration: 1,
      logger: mockLogger,
      cwd: "/tmp",
      agentConfig: {
        behavior: {
          preCloseValidation: {
            enabled: true,
            validators: ["test-warn"],
            onFailure: "warn",
          },
        },
      },
    };

    const result = await handler.execute(action, ctx);
    // Should proceed to gh command (which will fail)
    // But NOT be blocked by validation
    if (!result.success) {
      assertEquals(
        (result.result as { validationFailed?: boolean })?.validationFailed,
        undefined,
        "Should not be blocked by validation",
      );
    }
  });

  await t.step("handles progress action", async () => {
    resetValidators();

    const action: DetectedAction = {
      type: "issue-action",
      content: "",
      metadata: {},
      raw: '{"action": "progress", "issue": 123, "body": "Making progress"}',
    };

    const ctx: IssueActionContext = {
      agentName: "test",
      iteration: 1,
      logger: mockLogger,
      cwd: "/tmp",
    };

    // This will fail because gh isn't available
    const result = await handler.execute(action, ctx);
    // Just verify it attempted the progress action, not validation failure
    if (!result.success) {
      assertEquals(
        result.error?.includes("validation"),
        false,
      );
    }
  });

  await t.step("handles blocked action", async () => {
    const action: DetectedAction = {
      type: "issue-action",
      content: "",
      metadata: {},
      raw:
        '{"action": "blocked", "issue": 123, "body": "Blocked on X", "label": "need clearance"}',
    };

    const ctx: IssueActionContext = {
      agentName: "test",
      iteration: 1,
      logger: mockLogger,
      cwd: "/tmp",
    };

    // This will fail because gh isn't available
    const result = await handler.execute(action, ctx);
    // Just verify it attempted the blocked action
    if (!result.success) {
      assertEquals(
        result.error?.includes("validation"),
        false,
      );
    }
  });

  await t.step("cleanup", () => {
    resetValidators();
  });
});
