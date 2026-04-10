/**
 * StepValidator Tests
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { ValidatorDefinition, ValidatorRegistry } from "./types.ts";
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
Deno.test("StepValidator - throws error for unknown validator name", async () => {
  // G4: Unknown validator names must fail fast, not silently pass
  // Source of truth: agents/validators/step/validator.ts validate()
  const registry: ValidatorRegistry = {
    validators: {},
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
  });

  await assertRejects(
    () => validator.validate([{ validator: "unknown-validator" }]),
    Error,
    "unknown-validator",
    'What: unknown validator name must throw | Where: StepValidator.validate() | How-to-fix: define "unknown-validator" in the registry "validators" section',
  );
});

// ---------------------------------------------------------------------------
// Registered validator tests
// ---------------------------------------------------------------------------

/**
 * Helper: build a command-type ValidatorDefinition from a shell command.
 */
function commandValidator(
  command: string,
  successWhen: ValidatorDefinition["successWhen"],
  failurePattern: string,
  extractParams: Record<string, string> = {},
): ValidatorDefinition {
  return {
    type: "command",
    command,
    successWhen,
    failurePattern,
    extractParams,
  };
}

Deno.test("StepValidator - accepts when registered command validator succeeds", async () => {
  const registry: ValidatorRegistry = {
    validators: {
      "always-pass": commandValidator(
        "echo ''",
        "empty",
        "should-not-appear",
      ),
    },
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
  });

  const result = await validator.validate([
    { validator: "always-pass" },
  ]);

  assertEquals(result.valid, true);
  assertEquals(result.pattern, undefined);
  assertEquals(result.error, undefined);
});

Deno.test("StepValidator - rejects when registered command validator fails", async () => {
  const registry: ValidatorRegistry = {
    validators: {
      "always-fail": commandValidator(
        "echo 'dirty-files'",
        "empty",
        "git-dirty",
        { stdout: "stdout" },
      ),
    },
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
  });

  const result = await validator.validate([
    { validator: "always-fail" },
  ]);

  assertEquals(result.valid, false);
  assertEquals(result.pattern, "git-dirty");
});

Deno.test("StepValidator - diagnosis: error message and params from failing validator", async () => {
  const registry: ValidatorRegistry = {
    validators: {
      "diag-validator": commandValidator(
        "echo 'M src/app.ts' >&2; exit 1",
        "exitCode:0",
        "compile-error",
        { errorOutput: "stderr" },
      ),
    },
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
  });

  const result = await validator.validate([
    { validator: "diag-validator" },
  ]);

  assertEquals(result.valid, false);
  assertEquals(result.pattern, "compile-error");

  // Error should contain stderr content
  assertStringIncludes(result.error!, "M src/app.ts");

  // Extracted params should include errorOutput from stderr
  assertStringIncludes(
    result.params!.errorOutput as string,
    "M src/app.ts",
  );
});

Deno.test("StepValidator - multiple validators: first failure short-circuits", async () => {
  const registry: ValidatorRegistry = {
    validators: {
      "pass-validator": commandValidator(
        "echo ''",
        "empty",
        "unused-pattern",
      ),
      "fail-validator": commandValidator(
        "echo 'uncommitted changes'",
        "empty",
        "dirty-workdir",
        { stdout: "stdout" },
      ),
      "never-reached": commandValidator(
        "echo 'should not run'",
        "empty",
        "never-pattern",
      ),
    },
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
  });

  const result = await validator.validate([
    { validator: "pass-validator" },
    { validator: "fail-validator" },
    { validator: "never-reached" },
  ]);

  assertEquals(result.valid, false);
  // Pattern must come from the second validator, not the third
  assertEquals(result.pattern, "dirty-workdir");
  assertStringIncludes(
    result.params!.stdout as string,
    "uncommitted changes",
  );
});

Deno.test("StepValidator - interpolates conditionParams into command string", async () => {
  // Source of truth: validator.ts runCommandValidator() replaces ${key} with conditionParams values
  const registry: ValidatorRegistry = {
    validators: {
      "parameterized-cmd": commandValidator(
        "echo ${message}",
        "contains:hello-from-params",
        "param-interpolation-failed",
      ),
    },
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
  });

  const result = await validator.validate([
    {
      validator: "parameterized-cmd",
      params: { message: "hello-from-params" },
    },
  ]);

  assertEquals(
    result.valid,
    true,
    "What: echo with interpolated param must produce output containing the param value | Where: StepValidator.validate() with conditionParams | How-to-fix: check runCommandValidator param interpolation in validator.ts",
  );
});

Deno.test("StepValidator - multiple validators: all pass yields valid result", async () => {
  const registry: ValidatorRegistry = {
    validators: {
      "pass-a": commandValidator("echo ''", "empty", "unused-a"),
      "pass-b": commandValidator("true", "exitCode:0", "unused-b"),
    },
  };

  const validator = new StepValidator(registry, {
    workingDir: Deno.cwd(),
    logger: mockLogger,
  });

  const result = await validator.validate([
    { validator: "pass-a" },
    { validator: "pass-b" },
  ]);

  assertEquals(result.valid, true);
});
