// deno-lint-ignore-file no-console
/**
 * test-workflow-resolution.ts
 *
 * Verifies resolvePhase(), resolveAgent(), and stripPrefix() -- label resolution logic.
 *
 * Scenarios:
 * 1. Single label ["ready"] -> phaseId="implementation"
 * 2. Multiple labels ["ready","review"] -> lower priority number wins
 * 3. Terminal label ["done"] -> null (not actionable)
 * 4. Prefix label ["docs:ready"] with labelPrefix="docs" -> strips prefix, resolves
 * 5. resolveAgent for actionable phase -> agent returned
 * 6. resolveAgent for terminal phase -> null
 */

import {
  resolveAgent,
  resolvePhase,
  stripPrefix,
} from "../../../agents/orchestrator/label-resolver.ts";
import type { WorkflowConfig } from "../../../agents/orchestrator/workflow-types.ts";

function createConfig(): WorkflowConfig {
  return {
    version: "1.0.0",
    phases: {
      implementation: { type: "actionable", priority: 3, agent: "iterator" },
      review: { type: "actionable", priority: 2, agent: "reviewer" },
      revision: { type: "actionable", priority: 1, agent: "iterator" },
      complete: { type: "terminal" },
      blocked: { type: "blocking" },
    },
    labelMapping: {
      ready: "implementation",
      review: "review",
      "implementation-gap": "revision",
      done: "complete",
      blocked: "blocked",
    },
    agents: {
      iterator: {
        role: "transformer",
        directory: "iterator",
        outputPhase: "review",
        fallbackPhase: "blocked",
      },
      reviewer: {
        role: "validator",
        directory: "reviewer",
        outputPhases: { approved: "complete", rejected: "revision" },
        fallbackPhase: "blocked",
      },
    },
    rules: { maxCycles: 5, cycleDelayMs: 0 },
  };
}

function scenario1(): void {
  console.log("Scenario 1: Single label resolves to correct phase");
  const config = createConfig();
  const result = resolvePhase(["ready"], config);

  if (result === null) throw new Error("Expected non-null result");
  if (result.phaseId !== "implementation") {
    throw new Error(
      `Expected phaseId="implementation", got "${result.phaseId}"`,
    );
  }

  console.log("Scenario 1: PASS");
}

function scenario2(): void {
  console.log("Scenario 2: Multiple labels -> lowest priority number wins");
  const config = createConfig();
  // ready -> implementation (priority 3), review -> review (priority 2)
  // Lower priority number = higher urgency, so review wins
  const result = resolvePhase(["ready", "review"], config);

  if (result === null) throw new Error("Expected non-null result");
  if (result.phaseId !== "review") {
    throw new Error(
      `Expected phaseId="review", got "${result.phaseId}"`,
    );
  }

  console.log("Scenario 2: PASS");
}

function scenario3(): void {
  console.log("Scenario 3: Terminal label -> null (not actionable)");
  const config = createConfig();
  const result = resolvePhase(["done"], config);

  if (result !== null) {
    throw new Error(`Expected null, got phaseId="${result.phaseId}"`);
  }

  console.log("Scenario 3: PASS");
}

function scenario4(): void {
  console.log("Scenario 4: Prefix label strips prefix then resolves");
  const config = createConfig();
  config.labelPrefix = "docs";
  const result = resolvePhase(["docs:ready"], config);

  if (result === null) throw new Error("Expected non-null result");
  if (result.phaseId !== "implementation") {
    throw new Error(
      `Expected phaseId="implementation", got "${result.phaseId}"`,
    );
  }

  // Also verify stripPrefix directly
  const stripped = stripPrefix("docs:ready", "docs");
  if (stripped !== "ready") {
    throw new Error(`Expected stripped="ready", got "${stripped}"`);
  }

  console.log("Scenario 4: PASS");
}

function scenario5(): void {
  console.log(
    "Scenario 5: resolveAgent for actionable phase -> agent returned",
  );
  const config = createConfig();
  const result = resolveAgent("implementation", config);

  if (result === null) throw new Error("Expected non-null result");
  if (result.agentId !== "iterator") {
    throw new Error(
      `Expected agentId="iterator", got "${result.agentId}"`,
    );
  }

  console.log("Scenario 5: PASS");
}

function scenario6(): void {
  console.log("Scenario 6: resolveAgent for terminal phase -> null");
  const config = createConfig();
  const result = resolveAgent("complete", config);

  if (result !== null) {
    throw new Error(`Expected null, got agentId="${result.agentId}"`);
  }

  console.log("Scenario 6: PASS");
}

function main(): void {
  scenario1();
  scenario2();
  scenario3();
  scenario4();
  scenario5();
  scenario6();
  console.log("\nSummary: all scenarios passed");
}

main();
