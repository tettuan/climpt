/**
 * Verify factory verdict handler creation paths.
 *
 * Tests that createRegistryVerdictHandler can produce a working
 * VerdictHandler for each registered verdictType without LLM calls.
 *
 * This catches regressions where a handler registration becomes a
 * throw-only stub (as happened with poll:state during V2 migration).
 */

import { resolve } from "@std/path";
import type { AgentDefinition } from "../../../agents/src_common/types.ts";
import { createRegistryVerdictHandler } from "../../../agents/verdict/factory.ts";
import { ExternalStateVerdictAdapter } from "../../../agents/verdict/external-state-adapter.ts";
import { ConfigError } from "../../../agents/shared/errors/config-errors.ts";

// deno-lint-ignore no-console
const log = console.log;
// deno-lint-ignore no-console
const logErr = console.error;

const repoRoot = resolve(import.meta.dirname ?? ".", "../../../");

const fixturesDir = resolve(
  import.meta.dirname ?? ".",
  "../fixtures",
);

interface TestCase {
  name: string;
  verdictType: string;
  verdictConfig: Record<string, unknown>;
  args: Record<string, unknown>;
  expectedType: string;
  expectedClass?: string;
  agentDirOverride?: string;
}

const testCases: TestCase[] = [
  {
    name: "poll:state with --issue",
    verdictType: "poll:state",
    verdictConfig: { maxIterations: 10 },
    args: { issue: 123, repository: "owner/repo" },
    expectedType: "poll:state",
    expectedClass: "ExternalStateVerdictAdapter",
  },
  {
    name: "count:iteration",
    verdictType: "count:iteration",
    verdictConfig: { maxIterations: 5 },
    args: {},
    expectedType: "count:iteration",
  },
  {
    name: "detect:keyword",
    verdictType: "detect:keyword",
    verdictConfig: { verdictKeyword: "DONE" },
    args: {},
    expectedType: "detect:keyword",
  },
  {
    name: "count:check",
    verdictType: "count:check",
    verdictConfig: { maxChecks: 10 },
    args: {},
    expectedType: "count:check",
  },
  {
    name: "detect:structured",
    verdictType: "detect:structured",
    verdictConfig: { signalType: "test-signal" },
    args: {},
    expectedType: "detect:structured",
  },
  {
    name: "detect:graph (success)",
    verdictType: "detect:graph",
    verdictConfig: {
      registryPath: resolve(fixturesDir, "steps_registry.json"),
    },
    args: {},
    expectedType: "detect:graph",
    agentDirOverride: fixturesDir,
  },
  {
    name: "meta:composite (and)",
    verdictType: "meta:composite",
    verdictConfig: {
      operator: "and",
      conditions: [
        { type: "count:iteration", config: { maxIterations: 3 } },
        { type: "detect:keyword", config: { verdictKeyword: "DONE" } },
      ],
    },
    args: {},
    expectedType: "meta:composite",
  },
  {
    name: "meta:custom",
    verdictType: "meta:custom",
    verdictConfig: { handlerPath: "custom-handler.ts" },
    args: {},
    expectedType: "meta:custom",
    agentDirOverride: fixturesDir,
  },
];

const errorCases: {
  name: string;
  verdictType: string;
  args: Record<string, unknown>;
  verdictConfig: Record<string, unknown>;
  expectedError: string;
  agentDirOverride?: string;
}[] = [
  {
    name: "poll:state without --issue",
    verdictType: "poll:state",
    verdictConfig: { maxIterations: 10 },
    args: {},
    expectedError: 'requires "issue" parameter',
  },
  {
    name: "detect:graph with missing registry",
    verdictType: "detect:graph",
    verdictConfig: {},
    args: {},
    expectedError: "AC-VERDICT-011",
    agentDirOverride: resolve(repoRoot, ".agent/__nonexistent_agent__"),
  },
];

function createTestDefinition(
  verdictType: string,
  verdictConfig: Record<string, unknown>,
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
      verdict: {
        type: verdictType as AgentDefinition["runner"]["verdict"]["type"],
        config: verdictConfig,
      },
      boundaries: {
        allowedTools: ["Read"],
        permissionMode: "default",
      },
      integrations: {
        github: {
          enabled: true,
          labels: {},
          defaultClosureAction: "label-only",
        },
      },
      execution: {},
      logging: { directory: "/tmp/claude/test-logs", format: "jsonl" },
    },
  } as AgentDefinition;
}

let passed = 0;
let failed = 0;

log("=== Verify Factory Verdict Paths ===\n");

// Test successful handler creation
log("--- Handler Creation Tests ---");
for (const tc of testCases) {
  try {
    const def = createTestDefinition(tc.verdictType, tc.verdictConfig);
    const agentDir = tc.agentDirOverride ??
      resolve(repoRoot, ".agent/iterator");
    // deno-lint-ignore no-await-in-loop
    const handler = await createRegistryVerdictHandler(
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

    if (tc.expectedClass === "ExternalStateVerdictAdapter") {
      if (!(handler instanceof ExternalStateVerdictAdapter)) {
        logErr(
          `FAIL: ${tc.name} - expected ExternalStateVerdictAdapter instance`,
        );
        failed++;
        continue;
      }
    }

    // Verify VerdictHandler interface methods exist
    const methods = [
      "buildInitialPrompt",
      "buildContinuationPrompt",
      "buildVerdictCriteria",
      "isFinished",
      "getVerdictDescription",
    ];
    const handlerRecord = handler as unknown as Record<string, unknown>;
    const missing = methods.filter((m) =>
      typeof handlerRecord[m] !== "function"
    );
    if (missing.length > 0) {
      logErr(
        `FAIL: ${tc.name} - missing VerdictHandler methods: ${
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
    const def = createTestDefinition(tc.verdictType, tc.verdictConfig);
    const agentDir = tc.agentDirOverride ??
      resolve(repoRoot, ".agent/iterator");
    // deno-lint-ignore no-await-in-loop
    await createRegistryVerdictHandler(def, tc.args, agentDir);
    logErr(`FAIL: ${tc.name} - expected error but succeeded`);
    failed++;
  } catch (error) {
    const msg = (error as Error).message;
    if (!msg.includes(tc.expectedError)) {
      logErr(
        `FAIL: ${tc.name} - expected "${tc.expectedError}" in error, got "${msg}"`,
      );
      failed++;
    } else if (error instanceof ConfigError && !msg.includes(error.code)) {
      logErr(
        `FAIL: ${tc.name} - ConfigError code mismatch: "${error.code}"`,
      );
      failed++;
    } else {
      log(`  PASS: ${tc.name} -> throws "${tc.expectedError}"`);
      passed++;
    }
  }
}

// Summary
log(`\nSummary: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  Deno.exit(1);
}
