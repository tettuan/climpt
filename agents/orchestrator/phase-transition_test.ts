import { assertEquals, assertThrows } from "@std/assert";
import type {
  AgentDefinition,
  TransformerDefinition,
  ValidatorDefinition,
  WorkflowConfig,
} from "./workflow-types.ts";
import {
  computeLabelChanges,
  computeTransition,
  renderTemplate,
} from "./phase-transition.ts";

// --- Helpers ---

function makeTransformer(
  overrides: Partial<TransformerDefinition> = {},
): TransformerDefinition {
  return {
    role: "transformer",
    outputPhase: "review",
    fallbackPhase: "blocked",
    ...overrides,
  };
}

function makeValidator(
  overrides: Partial<ValidatorDefinition> = {},
): ValidatorDefinition {
  return {
    role: "validator",
    outputPhases: { approved: "complete", rejected: "revision" },
    fallbackPhase: "blocked",
    ...overrides,
  };
}

function makeConfig(
  labelMapping: Record<string, string> = {
    "ready": "implementation",
    "review": "review",
    "implementation-gap": "revision",
    "done": "complete",
    "blocked": "blocked",
  },
): WorkflowConfig {
  return {
    version: "1.0.0",
    phases: {},
    labelMapping,
    agents: {},
    rules: { maxCycles: 5, cycleDelayMs: 5000 },
  };
}

// --- computeTransition: Transformer ---

Deno.test("computeTransition - transformer success → outputPhase", () => {
  const agent = makeTransformer();
  const result = computeTransition(agent, "success");
  assertEquals(result, { targetPhase: "review", isFallback: false });
});

Deno.test("computeTransition - transformer failed → fallbackPhase", () => {
  const agent = makeTransformer();
  const result = computeTransition(agent, "failed");
  assertEquals(result, { targetPhase: "blocked", isFallback: true });
});

Deno.test("computeTransition - transformer without fallbackPhase on failure → throws", () => {
  const agent = makeTransformer({ fallbackPhase: undefined });
  assertThrows(
    () => computeTransition(agent, "failed"),
    Error,
    "Transformer has no fallbackPhase",
  );
});

// --- computeTransition: Validator ---

Deno.test("computeTransition - validator approved → correct outputPhase", () => {
  const agent = makeValidator();
  const result = computeTransition(agent, "approved");
  assertEquals(result, { targetPhase: "complete", isFallback: false });
});

Deno.test("computeTransition - validator rejected → correct outputPhase", () => {
  const agent = makeValidator();
  const result = computeTransition(agent, "rejected");
  assertEquals(result, { targetPhase: "revision", isFallback: false });
});

Deno.test("computeTransition - validator unknown outcome → fallbackPhase", () => {
  const agent = makeValidator();
  const result = computeTransition(agent, "unknown");
  assertEquals(result, { targetPhase: "blocked", isFallback: true });
});

Deno.test("computeTransition - validator without fallbackPhase on unknown outcome → throws", () => {
  const agent = makeValidator({ fallbackPhase: undefined });
  assertThrows(
    () => computeTransition(agent, "unknown"),
    Error,
    "Validator has no fallbackPhase",
  );
});

// --- computeLabelChanges ---

Deno.test("computeLabelChanges - removes workflow labels, adds target label", () => {
  const result = computeLabelChanges(
    ["ready", "review", "bug"],
    "complete",
    makeConfig(),
  );
  assertEquals(result.labelsToRemove, ["ready", "review"]);
  assertEquals(result.labelsToAdd, ["done"]);
});

Deno.test("computeLabelChanges - preserves non-workflow labels", () => {
  const result = computeLabelChanges(
    ["bug", "priority-high", "ready"],
    "review",
    makeConfig(),
  );
  assertEquals(result.labelsToRemove, ["ready"]);
  assertEquals(result.labelsToAdd, ["review"]);
});

Deno.test("computeLabelChanges - no label mapping for target → empty add", () => {
  const result = computeLabelChanges(
    ["ready"],
    "nonexistent-phase",
    makeConfig(),
  );
  assertEquals(result.labelsToRemove, ["ready"]);
  assertEquals(result.labelsToAdd, []);
});

// --- renderTemplate ---

Deno.test("renderTemplate - single variable", () => {
  const result = renderTemplate("Hello {name}", { name: "World" });
  assertEquals(result, "Hello World");
});

Deno.test("renderTemplate - multiple variables", () => {
  const result = renderTemplate(
    "Session: {session_id}, Issues: {issue_count}",
    { session_id: "abc-123", issue_count: "3" },
  );
  assertEquals(result, "Session: abc-123, Issues: 3");
});

Deno.test("renderTemplate - missing variable preserved", () => {
  const result = renderTemplate("Hello {name}, {missing}", { name: "World" });
  assertEquals(result, "Hello World, {missing}");
});

Deno.test("renderTemplate - empty template", () => {
  const result = renderTemplate("", { name: "World" });
  assertEquals(result, "");
});

// --- computeLabelChanges with labelPrefix ---

Deno.test("computeLabelChanges - with prefix prepends to added labels", () => {
  const config = makeConfig();
  config.labelPrefix = "docs";
  const result = computeLabelChanges(
    ["docs:ready", "bug"],
    "review",
    config,
  );
  assertEquals(result.labelsToRemove, ["docs:ready"]);
  assertEquals(result.labelsToAdd, ["docs:review"]);
});

Deno.test("computeLabelChanges - with prefix matches prefixed labels for removal", () => {
  const config = makeConfig();
  config.labelPrefix = "docs";
  const result = computeLabelChanges(
    ["docs:ready", "docs:review", "bug"],
    "complete",
    config,
  );
  assertEquals(result.labelsToRemove, ["docs:ready", "docs:review"]);
  assertEquals(result.labelsToAdd, ["docs:done"]);
});

Deno.test("computeLabelChanges - with prefix ignores non-prefixed workflow labels", () => {
  const config = makeConfig();
  config.labelPrefix = "docs";
  // "ready" without prefix should NOT be removed
  const result = computeLabelChanges(
    ["ready", "docs:review"],
    "complete",
    config,
  );
  assertEquals(result.labelsToRemove, ["docs:review"]);
  assertEquals(result.labelsToAdd, ["docs:done"]);
});

Deno.test("computeLabelChanges - without prefix works as before", () => {
  const config = makeConfig();
  // No labelPrefix
  const result = computeLabelChanges(
    ["ready", "bug"],
    "review",
    config,
  );
  assertEquals(result.labelsToRemove, ["ready"]);
  assertEquals(result.labelsToAdd, ["review"]);
});
