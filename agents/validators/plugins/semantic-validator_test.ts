/**
 * Tests for semantic validator plugin architecture
 *
 * Validates:
 * - SemanticValidatorPlugin interface contract
 * - Plugin registry (register, get, list, reset)
 * - StepValidator dispatch for type: "semantic"
 */

import { assertEquals, assertExists } from "@std/assert";
import type { ValidatorDefinition } from "../step/types.ts";
import { StepValidator } from "../step/validator.ts";
import {
  clearSemanticPlugins,
  getSemanticPlugin,
  listSemanticPlugins,
  registerSemanticPlugin,
  resetSemanticPlugins,
} from "../step/validator.ts";
import type {
  SemanticValidatorContext,
  SemanticValidatorPlugin,
  SemanticValidatorResult,
} from "./semantic-validator.ts";

// Mock logger
const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as import("../../src_common/logger.ts").Logger;

// ============================================================================
// Semantic plugin registry tests
// ============================================================================

Deno.test("semantic plugin registry - commit-message plugin is registered by default", () => {
  resetSemanticPlugins();
  const plugin = getSemanticPlugin("commit-message");
  assertExists(plugin);
  assertEquals(plugin.name, "commit-message");
});

Deno.test("semantic plugin registry - listSemanticPlugins includes built-in", () => {
  resetSemanticPlugins();
  const plugins = listSemanticPlugins();
  assertEquals(plugins.length >= 1, true);
  assertEquals(plugins.some((p) => p.name === "commit-message"), true);
});

Deno.test("semantic plugin registry - registerSemanticPlugin adds new plugin", () => {
  resetSemanticPlugins();
  const customPlugin: SemanticValidatorPlugin = {
    name: "custom-test-plugin",
    validate: () => ({ valid: true }),
  };

  registerSemanticPlugin(customPlugin);
  const retrieved = getSemanticPlugin("custom-test-plugin");
  assertExists(retrieved);
  assertEquals(retrieved.name, "custom-test-plugin");

  // Cleanup
  resetSemanticPlugins();
});

Deno.test("semantic plugin registry - registerSemanticPlugin throws on duplicate", () => {
  resetSemanticPlugins();
  const duplicate: SemanticValidatorPlugin = {
    name: "commit-message",
    validate: () => ({ valid: true }),
  };

  try {
    registerSemanticPlugin(duplicate);
    throw new Error("Should have thrown");
  } catch (error) {
    assertEquals(
      (error as Error).message,
      "Semantic plugin 'commit-message' is already registered",
    );
  }
});

Deno.test("semantic plugin registry - clearSemanticPlugins empties registry", () => {
  resetSemanticPlugins();
  clearSemanticPlugins();
  assertEquals(listSemanticPlugins().length, 0);
  assertEquals(getSemanticPlugin("commit-message"), undefined);

  // Cleanup
  resetSemanticPlugins();
});

Deno.test("semantic plugin registry - resetSemanticPlugins restores built-ins", () => {
  clearSemanticPlugins();
  assertEquals(listSemanticPlugins().length, 0);

  resetSemanticPlugins();
  assertExists(getSemanticPlugin("commit-message"));
});

// ============================================================================
// StepValidator semantic dispatch tests
// ============================================================================

/**
 * Helper: build a semantic ValidatorDefinition.
 */
function semanticValidator(
  checkType: string,
  failurePattern: string,
): ValidatorDefinition {
  return {
    type: "semantic",
    semanticConfig: { checkType: checkType as "commit-message" },
    successWhen: "empty", // Not used by semantic validators
    failurePattern,
    extractParams: {},
  };
}

Deno.test("StepValidator - semantic type: passes when commit message is task-relevant", async () => {
  resetSemanticPlugins();

  const registry = {
    validators: {
      "check-commits": semanticValidator("commit-message", "bad-commit"),
    },
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
    agentId: "test-agent",
  });

  const result = await validator.validate([
    {
      validator: "check-commits",
      params: {
        taskDescription: "Fix authentication bug in login module",
        commitMessages: ["fix: resolve issue #123 authentication bug"],
      },
    },
  ]);

  assertEquals(result.valid, true);
});

