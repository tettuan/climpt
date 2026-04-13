/**
 * Tests for subprocess-runner.ts (Phase 0-b + 0-c).
 *
 * Covers template substitution, stdout JSON parsing, stderr forwarding,
 * and timeout handling. Subprocess spawn is stubbed via CommandRunner so
 * these tests do not invoke Deno.Command directly.
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { StepSubprocessRunner } from "../common/step-registry/types.ts";
import {
  type CommandRunner,
  DEFAULT_SUBPROCESS_TIMEOUT_MS,
  parseStructuredStdout,
  runSubprocessRunner,
  type SubprocessRunnerLogger,
  substituteContextTemplates,
} from "./subprocess-runner.ts";

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

class RecordingLogger implements SubprocessRunnerLogger {
  readonly entries: Array<
    { level: string; message: string; data?: Record<string, unknown> }
  > = [];
  info(message: string, data?: Record<string, unknown>): void {
    this.entries.push({ level: "info", message, data });
  }
  warn(message: string, data?: Record<string, unknown>): void {
    this.entries.push({ level: "warn", message, data });
  }
  debug(message: string, data?: Record<string, unknown>): void {
    this.entries.push({ level: "debug", message, data });
  }
  error(message: string, data?: Record<string, unknown>): void {
    this.entries.push({ level: "error", message, data });
  }
  has(level: string, predicate: (msg: string) => boolean): boolean {
    return this.entries.some((e) => e.level === level && predicate(e.message));
  }
}

function stubRunner(
  result: {
    code: number;
    stdout: string;
    stderr: string;
  },
  opts: { capturedArgs?: string[][] } = {},
): CommandRunner {
  const encoder = new TextEncoder();
  return {
    // deno-lint-ignore require-await
    async run(_command, args, _options) {
      opts.capturedArgs?.push([...args]);
      return {
        code: result.code,
        stdout: encoder.encode(result.stdout),
        stderr: encoder.encode(result.stderr),
      };
    },
  };
}

// -----------------------------------------------------------------------------
// substituteContextTemplates
// -----------------------------------------------------------------------------

Deno.test("substituteContextTemplates - replaces ${context.key} with value", () => {
  const args = ["--pr", "${context.prNumber}", "--path", "${context.path}"];
  const result = substituteContextTemplates(args, {
    prNumber: 123,
    path: "tmp/climpt/orchestrator/emits/123.json",
  });
  assertEquals(result, [
    "--pr",
    "123",
    "--path",
    "tmp/climpt/orchestrator/emits/123.json",
  ]);
});

Deno.test("substituteContextTemplates - preserves args without templates", () => {
  const args = ["run", "--allow-read", "script.ts"];
  const result = substituteContextTemplates(args, { foo: "bar" });
  assertEquals(result, ["run", "--allow-read", "script.ts"]);
});

Deno.test("substituteContextTemplates - throws on unresolved template (missing key)", () => {
  assertThrows(
    () => substituteContextTemplates(["${context.unknown}"], { other: 1 }),
    Error,
    "Unresolved template: ${context.unknown}",
  );
});

Deno.test("substituteContextTemplates - throws on null/undefined value", () => {
  assertThrows(
    () => substituteContextTemplates(["${context.k}"], { k: null }),
    Error,
    "Unresolved template: ${context.k}",
  );
  assertThrows(
    () => substituteContextTemplates(["${context.k}"], { k: undefined }),
    Error,
    "Unresolved template: ${context.k}",
  );
});

Deno.test("substituteContextTemplates - String() casts non-string values", () => {
  const result = substituteContextTemplates(
    ["${context.n}", "${context.b}"],
    { n: 42, b: true },
  );
  assertEquals(result, ["42", "true"]);
});

// -----------------------------------------------------------------------------
// parseStructuredStdout
// -----------------------------------------------------------------------------

Deno.test("parseStructuredStdout - parses JSON object", () => {
  const result = parseStructuredStdout('{"ok":true,"decision":"merged"}');
  assertEquals(result, { ok: true, decision: "merged" });
});

Deno.test("parseStructuredStdout - wraps non-JSON as { raw }", () => {
  const result = parseStructuredStdout("not json at all");
  assertEquals(result, { raw: "not json at all" });
});

Deno.test("parseStructuredStdout - wraps empty string as { raw }", () => {
  const result = parseStructuredStdout("");
  assertEquals(result, { raw: "" });
});

Deno.test("parseStructuredStdout - non-object JSON exposes parsed under parsed field", () => {
  const result = parseStructuredStdout("[1,2,3]");
  assertEquals(result.raw, "[1,2,3]");
  assertEquals(result.parsed, [1, 2, 3]);
});

// -----------------------------------------------------------------------------
// runSubprocessRunner
// -----------------------------------------------------------------------------

Deno.test("runSubprocessRunner - substitutes args and spawns via runner", async () => {
  const capturedArgs: string[][] = [];
  const runner = stubRunner(
    { code: 0, stdout: '{"ok":true}', stderr: "" },
    { capturedArgs },
  );
  const logger = new RecordingLogger();
  const spec: StepSubprocessRunner = {
    command: "deno",
    args: ["run", "script.ts", "--pr", "${context.prNumber}"],
  };

  const result = await runSubprocessRunner(
    spec,
    { prNumber: 42 },
    logger,
    { commandRunner: runner },
  );

  assertEquals(capturedArgs.length, 1);
  assertEquals(capturedArgs[0], ["run", "script.ts", "--pr", "42"]);
  assertEquals(result.exitCode, 0);
  assertEquals(result.structuredOutput, { ok: true });
  assertEquals(result.stdout, '{"ok":true}');
  assertEquals(result.timedOut, false);
});

Deno.test("runSubprocessRunner - throws when template cannot resolve", async () => {
  const runner = stubRunner({ code: 0, stdout: "", stderr: "" });
  const logger = new RecordingLogger();
  const spec: StepSubprocessRunner = {
    command: "deno",
    args: ["${context.missing}"],
  };

  await assertRejects(
    () => runSubprocessRunner(spec, {}, logger, { commandRunner: runner }),
    Error,
    "Unresolved template: ${context.missing}",
  );
});

Deno.test("runSubprocessRunner - JSON stdout becomes structuredOutput", async () => {
  const runner = stubRunner({
    code: 0,
    stdout: '{"decision":{"kind":"merged"},"pr":123}',
    stderr: "",
  });
  const logger = new RecordingLogger();
  const spec: StepSubprocessRunner = { command: "echo", args: ["ignored"] };

  const result = await runSubprocessRunner(
    spec,
    {},
    logger,
    { commandRunner: runner },
  );

  assertEquals(result.structuredOutput, {
    decision: { kind: "merged" },
    pr: 123,
  });
});

Deno.test("runSubprocessRunner - non-zero exit logs error and retains stdout", async () => {
  const runner = stubRunner({
    code: 1,
    stdout: '{"ok":false}',
    stderr: "boom",
  });
  const logger = new RecordingLogger();
  const spec: StepSubprocessRunner = { command: "fail", args: [] };

  const result = await runSubprocessRunner(
    spec,
    {},
    logger,
    { commandRunner: runner },
  );

  assertEquals(result.exitCode, 1);
  assertEquals(result.structuredOutput, { ok: false });
  assertEquals(result.stderr, "boom");
  assertEquals(
    logger.has("error", (m) => m.includes("Non-zero exit")),
    true,
    "error log entry for non-zero exit",
  );
  assertEquals(
    logger.has("warn", (m) => m.includes("stderr")),
    true,
    "stderr forwarded at WARN level",
  );
});

Deno.test("runSubprocessRunner - timeout propagates as error", async () => {
  // Simulate a hung process by awaiting the signal; it aborts after 10ms.
  const runner: CommandRunner = {
    run(_cmd, _args, { signal }) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(signal.reason ?? new Error("aborted"));
        });
      });
    },
  };
  const logger = new RecordingLogger();
  const spec: StepSubprocessRunner = {
    command: "sleep",
    args: [],
    timeout: 10,
  };

  await assertRejects(
    () => runSubprocessRunner(spec, {}, logger, { commandRunner: runner }),
    Error,
    "timed out",
  );
  assertEquals(
    logger.has("warn", (m) => m.includes("Timeout")),
    true,
    "timeout logs WARN",
  );
});

Deno.test("runSubprocessRunner - defaults timeout when not set", async () => {
  // We cannot wait DEFAULT_SUBPROCESS_TIMEOUT_MS; just verify the default exists.
  assertEquals(DEFAULT_SUBPROCESS_TIMEOUT_MS, 30_000);
  const runner = stubRunner({ code: 0, stdout: "", stderr: "" });
  const logger = new RecordingLogger();
  const spec: StepSubprocessRunner = { command: "true", args: [] };

  const result = await runSubprocessRunner(
    spec,
    {},
    logger,
    { commandRunner: runner },
  );
  assertEquals(result.exitCode, 0);
});
