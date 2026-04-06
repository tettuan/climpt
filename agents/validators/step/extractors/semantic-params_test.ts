/**
 * Semantic Params Tests
 *
 * Tests for semantic context builders attached to extractors.
 * Validates that each builder produces correct summary, severity,
 * relatedFiles, rootCause, and suggestedAction.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildGitStatusSemantic } from "./git-status.ts";
import { buildTestOutputSemantic } from "./test-output.ts";
import { buildTypeErrorsSemantic } from "./type-errors.ts";
import type { SemanticParams } from "../types.ts";

// ============================================================================
// Git Status Semantic
// ============================================================================

Deno.test("buildGitStatusSemantic - classifies modified files as error severity", () => {
  const stdout = " M src/app.ts\n M src/utils.ts\n";
  const raw = { changedFiles: ["src/app.ts", "src/utils.ts"] };

  const result: SemanticParams = buildGitStatusSemantic(stdout, raw);

  assertEquals(result.severity, "error");
  assertStringIncludes(result.summary, "2 files modified");
  assertEquals(result.relatedFiles.length > 0, true);
  assertEquals(result.relatedFiles.includes("src/app.ts"), true);
  assertEquals(result.relatedFiles.includes("src/utils.ts"), true);
  assertEquals(result.suggestedAction, "Stage and commit the modified files");
  assertEquals(result.raw, raw);
});

Deno.test("buildGitStatusSemantic - classifies untracked-only as warning severity", () => {
  const stdout = "?? tmp/debug.log\n?? tmp/cache.json\n";
  const raw = { untrackedFiles: ["tmp/debug.log", "tmp/cache.json"] };

  const result = buildGitStatusSemantic(stdout, raw);

  assertEquals(result.severity, "warning");
  assertStringIncludes(result.summary, "2 files untracked");
  // Untracked files should not appear in relatedFiles
  assertEquals(result.relatedFiles.length, 0);
  assertEquals(result.suggestedAction, "Clean untracked files");
});

Deno.test("buildGitStatusSemantic - includes both modified and untracked in summary", () => {
  const stdout = " M src/app.ts\n?? tmp/debug.log\n";
  const raw = {};

  const result = buildGitStatusSemantic(stdout, raw);

  assertEquals(result.severity, "error");
  assertStringIncludes(result.summary, "1 file modified");
  assertStringIncludes(result.summary, "1 file untracked");
  // Only modified files in relatedFiles, not untracked
  assertEquals(result.relatedFiles, ["src/app.ts"]);
});

Deno.test("buildGitStatusSemantic - handles staged files in severity and relatedFiles", () => {
  const stdout = "M  staged-file.ts\n";
  const raw = {};

  const result = buildGitStatusSemantic(stdout, raw);

  assertEquals(result.severity, "error");
  assertEquals(result.relatedFiles.includes("staged-file.ts"), true);
});

Deno.test("buildGitStatusSemantic - handles empty output", () => {
  const stdout = "";
  const raw = {};

  const result = buildGitStatusSemantic(stdout, raw);

  assertEquals(result.severity, "warning");
  assertEquals(result.summary, "No changes detected");
  assertEquals(result.relatedFiles, []);
});

Deno.test("buildGitStatusSemantic - preserves raw params", () => {
  const stdout = " M file.ts\n";
  const raw = { changedFiles: ["file.ts"], custom: "value" };

  const result = buildGitStatusSemantic(stdout, raw);

  assertEquals(result.raw, raw);
  assertEquals(result.raw.custom, "value");
});

// ============================================================================
// Test Output Semantic
// ============================================================================

Deno.test("buildTestOutputSemantic - extracts failed test count", () => {
  const stdout = `
running 5 tests
test-a ... ok (1ms)
test-b ... ok (1ms)
test-c ... FAILED (2ms)
FAILED | test-c

FAILURES

test-c
  AssertionError: expected 1, got 2

5 passed | 1 failed
`;
  const stderr = "";
  const raw = {};

  const result = buildTestOutputSemantic(stdout, stderr, raw);

  assertEquals(result.severity, "error");
  assertStringIncludes(result.summary, "failed");
  assertEquals(result.suggestedAction, "Fix the failing test assertions");
});

Deno.test("buildTestOutputSemantic - includes file paths in relatedFiles", () => {
  const stdout = `
module.test.ts ... FAILED
FAILED | module.test.ts
`;
  const stderr = "";
  const raw = {};

  const result = buildTestOutputSemantic(stdout, stderr, raw);

  assertEquals(result.relatedFiles.length > 0, true);
});

Deno.test("buildTestOutputSemantic - uses first failure error as rootCause", () => {
  const stdout = `
FAILED | test-alpha
test-alpha
  Expected true, got false

FAILED | test-beta
test-beta
  Timeout exceeded
`;
  const stderr = "";
  const raw = {};

  const result = buildTestOutputSemantic(stdout, stderr, raw);

  assertEquals(typeof result.rootCause, "string");
  assertEquals(
    result.rootCause!.length > 0,
    true,
    "rootCause should contain the first failure's error message",
  );
});

Deno.test("buildTestOutputSemantic - handles no failures gracefully", () => {
  const stdout = "running 3 tests\nall passed\n";
  const stderr = "";
  const raw = {};

  const result = buildTestOutputSemantic(stdout, stderr, raw);

  assertEquals(result.severity, "error");
  assertStringIncludes(result.summary, "0 test");
  assertEquals(result.relatedFiles, []);
  assertEquals(result.rootCause, undefined);
});

Deno.test("buildTestOutputSemantic - preserves raw params", () => {
  const stdout = "";
  const stderr = "";
  const raw = { failedTests: [], errorOutput: "some error" };

  const result = buildTestOutputSemantic(stdout, stderr, raw);

  assertEquals(result.raw, raw);
});

// ============================================================================
// Type Errors Semantic
// ============================================================================

Deno.test("buildTypeErrorsSemantic - counts errors and files", () => {
  const stderr =
    `error: TS2345 [ERROR]: Argument of type 'string' is not assignable to parameter of type 'number'.
  at src/foo.ts:10:5
error: TS2345 [ERROR]: Argument of type 'string' is not assignable to parameter of type 'number'.
  at src/bar.ts:20:10
error: TS7006 [ERROR]: Parameter 'x' implicitly has an 'any' type.
  at src/foo.ts:15:3
`;
  const raw = {};

  const result = buildTypeErrorsSemantic(stderr, raw);

  assertEquals(result.severity, "error");
  assertStringIncludes(result.summary, "3 type errors");
  assertStringIncludes(result.summary, "2 files");
  assertEquals(result.relatedFiles.includes("src/foo.ts"), true);
  assertEquals(result.relatedFiles.includes("src/bar.ts"), true);
  assertEquals(
    result.suggestedAction,
    "Fix type mismatches in the listed files",
  );
});

Deno.test("buildTypeErrorsSemantic - identifies most common error as rootCause", () => {
  const stderr =
    `error: TS2345 [ERROR]: Argument of type 'string' is not assignable to parameter of type 'number'.
  at src/a.ts:1:1
error: TS2345 [ERROR]: Argument of type 'string' is not assignable to parameter of type 'number'.
  at src/b.ts:2:1
error: TS7006 [ERROR]: Parameter 'x' implicitly has an 'any' type.
  at src/c.ts:3:1
`;
  const raw = {};

  const result = buildTypeErrorsSemantic(stderr, raw);

  assertEquals(typeof result.rootCause, "string");
  // The most common error (TS2345, appearing twice) should be the root cause
  assertStringIncludes(
    result.rootCause!,
    "Argument of type 'string' is not assignable",
  );
});

Deno.test("buildTypeErrorsSemantic - handles no errors", () => {
  const stderr = "";
  const raw = {};

  const result = buildTypeErrorsSemantic(stderr, raw);

  assertEquals(result.severity, "error");
  assertEquals(result.summary, "No type errors detected");
  assertEquals(result.relatedFiles, []);
  assertEquals(result.rootCause, undefined);
});

Deno.test("buildTypeErrorsSemantic - handles single error in single file", () => {
  const stderr = `error: TS2304 [ERROR]: Cannot find name 'foo'.
  at src/main.ts:5:10
`;
  const raw = {};

  const result = buildTypeErrorsSemantic(stderr, raw);

  assertStringIncludes(result.summary, "1 type error");
  assertStringIncludes(result.summary, "1 file");
  assertEquals(result.relatedFiles, ["src/main.ts"]);
  assertStringIncludes(result.rootCause!, "Cannot find name 'foo'");
});

Deno.test("buildTypeErrorsSemantic - preserves raw params", () => {
  const stderr = "";
  const raw = { errors: [], files: ["a.ts"] };

  const result = buildTypeErrorsSemantic(stderr, raw);

  assertEquals(result.raw, raw);
});

// ============================================================================
// ParamExtractor.extractSemantic integration
// ============================================================================

Deno.test("ParamExtractor.extractSemantic - returns SemanticParams for git extractors", async () => {
  const { ParamExtractor } = await import("../param-extractors.ts");
  const extractor = new ParamExtractor();

  const config = { changedFiles: "parseChangedFiles" as const };
  const result = {
    success: false,
    exitCode: 1,
    stdout: " M src/app.ts\n?? tmp/log\n",
    stderr: "",
  };
  const rawParams = extractor.extract(config, result);
  const semantic = extractor.extractSemantic(config, result, rawParams);

  assertEquals(semantic !== undefined, true);
  assertEquals(semantic!.severity, "error");
  assertStringIncludes(semantic!.summary, "1 file modified");
});

Deno.test("ParamExtractor.extractSemantic - returns SemanticParams for test extractors", async () => {
  const { ParamExtractor } = await import("../param-extractors.ts");
  const extractor = new ParamExtractor();

  const config = { failedTests: "parseTestOutput" as const };
  const stdout = "FAILED | some-test\nsome-test\n  error msg\n";
  const result = {
    success: false,
    exitCode: 1,
    stdout,
    stderr: "",
  };
  const rawParams = extractor.extract(config, result);
  const semantic = extractor.extractSemantic(config, result, rawParams);

  assertEquals(semantic !== undefined, true);
  assertEquals(semantic!.severity, "error");
  assertStringIncludes(semantic!.summary, "failed");
});

Deno.test("ParamExtractor.extractSemantic - returns SemanticParams for type error extractors", async () => {
  const { ParamExtractor } = await import("../param-extractors.ts");
  const extractor = new ParamExtractor();

  const config = { errors: "parseTypeErrors" as const };
  const stderr = `error: TS2345 [ERROR]: Bad type
  at src/x.ts:1:1
`;
  const result = {
    success: false,
    exitCode: 1,
    stdout: "",
    stderr,
  };
  const rawParams = extractor.extract(config, result);
  const semantic = extractor.extractSemantic(config, result, rawParams);

  assertEquals(semantic !== undefined, true);
  assertEquals(semantic!.severity, "error");
  assertStringIncludes(semantic!.summary, "1 type error");
  assertEquals(semantic!.relatedFiles, ["src/x.ts"]);
});

Deno.test("ParamExtractor.extractSemantic - returns undefined for non-semantic extractors", async () => {
  const { ParamExtractor } = await import("../param-extractors.ts");
  const extractor = new ParamExtractor();

  const config = { output: "stdout" as const };
  const result = {
    success: false,
    exitCode: 1,
    stdout: "some output",
    stderr: "",
  };
  const rawParams = extractor.extract(config, result);
  const semantic = extractor.extractSemantic(config, result, rawParams);

  assertEquals(semantic, undefined);
});

// ============================================================================
// ValidatorRunResult includes semanticParams
// ============================================================================

Deno.test("ValidatorRunResult type accepts semanticParams field", () => {
  // Compile-time verification: this test passes if the type is correct
  const result: import("../types.ts").ValidatorRunResult = {
    valid: false,
    params: { changedFiles: ["a.ts"] },
    semanticParams: {
      raw: { changedFiles: ["a.ts"] },
      summary: "1 file modified",
      severity: "error",
      relatedFiles: ["a.ts"],
      suggestedAction: "Stage and commit the modified files",
    },
    error: "git status shows changes",
  };

  assertEquals(result.valid, false);
  assertEquals(result.semanticParams?.summary, "1 file modified");
  assertEquals(result.semanticParams?.severity, "error");
});

Deno.test("ValidatorRunResult works without semanticParams", () => {
  // Backward compatibility: semanticParams is optional
  const result: import("../types.ts").ValidatorRunResult = {
    valid: true,
  };

  assertEquals(result.valid, true);
  assertEquals(result.semanticParams, undefined);
});