Deno.test("StepValidator - semantic type: warns on generic commit message", async () => {
  resetSemanticPlugins();

  const registry = {
    validators: {
      "check-commits": semanticValidator("commit-message", "bad-commit"),
    },
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
    agentId: "test-agent",
  });

  const result = await validator.validate([
    {
      validator: "check-commits",
      params: {
        taskDescription: "Fix authentication bug in login module",
        commitMessages: ["update"],
      },
    },
  ]);

  assertEquals(result.valid, false);
  assertEquals(result.pattern, "bad-commit");
  assertEquals(result.recoverable, true);
  assertExists(result.error);
});

Deno.test("StepValidator - semantic type: skips when no task description", async () => {
  resetSemanticPlugins();

  const registry = {
    validators: {
      "check-commits": semanticValidator("commit-message", "bad-commit"),
    },
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
    agentId: "test-agent",
  });

  const result = await validator.validate([
    {
      validator: "check-commits",
      params: {
        commitMessages: ["update"],
      },
    },
  ]);

  // No task description -> validator skips, returns valid
  assertEquals(result.valid, true);
});

Deno.test("StepValidator - semantic type: graceful when semanticConfig missing", async () => {
  resetSemanticPlugins();

  const badDef: ValidatorDefinition = {
    type: "semantic",
    // semanticConfig intentionally omitted
    successWhen: "empty",
    failurePattern: "bad-config",
    extractParams: {},
  };

  const registry = {
    validators: { "bad-semantic": badDef },
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
    agentId: "test-agent",
  });

  const result = await validator.validate([
    { validator: "bad-semantic" },
  ]);

  // Missing config -> validator logs warning, returns valid
  assertEquals(result.valid, true);
});

Deno.test("StepValidator - semantic type: graceful when plugin not found", async () => {
  resetSemanticPlugins();

  const registry = {
    validators: {
      "unknown-semantic": semanticValidator(
        "nonexistent-check" as "commit-message",
        "missing-plugin",
      ),
    },
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
    agentId: "test-agent",
  });

  const result = await validator.validate([
    { validator: "unknown-semantic" },
  ]);

  // Unknown plugin -> validator logs warning, returns valid
  assertEquals(result.valid, true);
});

Deno.test("StepValidator - semantic type: works alongside command validators", async () => {
  resetSemanticPlugins();

  const registry = {
    validators: {
      "always-pass-cmd": {
        type: "command" as const,
        command: "echo ''",
        successWhen: "empty" as const,
        failurePattern: "cmd-fail",
        extractParams: {},
      },
      "check-commits": semanticValidator("commit-message", "bad-commit"),
    },
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
    agentId: "test-agent",
  });

  const result = await validator.validate([
    { validator: "always-pass-cmd" },
    {
      validator: "check-commits",
      params: {
        taskDescription: "Fix authentication bug",
        commitMessages: ["fix: resolve authentication issue"],
      },
    },
  ]);

  assertEquals(result.valid, true);
});

// ============================================================================
// Custom plugin integration test
// ============================================================================

Deno.test("StepValidator - semantic type: custom plugin dispatches correctly", async () => {
  resetSemanticPlugins();

  // Register a custom semantic plugin
  const customPlugin: SemanticValidatorPlugin = {
    name: "file-relevance",
    validate(context: SemanticValidatorContext): SemanticValidatorResult {
      if (!context.changedFiles || context.changedFiles.length === 0) {
        return { valid: true, severity: "info" };
      }
      // Heuristic: at least one changed file should contain a task keyword
      const hasRelevant = context.changedFiles.some((f) => f.includes("auth"));
      if (!hasRelevant) {
        return {
          valid: false,
          message: "No changed files appear related to the task",
          severity: "warning",
        };
      }
      return { valid: true, severity: "info" };
    },
  };

  registerSemanticPlugin(customPlugin);

  const registry = {
    validators: {
      "check-files": semanticValidator("file-relevance", "irrelevant-files"),
    },
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
    agentId: "test-agent",
  });

  // Test: relevant files pass
  const passResult = await validator.validate([
    {
      validator: "check-files",
      params: {
        changedFiles: ["src/auth/login.ts", "src/utils.ts"],
      },
    },
  ]);
  assertEquals(passResult.valid, true);

  // Test: irrelevant files fail
  const failResult = await validator.validate([
    {
      validator: "check-files",
      params: {
        changedFiles: ["src/database/schema.ts", "src/utils.ts"],
      },
    },
  ]);
  assertEquals(failResult.valid, false);
  assertEquals(failResult.pattern, "irrelevant-files");
  assertEquals(failResult.recoverable, true);

  // Cleanup
  resetSemanticPlugins();
});
