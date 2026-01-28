/**
 * RetryHandler Tests
 *
 * Tests for retry prompt generation based on failure patterns.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Logger } from "../src_common/logger.ts";
import type {
  CompletionStepConfig,
  ExtendedStepsRegistry,
  ValidatorResult,
} from "./types.ts";
import { RetryHandler, type RetryHandlerContext } from "./retry-handler.ts";

// Mock logger (simplified for testing)
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

// Test fixtures
const testStepConfig: CompletionStepConfig = {
  stepId: "test-step",
  name: "Test Step",
  c2: "retry",
  c3: "issue",
  completionConditions: [],
  onFailure: { action: "retry", maxAttempts: 3 },
};

const testContext: RetryHandlerContext = {
  workingDir: Deno.cwd(),
  logger: mockLogger,
  agentId: "iterator",
};

// Base registry properties required by StepRegistry
const baseRegistryProps = {
  agentId: "test-agent",
  version: "1.0.0",
  c1: "steps",
  steps: {},
};

// Test registry with completionPatterns
const testRegistry: ExtendedStepsRegistry = {
  ...baseRegistryProps,
  completionPatterns: {
    "git-dirty": {
      description: "Git working directory is not clean",
      edition: "failed",
      adaptation: "git-dirty",
      params: ["changedFiles", "untrackedFiles"],
    },
    "test-failure": {
      description: "Tests failed",
      edition: "failed",
      adaptation: "test-failure",
      params: ["failedTests", "errorOutput"],
    },
  },
  validators: {},
};

// ============================================================================
// Test: getPattern
// ============================================================================

Deno.test("getPattern - returns pattern from registry", () => {
  const handler = new RetryHandler(testRegistry, testContext);

  const pattern = handler.getPattern("git-dirty");

  assertEquals(pattern?.description, "Git working directory is not clean");
  assertEquals(pattern?.edition, "failed");
  assertEquals(pattern?.adaptation, "git-dirty");
  assertEquals(pattern?.params, ["changedFiles", "untrackedFiles"]);
});

Deno.test("getPattern - returns undefined for unknown pattern", () => {
  const handler = new RetryHandler(testRegistry, testContext);

  const pattern = handler.getPattern("non-existent-pattern");

  assertEquals(pattern, undefined);
});

Deno.test("getPattern - returns undefined when registry has no completionPatterns", () => {
  const emptyRegistry: ExtendedStepsRegistry = {
    ...baseRegistryProps,
  };
  const handler = new RetryHandler(emptyRegistry, testContext);

  const pattern = handler.getPattern("git-dirty");

  assertEquals(pattern, undefined);
});

// ============================================================================
// Test: buildGenericRetryPrompt (via buildRetryPrompt fallback path)
// ============================================================================

Deno.test("buildGenericRetryPrompt - loads fallback f_failed.md template", async () => {
  // Use empty registry with no completionPatterns to trigger fallback path
  const emptyRegistry: ExtendedStepsRegistry = {
    ...baseRegistryProps,
  };
  const handler = new RetryHandler(emptyRegistry, testContext);

  const validationResult: ValidatorResult = {
    valid: false,
    pattern: "unknown-pattern",
    error: "Some error occurred",
    params: {
      changedFiles: ["file1.ts", "file2.ts"],
      errorCount: "5",
    },
  };

  const prompt = await handler.buildRetryPrompt(
    testStepConfig,
    validationResult,
  );

  // Should contain the fallback message from f_failed.md (Japanese template)
  // deno-lint-ignore prefer-ascii
  assertStringIncludes(prompt, "## 完了条件が満たされていません");
  // deno-lint-ignore prefer-ascii
  assertStringIncludes(prompt, "問題を解決して、再度完了を試みてください。");
});

Deno.test("buildGenericRetryPrompt - handles validation result without pattern", async () => {
  const emptyRegistry: ExtendedStepsRegistry = {
    ...baseRegistryProps,
  };
  const handler = new RetryHandler(emptyRegistry, testContext);

  const validationResult: ValidatorResult = {
    valid: false,
    error: "Generic failure",
  };

  const prompt = await handler.buildRetryPrompt(
    testStepConfig,
    validationResult,
  );

  // Should contain the fallback message from f_failed.md (Japanese template)
  // Note: error is not displayed as it's not passed via params to the template
  // deno-lint-ignore prefer-ascii
  assertStringIncludes(prompt, "## 完了条件が満たされていません");
  // deno-lint-ignore prefer-ascii
  assertStringIncludes(prompt, "問題を解決して、再度完了を試みてください。");
});

Deno.test("buildGenericRetryPrompt - handles empty params gracefully", async () => {
  const emptyRegistry: ExtendedStepsRegistry = {
    ...baseRegistryProps,
  };
  const handler = new RetryHandler(emptyRegistry, testContext);

  const validationResult: ValidatorResult = {
    valid: false,
    pattern: "test-pattern",
    params: {},
  };

  const prompt = await handler.buildRetryPrompt(
    testStepConfig,
    validationResult,
  );

  // Should contain the fallback message from f_failed.md (Japanese template)
  // deno-lint-ignore prefer-ascii
  assertStringIncludes(prompt, "## 完了条件が満たされていません");
  // deno-lint-ignore prefer-ascii
  assertStringIncludes(prompt, "問題を解決して、再度完了を試みてください。");
});

Deno.test("buildGenericRetryPrompt - handles array params with objects", async () => {
  const emptyRegistry: ExtendedStepsRegistry = {
    ...baseRegistryProps,
  };
  const handler = new RetryHandler(emptyRegistry, testContext);

  const validationResult: ValidatorResult = {
    valid: false,
    pattern: "test-errors",
    params: {
      errors: [
        { file: "a.ts", line: 10 },
        { file: "b.ts", line: 20 },
      ],
    },
  };

  const prompt = await handler.buildRetryPrompt(
    testStepConfig,
    validationResult,
  );

  // Should contain the fallback message from f_failed.md (Japanese template)
  // deno-lint-ignore prefer-ascii
  assertStringIncludes(prompt, "## 完了条件が満たされていません");
});

// ============================================================================
// Test: buildRetryPrompt - pattern resolution
// ============================================================================

Deno.test("buildRetryPrompt - falls back when pattern not in registry", async () => {
  // Registry has patterns but not the one in validation result
  const handler = new RetryHandler(testRegistry, testContext);

  const validationResult: ValidatorResult = {
    valid: false,
    pattern: "non-existent-pattern",
    error: "Pattern not found error",
  };

  const prompt = await handler.buildRetryPrompt(
    testStepConfig,
    validationResult,
  );

  // Should fall back to f_failed.md template (Japanese)
  // Note: error is not displayed as it's not passed via params to the template
  // deno-lint-ignore prefer-ascii
  assertStringIncludes(prompt, "## 完了条件が満たされていません");
  // deno-lint-ignore prefer-ascii
  assertStringIncludes(prompt, "問題を解決して、再度完了を試みてください。");
});

Deno.test("buildRetryPrompt - falls back when pattern is undefined", async () => {
  const handler = new RetryHandler(testRegistry, testContext);

  const validationResult: ValidatorResult = {
    valid: false,
    pattern: undefined,
    error: "No pattern provided",
  };

  const prompt = await handler.buildRetryPrompt(
    testStepConfig,
    validationResult,
  );

  // Should fall back to f_failed.md template (Japanese)
  // Note: error is not displayed as it's not passed via params to the template
  // deno-lint-ignore prefer-ascii
  assertStringIncludes(prompt, "## 完了条件が満たされていません");
  // deno-lint-ignore prefer-ascii
  assertStringIncludes(prompt, "問題を解決して、再度完了を試みてください。");
});

// ============================================================================
// Test: buildFallbackPrompt path (when C3L prompt loading fails)
// ============================================================================

Deno.test("buildFallbackPrompt - loads pattern-specific prompt when available", async () => {
  // This test verifies that pattern-specific prompts are loaded
  // The git-dirty pattern has a dedicated f_failed_git-dirty.md template
  const handler = new RetryHandler(testRegistry, testContext);

  const validationResult: ValidatorResult = {
    valid: false,
    pattern: "git-dirty", // Valid pattern in registry with dedicated prompt
    error: "Git directory is dirty",
    params: {
      changedFiles: ["modified.ts"],
    },
  };

  // This will load the pattern-specific f_failed_git-dirty.md template
  const prompt = await handler.buildRetryPrompt(
    testStepConfig,
    validationResult,
  );

  // Should load git-dirty specific template (Japanese)
  // deno-lint-ignore prefer-ascii
  assertStringIncludes(prompt, "## 未コミットの変更があります");
  assertStringIncludes(prompt, "modified.ts");
});

// ============================================================================
// Test: createRetryHandler factory function
// ============================================================================

Deno.test("createRetryHandler - creates handler instance", async () => {
  // Import the factory function
  const { createRetryHandler } = await import("./retry-handler.ts");

  const handler = createRetryHandler(testRegistry, testContext);

  // Verify it's a RetryHandler instance by checking getPattern works
  const pattern = handler.getPattern("git-dirty");
  assertEquals(pattern?.description, "Git working directory is not clean");
});
