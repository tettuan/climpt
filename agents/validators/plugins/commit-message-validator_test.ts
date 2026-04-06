/**
 * Tests for commit-message semantic validator
 *
 * Validates heuristic correctness:
 * - Task-relevant messages pass
 * - Generic messages produce warnings
 * - Keyword matching works across conventional commit formats
 * - Missing context (no task description) skips gracefully
 */

import { assertEquals } from "@std/assert";
import {
  commitMessageValidator,
  extractKeywords,
  isGenericMessage,
  messageMatchesTask,
  stripConventionalPrefix,
} from "./commit-message-validator.ts";
import type { SemanticValidatorContext } from "./semantic-validator.ts";

// ============================================================================
// Unit tests: helper functions
// ============================================================================

Deno.test("extractKeywords - extracts words of sufficient length, excluding stop words", () => {
  const keywords = extractKeywords(
    "Fix the authentication bug in login module",
  );
  // "fix" is 3 chars (< 4), "the" is stop word, "in" is 2 chars
  assertEquals(keywords.has("authentication"), true);
  assertEquals(keywords.has("login"), true);
  assertEquals(keywords.has("module"), true);
  assertEquals(keywords.has("fix"), false); // too short
  assertEquals(keywords.has("the"), false); // too short
  assertEquals(keywords.size > 0, true); // non-vacuity check
});

Deno.test("extractKeywords - handles empty string", () => {
  const keywords = extractKeywords("");
  assertEquals(keywords.size, 0);
});

Deno.test("extractKeywords - deduplicates words", () => {
  const keywords = extractKeywords("auth auth auth different");
  assertEquals(keywords.has("auth"), true);
  assertEquals(keywords.has("different"), true);
  assertEquals(keywords.size, 2);
});

Deno.test("stripConventionalPrefix - strips fix: prefix", () => {
  assertEquals(
    stripConventionalPrefix("fix: resolve auth bug"),
    "resolve auth bug",
  );
});

Deno.test("stripConventionalPrefix - strips feat(scope): prefix", () => {
  assertEquals(
    stripConventionalPrefix("feat(api): add endpoint"),
    "add endpoint",
  );
});

Deno.test("stripConventionalPrefix - preserves plain messages", () => {
  assertEquals(
    stripConventionalPrefix("resolve authentication issue"),
    "resolve authentication issue",
  );
});

Deno.test("isGenericMessage - detects single-word generic messages", () => {
  assertEquals(isGenericMessage("fix"), true);
  assertEquals(isGenericMessage("update"), true);
  assertEquals(isGenericMessage("wip"), true);
  assertEquals(isGenericMessage("done"), true);
});

Deno.test("isGenericMessage - detects generic after prefix stripping", () => {
  assertEquals(isGenericMessage("fix: update"), true);
  assertEquals(isGenericMessage("chore: cleanup"), true);
});

Deno.test("isGenericMessage - rejects multi-word meaningful messages", () => {
  assertEquals(isGenericMessage("fix: resolve authentication bug"), false);
  assertEquals(isGenericMessage("add login validation"), false);
});

Deno.test("isGenericMessage - detects empty body after prefix", () => {
  assertEquals(isGenericMessage("fix:"), true);
  assertEquals(isGenericMessage("fix: "), true);
});

Deno.test("messageMatchesTask - matches keyword in message", () => {
  const keywords = new Set(["authentication", "login"]);
  assertEquals(
    messageMatchesTask("fix: resolve authentication bug", keywords),
    true,
  );
});

Deno.test("messageMatchesTask - matches partial keyword (substring)", () => {
  const keywords = new Set(["auth"]);
  assertEquals(
    messageMatchesTask("fix: resolve authentication issue", keywords),
    true,
  );
});

Deno.test("messageMatchesTask - returns false when no keywords match", () => {
  const keywords = new Set(["database", "migration"]);
  assertEquals(
    messageMatchesTask("fix: resolve authentication bug", keywords),
    false,
  );
});

Deno.test("messageMatchesTask - case insensitive", () => {
  const keywords = new Set(["authentication"]);
  assertEquals(
    messageMatchesTask("Fix: Resolve Authentication Bug", keywords),
    true,
  );
});

// ============================================================================
// Integration tests: commitMessageValidator.validate
// ============================================================================

