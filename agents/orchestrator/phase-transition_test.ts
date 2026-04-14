import { assertEquals, assertThrows } from "@std/assert";
import { fromFileUrl } from "@std/path";
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
import { loadWorkflow } from "./workflow-loader.ts";

/**
 * Absolute path to the repository root (two levels up from this file).
 * Used so that the real `.agent/workflow.json` can serve as the source of
 * truth for the three-stage (consider -> detail -> impl) pipeline tests.
 */
const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));

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

// ---------------------------------------------------------------------------
// Three-stage pipeline: consider -> detail -> impl
//
// Source of truth: .agent/workflow.json. Expectations are derived from the
// loaded configuration so that a change in workflow.json propagates to the
// tests without manual synchronization.
// ---------------------------------------------------------------------------

/** Narrowing helper: asserts an AgentDefinition is a ValidatorDefinition. */
function asValidator(agent: AgentDefinition): ValidatorDefinition {
  if (agent.role !== "validator") {
    throw new Error(
      `Expected validator role, received "${agent.role}". ` +
        "Fix: .agent/workflow.json must keep this agent declared as role=validator.",
    );
  }
  return agent;
}

Deno.test(
  "computeTransition - considerer verdict=handoff-detail routes to detail-pending (from workflow.json)",
  async () => {
    const config = await loadWorkflow(REPO_ROOT);
    const considerer = asValidator(config.agents["considerer"]);

    // Source of truth: outputPhases["handoff-detail"] in workflow.json.
    const expectedPhase = considerer.outputPhases["handoff-detail"];
    const result = computeTransition(considerer, "handoff-detail");

    assertEquals(
      result,
      { targetPhase: expectedPhase, isFallback: false },
      "considerer must route handoff-detail to the phase declared in " +
        ".agent/workflow.json agents.considerer.outputPhases['handoff-detail']. " +
        "Fix: keep outputPhases wiring and computeTransition aligned.",
    );
  },
);

Deno.test(
  "computeTransition - considerer verdict=done routes to done phase (from workflow.json)",
  async () => {
    const config = await loadWorkflow(REPO_ROOT);
    const considerer = asValidator(config.agents["considerer"]);

    const expectedPhase = considerer.outputPhases["done"];
    const result = computeTransition(considerer, "done");

    assertEquals(
      result,
      { targetPhase: expectedPhase, isFallback: false },
      "considerer must route verdict=done to the phase declared in " +
        ".agent/workflow.json agents.considerer.outputPhases['done']. " +
        "Fix: keep outputPhases wiring and computeTransition aligned.",
    );
  },
);

Deno.test(
  "computeTransition - detailer verdict=handoff-impl routes to impl-pending (from workflow.json)",
  async () => {
    const config = await loadWorkflow(REPO_ROOT);
    const detailer = asValidator(config.agents["detailer"]);

    const expectedPhase = detailer.outputPhases["handoff-impl"];
    const result = computeTransition(detailer, "handoff-impl");

    assertEquals(
      result,
      { targetPhase: expectedPhase, isFallback: false },
      "detailer must route handoff-impl to the phase declared in " +
        ".agent/workflow.json agents.detailer.outputPhases['handoff-impl']. " +
        "Fix: keep outputPhases wiring and computeTransition aligned.",
    );
  },
);

Deno.test(
  "computeTransition - detailer verdict=blocked routes to blocked phase (from workflow.json)",
  async () => {
    const config = await loadWorkflow(REPO_ROOT);
    const detailer = asValidator(config.agents["detailer"]);

    const expectedPhase = detailer.outputPhases["blocked"];
    const result = computeTransition(detailer, "blocked");

    assertEquals(
      result,
      { targetPhase: expectedPhase, isFallback: false },
      "detailer must route verdict=blocked to the phase declared in " +
        ".agent/workflow.json agents.detailer.outputPhases['blocked']. " +
        "Fix: keep outputPhases wiring and computeTransition aligned.",
    );
  },
);

Deno.test(
  "computeLabelChanges - kind:consider -> detail-pending rewrites consider label to detail label",
  async () => {
    const config = await loadWorkflow(REPO_ROOT);

    // Derive the label pair from the labelMapping (source of truth).
    const considerLabel = findLabelForPhase(config, "consider-pending");
    const detailLabel = findLabelForPhase(config, "detail-pending");
    const detailPhase = config.labelMapping[detailLabel];

    const result = computeLabelChanges(
      [considerLabel, "bug"],
      detailPhase,
      config,
    );

    assertEquals(
      result.labelsToRemove,
      [considerLabel],
      "Transition to detail-pending must remove the kind:consider label. " +
        "Fix: .agent/workflow.json labelMapping must keep kind:consider -> consider-pending.",
    );
    assertEquals(
      result.labelsToAdd,
      [detailLabel],
      "Transition to detail-pending must add the kind:detail label. " +
        "Fix: .agent/workflow.json labelMapping must keep kind:detail -> detail-pending.",
    );
  },
);

Deno.test(
  "computeLabelChanges - kind:detail -> impl-pending rewrites detail label to impl label",
  async () => {
    const config = await loadWorkflow(REPO_ROOT);

    const detailLabel = findLabelForPhase(config, "detail-pending");
    const implLabel = findLabelForPhase(config, "impl-pending");
    const implPhase = config.labelMapping[implLabel];

    const result = computeLabelChanges(
      [detailLabel, "bug"],
      implPhase,
      config,
    );

    assertEquals(
      result.labelsToRemove,
      [detailLabel],
      "Transition to impl-pending must remove the kind:detail label. " +
        "Fix: .agent/workflow.json labelMapping must keep kind:detail -> detail-pending.",
    );
    assertEquals(
      result.labelsToAdd,
      [implLabel],
      "Transition to impl-pending must add the kind:impl label. " +
        "Fix: .agent/workflow.json labelMapping must keep kind:impl -> impl-pending.",
    );
  },
);

/**
 * Finds the label whose mapping targets the given phase.
 *
 * Throws with an actionable message when the phase is not referenced — this
 * catches configuration drift (e.g., `detail-pending` removed from
 * labelMapping) early so the tests do not silently pass with wrong data.
 */
function findLabelForPhase(
  config: WorkflowConfig,
  targetPhase: string,
): string {
  for (const [label, phase] of Object.entries(config.labelMapping)) {
    if (phase === targetPhase) {
      return label;
    }
  }
  throw new Error(
    `No label in .agent/workflow.json labelMapping targets phase "${targetPhase}". ` +
      "Fix: add a label entry mapping to this phase, or update the test if the " +
      "phase was intentionally renamed.",
  );
}
