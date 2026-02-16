/**
 * Verify factory completion handler creation paths.
 *
 * Tests that createRegistryCompletionHandler can produce a working
 * CompletionHandler for each registered completionType without LLM calls.
 *
 * This catches regressions where a handler registration becomes a
 * throw-only stub (as happened with externalState during V2 migration).
 */

import { resolve } from "@std/path";
import type { AgentDefinition } from "../../../agents/src_common/types.ts";
import { createRegistryCompletionHandler } from "../../../agents/completion/factory.ts";
import { ExternalStateCompletionAdapter } from "../../../agents/completion/external-state-adapter.ts";

// deno-lint-ignore no-console
const log = console.log;
// deno-lint-ignore no-console
const logErr = console.error;

const repoRoot = resolve(import.meta.dirname ?? ".", "../../../");

interface TestCase {
  name: string;
  completionType: string;
  completionConfig: Record<string, unknown>;
  args: Record<string, unknown>;
  expectedType: string;
  expectedClass?: string;
}

const testCases: TestCase[] = [
  {
    name: "externalState with --issue",
    completionType: "externalState",
    completionConfig: { maxIterations: 10 },
    args: { issue: 123, repository: "owner/repo" },
    expectedType: "externalState",
    expectedClass: "ExternalStateCompletionAdapter",
  },
  {
    name: "iterationBudget",
    completionType: "iterationBudget",
    completionConfig: { maxIterations: 5 },
    args: {},
    expectedType: "iterationBudget",
  },
  {
    name: "keywordSignal",
    completionType: "keywordSignal",
    completionConfig: { completionKeyword: "DONE" },
    args: {},
    expectedType: "keywordSignal",
  },
  {
    name: "checkBudget",
    completionType: "checkBudget",
    completionConfig: { maxChecks: 10 },
    args: {},
    expectedType: "checkBudget",
  },
  {
    name: "structuredSignal",
    completionType: "structuredSignal",
    completionConfig: { signalType: "test-signal" },
    args: {},
    expectedType: "structuredSignal",
  },
];

const errorCases: {
  name: string;
  completionType: string;
  args: Record<string, unknown>;
  completionConfig: Record<string, unknown>;
  expectedError: string;
}[] = [
  {
    name: "externalState without --issue",
    completionType: "externalState",
    completionConfig: { maxIterations: 10 },
    args: {},
    expectedError: "requires --issue",
  },
];

function createTestDefinition(
  completionType: string,
  completionConfig: Record<string, unknown>,
): AgentDefinition {
  return {
    version: "1.0.0",
    name: "test-agent",
    displayName: "Test Agent",
    description: "Factory path verification test agent",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "prompts/system.md",
        prompts: { registry: "steps_registry.json", fallbackDir: "prompts/" },
      },
      completion: {
        type: completionType as AgentDefinition["runner"]["completion"]["type"],
        config: completionConfig,
      },
      boundaries: {
        allowedTools: ["Read"],
        permissionMode: "default",
        github: {
          enabled: true,
          labels: {},
          defaultClosureAction: "label-only",
        },
      },
      execution: {},
      telemetry: {
        logging: { directory: "/tmp/claude/test-logs", format: "jsonl" },
      },
    },
  } as AgentDefinition;
}

let passed = 0;
let failed = 0;

log("=== Verify Factory Completion Paths ===\n");

// Test successful handler creation
log("--- Handler Creation Tests ---");
for (const tc of testCases) {
  try {
    const def = createTestDefinition(tc.completionType, tc.completionConfig);
    const agentDir = resolve(repoRoot, ".agent/iterator");
    // deno-lint-ignore no-await-in-loop
    const handler = await createRegistryCompletionHandler(
      def,
      tc.args,
      agentDir,
    );

    if (handler.type !== tc.expectedType) {
      logErr(
        `FAIL: ${tc.name} - expected type "${tc.expectedType}", got "${handler.type}"`,
      );
      failed++;
      continue;
    }

    if (tc.expectedClass === "ExternalStateCompletionAdapter") {
      if (!(handler instanceof ExternalStateCompletionAdapter)) {
        logErr(
          `FAIL: ${tc.name} - expected ExternalStateCompletionAdapter instance`,
        );
        failed++;
        continue;
      }
    }

    // Verify CompletionHandler interface methods exist
    const methods = [
      "buildInitialPrompt",
      "buildContinuationPrompt",
      "buildCompletionCriteria",
      "isComplete",
      "getCompletionDescription",
    ];
    const handlerRecord = handler as unknown as Record<string, unknown>;
    const missing = methods.filter((m) =>
      typeof handlerRecord[m] !== "function"
    );
    if (missing.length > 0) {
      logErr(
        `FAIL: ${tc.name} - missing CompletionHandler methods: ${
          missing.join(", ")
        }`,
      );
      failed++;
      continue;
    }

    log(
      `  PASS: ${tc.name} -> type="${handler.type}", class=${handler.constructor.name}`,
    );
    passed++;
  } catch (error) {
    logErr(`FAIL: ${tc.name} - ${(error as Error).message}`);
    failed++;
  }
}

// Test expected error cases
log("\n--- Error Handling Tests ---");
for (const tc of errorCases) {
  try {
    const def = createTestDefinition(tc.completionType, tc.completionConfig);
    const agentDir = resolve(repoRoot, ".agent/iterator");
    // deno-lint-ignore no-await-in-loop
    await createRegistryCompletionHandler(def, tc.args, agentDir);
    logErr(`FAIL: ${tc.name} - expected error but succeeded`);
    failed++;
  } catch (error) {
    const msg = (error as Error).message;
    if (msg.includes(tc.expectedError)) {
      log(`  PASS: ${tc.name} -> throws "${tc.expectedError}"`);
      passed++;
    } else {
      logErr(
        `FAIL: ${tc.name} - expected "${tc.expectedError}" in error, got "${msg}"`,
      );
      failed++;
    }
  }
}

// Summary
log(`\nSummary: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  Deno.exit(1);
}