Deno.test("commitMessageValidator - valid: task-relevant commit message", () => {
  const context: SemanticValidatorContext = {
    stepId: "test-step",
    taskDescription: "Fix authentication bug in login module",
    commitMessages: ["fix: resolve issue #123 authentication bug"],
  };

  const result = commitMessageValidator.validate(context);
  assertEquals(result.valid, true);
  assertEquals(result.severity, "info");
});

Deno.test("commitMessageValidator - warning: generic message with task context", () => {
  const context: SemanticValidatorContext = {
    stepId: "test-step",
    taskDescription: "Fix authentication bug in login module",
    commitMessages: ["update"],
  };

  const result = commitMessageValidator.validate(context);
  assertEquals(result.valid, false);
  assertEquals(result.severity, "warning");
  assertEquals(
    result.message?.includes("too generic"),
    true,
    `Expected message to include "too generic", got: ${result.message}`,
  );
});

Deno.test("commitMessageValidator - warning: message unrelated to task", () => {
  const context: SemanticValidatorContext = {
    stepId: "test-step",
    taskDescription: "Fix authentication bug in login module",
    commitMessages: ["refactor: reorganize database schema"],
  };

  const result = commitMessageValidator.validate(context);
  assertEquals(result.valid, false);
  assertEquals(result.severity, "warning");
  assertEquals(
    result.message?.includes("does not reference any keyword"),
    true,
    `Expected message about missing keywords, got: ${result.message}`,
  );
});

Deno.test("commitMessageValidator - valid: keyword match from task description", () => {
  const context: SemanticValidatorContext = {
    stepId: "test-step",
    taskDescription: "Implement user registration endpoint",
    commitMessages: ["feat: add registration form validation"],
  };

  const result = commitMessageValidator.validate(context);
  assertEquals(result.valid, true);
});

Deno.test("commitMessageValidator - skip: no task description available", () => {
  const context: SemanticValidatorContext = {
    stepId: "test-step",
    taskDescription: undefined,
    commitMessages: ["update"],
  };

  const result = commitMessageValidator.validate(context);
  assertEquals(result.valid, true);
  assertEquals(result.severity, "info");
});

Deno.test("commitMessageValidator - skip: no commit messages", () => {
  const context: SemanticValidatorContext = {
    stepId: "test-step",
    taskDescription: "Fix authentication bug",
    commitMessages: [],
  };

  const result = commitMessageValidator.validate(context);
  assertEquals(result.valid, true);
});

Deno.test("commitMessageValidator - skip: empty task description", () => {
  const context: SemanticValidatorContext = {
    stepId: "test-step",
    taskDescription: "   ",
    commitMessages: ["update"],
  };

  const result = commitMessageValidator.validate(context);
  assertEquals(result.valid, true);
});

Deno.test("commitMessageValidator - multiple messages: first failure short-circuits", () => {
  const context: SemanticValidatorContext = {
    stepId: "test-step",
    taskDescription: "Fix authentication bug in login module",
    commitMessages: [
      "fix: resolve authentication issue", // valid
      "update", // generic -> warning
      "feat: add login tests", // valid (would not be reached)
    ],
  };

  const result = commitMessageValidator.validate(context);
  assertEquals(result.valid, false);
  assertEquals(result.severity, "warning");
  assertEquals(
    result.message?.includes("update"),
    true,
    `Expected failure message to reference "update", got: ${result.message}`,
  );
});

Deno.test("commitMessageValidator - multiple messages: all valid", () => {
  const context: SemanticValidatorContext = {
    stepId: "test-step",
    taskDescription: "Fix authentication bug in login module",
    commitMessages: [
      "fix: resolve authentication issue",
      "test: add login integration tests",
    ],
  };

  const result = commitMessageValidator.validate(context);
  assertEquals(result.valid, true);
});

Deno.test("commitMessageValidator - skips empty messages in array", () => {
  const context: SemanticValidatorContext = {
    stepId: "test-step",
    taskDescription: "Fix authentication bug",
    commitMessages: ["", "  ", "fix: resolve authentication issue"],
  };

  const result = commitMessageValidator.validate(context);
  assertEquals(result.valid, true);
});

Deno.test("commitMessageValidator - metadata: name is 'commit-message'", () => {
  assertEquals(commitMessageValidator.name, "commit-message");
});
