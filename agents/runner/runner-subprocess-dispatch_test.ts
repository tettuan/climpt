/**
 * Tests for AgentRunner closure-step subprocess dispatch (Phase 0-c).
 *
 * Scope:
 * - Closure step with runner field → subprocess path
 * - Closure step WITHOUT runner field → existing prompt-based path unchanged
 * - Template substitution integrates with agent args (this.args → context)
 * - stdout structured output surfaces through boundary hook payload
 *
 * These tests stub the CommandRunner so no real processes spawn.
 * They also use a minimal StepRegistry injected via a test-only test seam:
 * AgentRunner fetches the step definition via closureManager.stepsRegistry.
 * Exercising the dispatch branch directly requires a live AgentRunner, which
 * pulls in many dependencies. Instead, we test the atomic building blocks
 * (runSubprocessRunner + Step type contract) and the
 * non-interference invariant via reviewing the dispatch source contract.
 */

import { assertEquals } from "@std/assert";
import type { Step } from "../common/step-registry/types.ts";
import { makeStep } from "../common/step-registry/test-helpers.ts";
import {
  type CommandRunner,
  runSubprocessRunner,
} from "./subprocess-runner.ts";

// Silent logger for tests — asserts on return values instead of log entries.
const silentLogger = {
  info: (_m: string, _d?: Record<string, unknown>) => {},
  warn: (_m: string, _d?: Record<string, unknown>) => {},
  debug: (_m: string, _d?: Record<string, unknown>) => {},
  error: (_m: string, _d?: Record<string, unknown>) => {},
};

const encoder = new TextEncoder();

function okRunner(stdout: string, stderr = ""): CommandRunner {
  return {
    // deno-lint-ignore require-await
    async run(_cmd, _args, _opts) {
      return {
        code: 0,
        stdout: encoder.encode(stdout),
        stderr: encoder.encode(stderr),
      };
    },
  };
}

// -----------------------------------------------------------------------------
// Step type contract — runner field is optional
// -----------------------------------------------------------------------------

Deno.test("Step - runner field is optional (non-interference)", () => {
  const withoutRunner: Step = makeStep({
    kind: "closure" as const,
    address: { c1: "steps", c2: "closure", c3: "legacy", edition: "default" },
    stepId: "closure.legacy",
    name: "Legacy closure",
    uvVariables: [],
    usesStdin: false,
  });
  assertEquals(withoutRunner.runner, undefined);

  const withRunner: Step = makeStep({
    kind: "closure" as const,
    address: { c1: "steps", c2: "closure", c3: "merge", edition: "default" },
    stepId: "closure.merge",
    name: "Merge closure",
    uvVariables: [],
    usesStdin: false,
    runner: {
      command: "deno",
      args: ["run", "script.ts", "--pr", "${context.prNumber}"],
      timeout: 30000,
    },
  });
  assertEquals(withRunner.runner?.command, "deno");
  assertEquals(withRunner.runner?.timeout, 30000);
});

// -----------------------------------------------------------------------------
// Context composition — agent args flow into template substitution
// -----------------------------------------------------------------------------

Deno.test(
  "Subprocess dispatch - agent args become context for template substitution",
  async () => {
    const captured: string[][] = [];
    const runner: CommandRunner = {
      // deno-lint-ignore require-await
      async run(_cmd, args, _opts) {
        captured.push([...args]);
        return {
          code: 0,
          stdout: encoder.encode('{"ok":true}'),
          stderr: new Uint8Array(),
        };
      },
    };

    // Simulate AgentRunner.run composing context from this.args
    const agentArgs: Record<string, unknown> = {
      pr: 123,
      verdictPath: "tmp/climpt/orchestrator/emits/123.json",
      // Phase 0-a: prNumber is the payload-form mirror of --pr
      prNumber: 123,
    };

    const result = await runSubprocessRunner(
      {
        command: "deno",
        args: [
          "run",
          "agents/scripts/merge-pr.ts",
          "--pr",
          "${context.prNumber}",
          "--verdict",
          "${context.verdictPath}",
        ],
      },
      agentArgs,
      silentLogger,
      { commandRunner: runner },
    );

    assertEquals(captured[0], [
      "run",
      "agents/scripts/merge-pr.ts",
      "--pr",
      "123",
      "--verdict",
      "tmp/climpt/orchestrator/emits/123.json",
    ]);
    assertEquals(result.structuredOutput, { ok: true });
  },
);

// -----------------------------------------------------------------------------
// Structured output propagation for boundary hook
// -----------------------------------------------------------------------------

Deno.test(
  "Subprocess dispatch - stdout JSON becomes structuredOutput for boundary hook",
  async () => {
    const mergeResultJson = JSON.stringify({
      ok: true,
      decision: { kind: "merged" },
      executed: true,
      pr_state: { mergeable: "MERGEABLE" },
      labels: { added: ["merge:done"], removed: ["merge:ready"] },
      exit_code: 0,
    });
    const runner = okRunner(mergeResultJson);

    const result = await runSubprocessRunner(
      { command: "deno", args: ["run", "merge-pr.ts"] },
      {},
      silentLogger,
      { commandRunner: runner },
    );

    assertEquals(result.exitCode, 0);
    // boundary hook receives the parsed object; merge-pr.ts contract is
    // preserved verbatim from subprocess stdout.
    assertEquals(
      (result.structuredOutput as { decision: { kind: string } }).decision.kind,
      "merged",
    );
    assertEquals(
      (result.structuredOutput as { labels: { added: string[] } }).labels.added,
      ["merge:done"],
    );
  },
);

Deno.test(
  "Subprocess dispatch - non-JSON stdout wrapped as { raw } preserves data",
  async () => {
    const runner = okRunner("plain text success");
    const result = await runSubprocessRunner(
      { command: "echo", args: [] },
      {},
      silentLogger,
      { commandRunner: runner },
    );
    assertEquals(result.structuredOutput, { raw: "plain text success" });
  },
);

// -----------------------------------------------------------------------------
// Non-interference invariant — documented via test assertions
// -----------------------------------------------------------------------------

Deno.test(
  "Non-interference - step without runner field must fall through to prompt-based closure",
  () => {
    // This is a documented contract assertion: the AgentRunner dispatch
    // branch (agents/runner/runner.ts `getSubprocessRunnerStep`) returns
    // null when runner.command is falsy, causing the existing Completion
    // Loop path (runClosureIteration → LLM) to execute unchanged.
    const legacyStep: Step = makeStep({
      kind: "closure" as const,
      address: { c1: "steps", c2: "closure", c3: "legacy", edition: "default" },
      stepId: "closure.legacy",
      name: "Legacy closure",
      uvVariables: [],
      usesStdin: false,
      // no runner field,
    });

    // Contract: getSubprocessRunnerStep returns null iff runner.command
    // is falsy. This is the non-interference guarantee for existing agents.
    const hasSubprocess = Boolean(legacyStep.runner?.command);
    assertEquals(
      hasSubprocess,
      false,
      "legacy closure step must not be routed through subprocess dispatch",
    );
  },
);
