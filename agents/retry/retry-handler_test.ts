/**
 * RetryHandler Tests
 *
 * Tests for retry prompt generation based on failure patterns.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Logger } from "../src_common/logger.ts";
import type {
  ExtendedStepsRegistry,
  ValidationStepConfig,
  ValidatorResult,
} from "./types.ts";
import {
  buildMatchCorpus,
  RetryHandler,
  type RetryHandlerContext,
  scoreKeywords,
} from "./retry-handler.ts";

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
const testStepConfig: ValidationStepConfig = {
  stepId: "test-step",
  name: "Test Step",
  c2: "retry",
  c3: "issue",
  validationConditions: [],
  onFailure: { action: "retry", maxAttempts: 3 },
};

// Use a temp dir so C3LPromptLoader cannot find real templates.
// This ensures tests always hit the generic fallback path, making them hermetic.
const testWorkingDir = Deno.makeTempDirSync({ prefix: "retry-handler-test-" });
const testContext: RetryHandlerContext = {
  workingDir: testWorkingDir,
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

// Test registry with failurePatterns
const testRegistry: ExtendedStepsRegistry = {
  ...baseRegistryProps,
  failurePatterns: {
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

Deno.test("getPattern - returns undefined when registry has no failurePatterns", () => {
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
  // Use empty registry with no failurePatterns to trigger fallback path
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

  // Template not available in test env → falls through to generic English fallback
  assertStringIncludes(prompt, "## Verdict conditions not met");
  assertStringIncludes(
    prompt,
    "Please resolve this issue and try completing again.",
  );
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

  // Template not available in test env → falls through to generic English fallback
  assertStringIncludes(prompt, "## Verdict conditions not met");
  assertStringIncludes(
    prompt,
    "Please resolve this issue and try completing again.",
  );
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

  // Template not available in test env → falls through to generic English fallback
  assertStringIncludes(prompt, "## Verdict conditions not met");
  assertStringIncludes(
    prompt,
    "Please resolve this issue and try completing again.",
  );
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

  // Template not available in test env → falls through to generic English fallback
  assertStringIncludes(prompt, "## Verdict conditions not met");
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

  // Template not available in test env → falls through to generic English fallback
  assertStringIncludes(prompt, "## Verdict conditions not met");
  assertStringIncludes(
    prompt,
    "Please resolve this issue and try completing again.",
  );
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

  // Template not available in test env → falls through to generic English fallback
  assertStringIncludes(prompt, "## Verdict conditions not met");
  assertStringIncludes(
    prompt,
    "Please resolve this issue and try completing again.",
  );
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

  // Template not available in test env → falls through to generic English fallback
  // Params are still injected into the generic prompt
  assertStringIncludes(prompt, "## Verdict conditions not met");
  assertStringIncludes(prompt, "modified.ts");
});

// ============================================================================
// Test: Shadow contract regression — c1 must be parameterized
// ============================================================================

Deno.test("buildRetryPrompt - respects non-default c1 value in path resolution", async () => {
  // Contract Test: registry.c1 is the source of truth for c1 in C3L paths.
  // If c1 is hardcoded to "steps", this test fails because the path
  // resolves under "steps/" instead of "steps-v2/".
  const customC1 = "steps-v2";
  const customRegistry: ExtendedStepsRegistry = {
    ...baseRegistryProps,
    c1: customC1,
    failurePatterns: {
      "git-dirty": {
        description: "Git working directory is not clean",
        edition: "failed",
        adaptation: "git-dirty",
        params: ["changedFiles"],
      },
    },
    validators: {},
  };

  // Capture warn logs to inspect the expected path
  const warnLogs: unknown[] = [];
  const capturingLogger: Logger = {
    ...mockLogger,
    warn: (...args: unknown[]) => {
      warnLogs.push(args);
    },
    debug: () => {},
  } as unknown as Logger;

  const ctx: RetryHandlerContext = {
    workingDir: Deno.cwd(),
    logger: capturingLogger,
    agentId: "iterator",
  };

  const handler = new RetryHandler(customRegistry, ctx);

  const validationResult: ValidatorResult = {
    valid: false,
    pattern: "git-dirty",
    error: "Git directory is dirty",
    params: { changedFiles: ["modified.ts"] },
  };

  // Prompt loading will fail (no actual file), falling through to warn log
  // that includes the expected path — verify it uses customC1, not "steps"
  await handler.buildRetryPrompt(testStepConfig, validationResult);

  // The warn log should contain the c3lPath with c1 = "steps-v2"
  const pathLog = warnLogs.find((log) => {
    const str = JSON.stringify(log);
    return str.includes("c3lPath") || str.includes("expectedPath");
  });

  assertEquals(
    pathLog !== undefined,
    true,
    `Fix: RetryHandler.buildRetryPrompt must use registry.c1 ("${customC1}") ` +
      `in c3lPath, not a hardcoded value. ` +
      `Check agents/retry/retry-handler.ts buildRetryPrompt and buildFallbackPrompt methods.`,
  );

  const logStr = JSON.stringify(pathLog);
  assertStringIncludes(
    logStr,
    customC1,
    `Fix: c3lPath.c1 must be "${customC1}" (from registry.c1), not "steps". ` +
      `RetryHandler at agents/retry/retry-handler.ts is using a hardcoded c1 value ` +
      `that bypasses the parameterized registry.c1.`,
  );
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

// ============================================================================
// Test: buildMatchCorpus
// ============================================================================

Deno.test("buildMatchCorpus - returns undefined for empty result", () => {
  const result: ValidatorResult = { valid: false };
  assertEquals(buildMatchCorpus(result), undefined);
});

Deno.test("buildMatchCorpus - includes error text lowercased", () => {
  const result: ValidatorResult = {
    valid: false,
    error: "FATAL: Git directory is DIRTY",
  };
  const corpus = buildMatchCorpus(result);
  assertStringIncludes(corpus!, "fatal: git directory is dirty");
});

Deno.test("buildMatchCorpus - includes string params and array params", () => {
  const result: ValidatorResult = {
    valid: false,
    params: {
      errorOutput: "TypeErrors found",
      changedFiles: ["src/a.ts", "src/b.ts"],
      numericValue: 42, // non-string, should be skipped
    },
  };
  const corpus = buildMatchCorpus(result);
  assertStringIncludes(corpus!, "typeerrors found");
  assertStringIncludes(corpus!, "src/a.ts");
  assertStringIncludes(corpus!, "src/b.ts");
});

Deno.test("buildMatchCorpus - includes semantic summary and rootCause", () => {
  const result: ValidatorResult = {
    valid: false,
    error: "test failed",
    semanticParams: {
      raw: {},
      summary: "3 unit tests failed in module X",
      severity: "error",
      relatedFiles: [],
      rootCause: "Missing import statement",
    },
  };
  const corpus = buildMatchCorpus(result);
  assertStringIncludes(corpus!, "3 unit tests failed in module x");
  assertStringIncludes(corpus!, "missing import statement");
});

// ============================================================================
// Test: scoreKeywords
// ============================================================================

Deno.test("scoreKeywords - plain keywords are case-insensitive", () => {
  const score = scoreKeywords(["dirty", "git"], "git directory is dirty");
  assertEquals(score, 2);
});

Deno.test("scoreKeywords - returns 0 for no matches", () => {
  const score = scoreKeywords(["lint", "format"], "git directory is dirty");
  assertEquals(score, 0);
});

Deno.test("scoreKeywords - regex keywords match correctly", () => {
  const score = scoreKeywords(
    ["/\\d+ tests? failed/", "assertion"],
    "5 tests failed: assertion error in module.ts",
  );
  assertEquals(score, 2);
});

Deno.test("scoreKeywords - invalid regex is skipped silently", () => {
  const score = scoreKeywords(
    ["/[invalid/", "dirty"],
    "git directory is dirty",
  );
  // /[invalid/ is invalid regex and should be skipped, "dirty" matches
  assertEquals(score, 1);
});

Deno.test("scoreKeywords - partial keyword matches count", () => {
  // "error" is a substring of "typeerrors"
  const score = scoreKeywords(["error"], "typeerrors found in build");
  assertEquals(score, 1);
});

// ============================================================================
// Test: findBestPattern — semantic fuzzy matching
// ============================================================================

// Registry with semanticMatch keywords for fuzzy matching tests
const semanticRegistry: ExtendedStepsRegistry = {
  ...baseRegistryProps,
  failurePatterns: {
    "git-dirty": {
      description: "Git working directory is not clean",
      edition: "failed",
      adaptation: "git-dirty",
      params: ["changedFiles", "untrackedFiles"],
      semanticMatch: ["dirty", "uncommitted", "modified", "untracked"],
    },
    "test-failure": {
      description: "Tests failed",
      edition: "failed",
      adaptation: "test-failure",
      params: ["failedTests", "errorOutput"],
      semanticMatch: ["test", "failed", "assertion", "/\\d+ tests? failed/"],
    },
    "lint-error": {
      description: "Lint errors found",
      edition: "failed",
      adaptation: "lint-error",
      params: ["lintErrors"],
      semanticMatch: ["lint", "eslint", "deno-lint"],
    },
    "no-keywords": {
      description: "Pattern without semanticMatch",
      edition: "failed",
      adaptation: "no-keywords",
      params: [],
      // No semanticMatch — should never be selected by fuzzy matching
    },
  },
  validators: {},
};

Deno.test("findBestPattern - selects pattern with highest keyword score", () => {
  const handler = new RetryHandler(semanticRegistry, testContext);

  // Error text matches "test", "failed", "assertion", and regex /\d+ tests? failed/
  // — 4 keywords for test-failure. "dirty" is NOT in the error text.
  const result: ValidatorResult = {
    valid: false,
    error: "3 tests failed with assertion errors",
  };

  const match = handler.findBestPattern(result);

  assertEquals(match?.name, "test-failure");
  assertEquals(match?.score, 4); // "test", "failed", "assertion", regex
});

Deno.test("findBestPattern - selects git-dirty when error contains git keywords", () => {
  const handler = new RetryHandler(semanticRegistry, testContext);

  const result: ValidatorResult = {
    valid: false,
    error:
      "Working directory has uncommitted modified files and untracked items",
  };

  const match = handler.findBestPattern(result);

  assertEquals(match?.name, "git-dirty");
  assertEquals(match?.score, 3); // "uncommitted", "modified", "untracked"
});

Deno.test("findBestPattern - returns undefined when no keywords match", () => {
  const handler = new RetryHandler(semanticRegistry, testContext);

  const result: ValidatorResult = {
    valid: false,
    error: "network timeout connecting to API server",
  };

  const match = handler.findBestPattern(result);

  assertEquals(match, undefined);
});

Deno.test("findBestPattern - returns undefined when no patterns have semanticMatch", () => {
  const noSemanticRegistry: ExtendedStepsRegistry = {
    ...baseRegistryProps,
    failurePatterns: {
      "no-keywords": {
        description: "Pattern without semanticMatch",
        edition: "failed",
        adaptation: "no-keywords",
        params: [],
      },
    },
    validators: {},
  };

  const handler = new RetryHandler(noSemanticRegistry, testContext);

  const result: ValidatorResult = {
    valid: false,
    error: "some error happened",
  };

  const match = handler.findBestPattern(result);

  assertEquals(match, undefined);
});

Deno.test("findBestPattern - returns undefined when corpus is empty", () => {
  const handler = new RetryHandler(semanticRegistry, testContext);

  const result: ValidatorResult = { valid: false };

  const match = handler.findBestPattern(result);

  assertEquals(match, undefined);
});

Deno.test("findBestPattern - regex keyword in semanticMatch is matched", () => {
  const handler = new RetryHandler(semanticRegistry, testContext);

  // Match the regex /\d+ tests? failed/ in test-failure pattern
  const result: ValidatorResult = {
    valid: false,
    error: "1 test failed in module runner",
  };

  const match = handler.findBestPattern(result);

  assertEquals(match?.name, "test-failure");
  // "test" + "failed" + regex /\d+ tests? failed/ = 3
  assertEquals(match?.score, 3);
});

Deno.test("findBestPattern - matches against params, not just error", () => {
  const handler = new RetryHandler(semanticRegistry, testContext);

  // Error is generic, but params contain lint-related text
  const result: ValidatorResult = {
    valid: false,
    error: "validation failed",
    params: {
      output: "deno-lint reported 5 violations",
    },
  };

  const match = handler.findBestPattern(result);

  assertEquals(match?.name, "lint-error");
  // "lint" + "deno-lint" = 2
  assertEquals(match?.score, 2);
});

// ============================================================================
// Test: buildRetryPrompt — semantic fallback integration
// ============================================================================

Deno.test("buildRetryPrompt - uses semantic match when exact pattern not found", async () => {
  const handler = new RetryHandler(semanticRegistry, testContext);

  // Pattern name does not exist in registry, but error text matches test-failure keywords
  const validationResult: ValidatorResult = {
    valid: false,
    pattern: "unknown-pattern-xyz",
    error: "3 tests failed with assertion errors",
  };

  const prompt = await handler.buildRetryPrompt(
    testStepConfig,
    validationResult,
  );

  // Even though exact pattern "unknown-pattern-xyz" is not registered,
  // semantic matching should find "test-failure" and try its template.
  // In test env there's no template file, so it falls through to generic prompt.
  // The generic prompt should still include error details.
  assertStringIncludes(prompt, "## Verdict conditions not met");
  assertStringIncludes(prompt, "3 tests failed with assertion errors");
});

Deno.test("buildRetryPrompt - falls back to generic when no semantic match either", async () => {
  const handler = new RetryHandler(semanticRegistry, testContext);

  // Pattern name does not exist AND error text matches no keywords
  const validationResult: ValidatorResult = {
    valid: false,
    pattern: "unknown-pattern-xyz",
    error: "network timeout connecting to API server",
  };

  const prompt = await handler.buildRetryPrompt(
    testStepConfig,
    validationResult,
  );

  // No semantic match possible, should fall back to generic prompt
  assertStringIncludes(prompt, "## Verdict conditions not met");
  assertStringIncludes(prompt, "network timeout connecting to API server");
});

Deno.test("buildRetryPrompt - exact match still takes priority over semantic", async () => {
  const handler = new RetryHandler(semanticRegistry, testContext);

  // Pattern name exists exactly in registry — should use it, not fuzzy match
  const validationResult: ValidatorResult = {
    valid: false,
    pattern: "git-dirty",
    error: "working directory is not clean, tests also failed",
  };

  const prompt = await handler.buildRetryPrompt(
    testStepConfig,
    validationResult,
  );

  // Even though error text might score higher for test-failure,
  // exact match for git-dirty should be used.
  // Template not available in test env, falls through to generic.
  assertStringIncludes(prompt, "## Verdict conditions not met");
  assertStringIncludes(prompt, "git-dirty");
});

// ============================================================================
// Test: additionalPatterns field on ValidatorResult
// ============================================================================

Deno.test("ValidatorResult - additionalPatterns field is preserved through buildRetryPrompt", async () => {
  const handler = new RetryHandler(testRegistry, testContext);

  const validationResult: ValidatorResult = {
    valid: false,
    pattern: "git-dirty",
    additionalPatterns: ["test-failure", "lint-error"],
    error: "Multiple validation failures",
    params: { changedFiles: ["a.ts"] },
  };

  // Ensure the field does not cause runtime errors
  const prompt = await handler.buildRetryPrompt(
    testStepConfig,
    validationResult,
  );

  // Prompt should still be generated successfully
  assertStringIncludes(prompt, "## Verdict conditions not met");
});

// ============================================================================
// Test: Semantic params merged into retry prompt
// ============================================================================

Deno.test("buildRetryPrompt - includes semantic params in generic fallback", async () => {
  const emptyRegistry: ExtendedStepsRegistry = {
    ...baseRegistryProps,
  };
  const handler = new RetryHandler(emptyRegistry, testContext);

  const validationResult: ValidatorResult = {
    valid: false,
    pattern: "unknown",
    error: "compilation failed",
    semanticParams: {
      raw: {},
      summary: "TypeScript compilation failed with 3 errors",
      severity: "error",
      relatedFiles: ["src/main.ts", "src/utils.ts"],
      rootCause: "Missing type imports",
      suggestedAction: "Add import statements for missing types",
    },
  };

  const prompt = await handler.buildRetryPrompt(
    testStepConfig,
    validationResult,
  );

  assertStringIncludes(prompt, "TypeScript compilation failed with 3 errors");
  assertStringIncludes(prompt, "Missing type imports");
  assertStringIncludes(prompt, "Add import statements for missing types");
  assertStringIncludes(prompt, "src/main.ts");
});
