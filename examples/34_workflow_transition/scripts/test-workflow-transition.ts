// deno-lint-ignore-file no-console
/**
 * test-workflow-transition.ts
 *
 * Verifies computeTransition() and computeLabelChanges() -- transition logic.
 *
 * Scenarios:
 * 1. Transformer success -> outputPhase, isFallback=false
 * 2. Transformer failed -> fallbackPhase, isFallback=true
 * 3. Validator approved -> outputPhases mapping
 * 4. Validator unknown outcome -> fallbackPhase, isFallback=true
 * 5. computeLabelChanges: ready -> review
 * 6. computeLabelChanges with prefix
 */

import {
  computeLabelChanges,
  computeTransition,
} from "../../../agents/orchestrator/phase-transition.ts";
import type {
  TransformerDefinition,
  ValidatorDefinition,
  WorkflowConfig,
} from "../../../agents/orchestrator/workflow-types.ts";

function createTransformer(): TransformerDefinition {
  return {
    role: "transformer",
    outputPhase: "review",
    fallbackPhase: "blocked",
  };
}

function createValidator(): ValidatorDefinition {
  return {
    role: "validator",
    outputPhases: {
      approved: "complete",
      rejected: "revision",
    },
    fallbackPhase: "blocked",
  };
}

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
      iterator: createTransformer(),
      reviewer: createValidator(),
    },
    rules: { maxCycles: 5, cycleDelayMs: 0 },
  };
}

function scenario1(): void {
  console.log("Scenario 1: Transformer success -> outputPhase");
  const agent = createTransformer();
  const result = computeTransition(agent, "success");

  if (result.targetPhase !== "review") {
    throw new Error(
      `Expected targetPhase="review", got "${result.targetPhase}"`,
    );
  }
  if (result.isFallback !== false) {
    throw new Error(`Expected isFallback=false, got ${result.isFallback}`);
  }

  console.log("Scenario 1: PASS");
}

function scenario2(): void {
  console.log("Scenario 2: Transformer failed -> fallbackPhase");
  const agent = createTransformer();
  const result = computeTransition(agent, "failed");

  if (result.targetPhase !== "blocked") {
    throw new Error(
      `Expected targetPhase="blocked", got "${result.targetPhase}"`,
    );
  }
  if (result.isFallback !== true) {
    throw new Error(`Expected isFallback=true, got ${result.isFallback}`);
  }

  console.log("Scenario 2: PASS");
}

function scenario3(): void {
  console.log("Scenario 3: Validator approved -> outputPhases mapping");
  const agent = createValidator();
  const result = computeTransition(agent, "approved");

  if (result.targetPhase !== "complete") {
    throw new Error(
      `Expected targetPhase="complete", got "${result.targetPhase}"`,
    );
  }
  if (result.isFallback !== false) {
    throw new Error(`Expected isFallback=false, got ${result.isFallback}`);
  }

  console.log("Scenario 3: PASS");
}

function scenario4(): void {
  console.log("Scenario 4: Validator unknown outcome -> fallbackPhase");
  const agent = createValidator();
  const result = computeTransition(agent, "unknown-result");

  if (result.targetPhase !== "blocked") {
    throw new Error(
      `Expected targetPhase="blocked", got "${result.targetPhase}"`,
    );
  }
  if (result.isFallback !== true) {
    throw new Error(`Expected isFallback=true, got ${result.isFallback}`);
  }

  console.log("Scenario 4: PASS");
}

function scenario5(): void {
  console.log("Scenario 5: computeLabelChanges ready -> review");
  const config = createConfig();
  const result = computeLabelChanges(["ready"], "review", config);

  if (
    result.labelsToRemove.length !== 1 ||
    result.labelsToRemove[0] !== "ready"
  ) {
    throw new Error(
      `Expected remove=["ready"], got [${result.labelsToRemove}]`,
    );
  }
  if (
    result.labelsToAdd.length !== 1 || result.labelsToAdd[0] !== "review"
  ) {
    throw new Error(
      `Expected add=["review"], got [${result.labelsToAdd}]`,
    );
  }

  console.log("Scenario 5: PASS");
}

function scenario6(): void {
  console.log("Scenario 6: computeLabelChanges with prefix");
  const config = createConfig();
  config.labelPrefix = "docs";
  const result = computeLabelChanges(["docs:ready"], "review", config);

  if (
    result.labelsToRemove.length !== 1 ||
    result.labelsToRemove[0] !== "docs:ready"
  ) {
    throw new Error(
      `Expected remove=["docs:ready"], got [${result.labelsToRemove}]`,
    );
  }
  if (
    result.labelsToAdd.length !== 1 ||
    result.labelsToAdd[0] !== "docs:review"
  ) {
    throw new Error(
      `Expected add=["docs:review"], got [${result.labelsToAdd}]`,
    );
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
