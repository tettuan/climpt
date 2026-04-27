/**
 * Tests for agents/config/label-existence-validator.ts
 *
 * Conformance Test pattern (per /test-design skill):
 *   declared labels (labelMapping + runner.integrations.github.labels)
 *     must match the repository's actual label set.
 *
 * Test rules:
 * - Expected values are derived from the fixture, not hardcoded.
 * - Every fixture declares at least one label (non-vacuity guard).
 * - Error messages must include the missing label name.
 * - Message phrasing is asserted via exported constants.
 */

import { assertEquals, assertGreater, assertStringIncludes } from "@std/assert";
import type {
  AgentDefinition,
  GitHubLabelsConfig,
} from "../src_common/types.ts";
import type { GitHubClient } from "../orchestrator/github-client.ts";
import {
  deriveInvocations,
  type WorkflowConfig,
} from "../orchestrator/workflow-types.ts";
import { TEST_DEFAULT_ISSUE_SOURCE } from "../orchestrator/_test-fixtures.ts";
import {
  extractLabelsFromGitHubConfig,
  MSG_LABEL,
  MSG_LABEL_CLIENT_UNAVAILABLE,
  MSG_LABEL_EMPTY,
  MSG_LABEL_MISSING,
  validateLabelExistence,
} from "./label-existence-validator.ts";

// ---------------------------------------------------------------------------
// Source file reference for diagnostic messages
// ---------------------------------------------------------------------------

const SRC = "label-existence-validator.ts";

// ---------------------------------------------------------------------------
// Minimal fake GitHubClient — only listLabels matters for this validator.
// Unused methods throw to surface accidental usage in a test.
// ---------------------------------------------------------------------------

function fakeClient(
  labels: readonly string[] | (() => Promise<string[]>),
): GitHubClient {
  const impl: Partial<GitHubClient> = {
    listLabels: typeof labels === "function"
      ? labels
      : () => Promise.resolve([...labels]),
  };
  const unsupported = (name: string) => () => {
    throw new Error(`fakeClient: ${name} not implemented for this test`);
  };
  return {
    listLabels: impl.listLabels!,
    getIssueLabels: unsupported("getIssueLabels"),
    updateIssueLabels: unsupported("updateIssueLabels"),
    addIssueComment: unsupported("addIssueComment"),
    createIssue: unsupported("createIssue"),
    closeIssue: unsupported("closeIssue"),
    reopenIssue: unsupported("reopenIssue"),
    listIssues: unsupported("listIssues"),
    getIssueDetail: unsupported("getIssueDetail"),
    getRecentComments: unsupported("getRecentComments"),
    // Phase 2 label-spec methods — not touched by the existence validator,
    // but part of the GitHubClient surface.
    listLabelsDetailed: unsupported("listLabelsDetailed"),
    createLabel: unsupported("createLabel"),
    updateLabel: unsupported("updateLabel"),
  } as GitHubClient;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDefinition(labels?: GitHubLabelsConfig): AgentDefinition {
  return {
    version: "1.0.0",
    name: "test-agent",
    displayName: "Test Agent",
    description: "Fixture for label-existence validator",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "system.md",
        prompts: { registry: "steps_registry.json" },
      },
      verdict: {
        type: "detect:graph",
        config: { registryPath: "steps_registry.json" },
      },
      integrations: labels === undefined
        ? undefined
        : { github: { enabled: true, labels } },
    },
  };
}

function makeWorkflow(
  labelMapping: Record<string, string>,
  labelPrefix?: string,
): WorkflowConfig {
  const phases = {
    plan: { type: "actionable" as const, priority: 1, agent: "planner" },
    done: { type: "terminal" as const },
  };
  const agents = {
    planner: { role: "transformer" as const, outputPhase: "done" },
  };
  return {
    version: "1.0.0",
    issueSource: TEST_DEFAULT_ISSUE_SOURCE,
    labelPrefix,
    phases,
    labelMapping,
    agents,
    invocations: deriveInvocations(phases, agents),
    rules: { maxCycles: 5, cycleDelayMs: 0 },
  };
}

/** Derive the declared label set exactly as the validator does. */
function declaredSet(
  def: AgentDefinition,
  wf: WorkflowConfig,
): Set<string> {
  const out = new Set<string>();
  const prefix = wf.labelPrefix;
  for (const bare of Object.keys(wf.labelMapping)) {
    out.add(prefix ? `${prefix}:${bare}` : bare);
  }
  for (
    const l of extractLabelsFromGitHubConfig(
      def.runner.integrations?.github?.labels,
    )
  ) {
    out.add(l);
  }
  return out;
}

// =============================================================================
// Case 1: All declared labels exist -> valid=true, zero errors
// =============================================================================

Deno.test("label-existence - all declared labels exist returns valid", async () => {
  const def = makeDefinition({ requirements: "ready", inProgress: "review" });
  const wf = makeWorkflow({ ready: "plan", review: "plan" });
  const declared = declaredSet(def, wf);
  assertGreater(
    declared.size,
    0,
    `Non-vacuity: fixture must declare at least one label (fix: ${SRC} test fixture)`,
  );

  const client = fakeClient([...declared]);
  const result = await validateLabelExistence(def, wf, client);

  assertEquals(
    result.valid,
    true,
    `Expected valid=true when every declared label exists (fix: ${SRC}). ` +
      `Got errors: ${result.errors.join("; ")}`,
  );
  assertEquals(
    result.errors.length,
    0,
    `Expected 0 errors when every declared label exists. Got: ${
      result.errors.join("; ")
    }`,
  );
});

// =============================================================================
// Case 2: One label missing in labelMapping only
// =============================================================================

Deno.test("label-existence - missing labelMapping label errors with site", async () => {
  const def = makeDefinition({ requirements: "ready" });
  const wf = makeWorkflow({ ready: "plan", review: "plan" });
  const declared = declaredSet(def, wf);
  assertGreater(
    declared.size,
    0,
    `Non-vacuity: fixture must declare at least one label (fix: ${SRC})`,
  );

  // "review" is only in labelMapping (not in GitHub config labels).
  const existing = new Set([...declared].filter((l) => l !== "review"));
  const expectedMissing = [...declared].filter((l) => !existing.has(l));
  assertEquals(
    expectedMissing,
    ["review"],
    "Test setup: expected exactly one missing label ('review') declared solely in labelMapping",
  );

  const result = await validateLabelExistence(
    def,
    wf,
    fakeClient([...existing]),
  );

  assertEquals(
    result.valid,
    false,
    `Expected valid=false when a declared label is missing (fix: ${SRC})`,
  );
  assertEquals(
    result.errors.length,
    expectedMissing.length,
    `Expected ${expectedMissing.length} error(s) = |declaredLabels| - |existing ∩ declaredLabels|`,
  );
  const msg = result.errors[0];
  assertStringIncludes(msg, MSG_LABEL);
  assertStringIncludes(msg, MSG_LABEL_MISSING);
  assertStringIncludes(msg, expectedMissing[0]);
  assertStringIncludes(msg, "labelMapping");
});

// =============================================================================
// Case 3: One label missing in GitHubLabelsConfig only
// =============================================================================

Deno.test("label-existence - missing GitHubLabelsConfig label errors with site", async () => {
  const def = makeDefinition({ requirements: "gap" });
  const wf = makeWorkflow({ ready: "plan" });
  const declared = declaredSet(def, wf);
  assertGreater(
    declared.size,
    0,
    `Non-vacuity: fixture must declare at least one label (fix: ${SRC})`,
  );

  // "gap" is only in GitHubLabelsConfig (not in labelMapping).
  const existing = new Set([...declared].filter((l) => l !== "gap"));
  const expectedMissing = [...declared].filter((l) => !existing.has(l));
  assertEquals(
    expectedMissing,
    ["gap"],
    "Test setup: expected exactly one missing label ('gap') declared solely in GitHubLabelsConfig",
  );

  const result = await validateLabelExistence(
    def,
    wf,
    fakeClient([...existing]),
  );

  assertEquals(result.valid, false);
  assertEquals(result.errors.length, expectedMissing.length);
  const msg = result.errors[0];
  assertStringIncludes(msg, MSG_LABEL_MISSING);
  assertStringIncludes(msg, expectedMissing[0]);
  assertStringIncludes(msg, "GitHubLabelsConfig");
});

// =============================================================================
// Case 4: Label missing from both sites -> single error citing both
// =============================================================================

Deno.test("label-existence - label declared in both sites reported once with both sites", async () => {
  // Same literal "review" declared in labelMapping AND GitHubLabelsConfig.
  const def = makeDefinition({ requirements: "review" });
  const wf = makeWorkflow({ review: "plan" });
  const declared = declaredSet(def, wf);
  assertEquals(
    declared.size,
    1,
    "Test setup: expected both declaration sites to collapse into a single label",
  );
  assertGreater(
    declared.size,
    0,
    `Non-vacuity: fixture must declare at least one label (fix: ${SRC})`,
  );

  const expectedMissing = [...declared];
  const result = await validateLabelExistence(def, wf, fakeClient([]));

  assertEquals(result.errors.length, expectedMissing.length);
  const msg = result.errors[0];
  assertStringIncludes(msg, MSG_LABEL_MISSING);
  assertStringIncludes(msg, expectedMissing[0]);
  assertStringIncludes(msg, "labelMapping");
  assertStringIncludes(msg, "GitHubLabelsConfig");
});

// =============================================================================
// Case 5: Client returns empty list -> every declared label errors
// =============================================================================

Deno.test("label-existence - empty repo label set errors every declared label", async () => {
  const def = makeDefinition({ requirements: "ready", inProgress: "review" });
  const wf = makeWorkflow({ ready: "plan", blocked: "done" });
  const declared = declaredSet(def, wf);
  assertGreater(
    declared.size,
    0,
    `Non-vacuity: fixture must declare at least one label (fix: ${SRC})`,
  );

  const existing = new Set<string>();
  const expectedMissing = [...declared].filter((l) => !existing.has(l));
  // Derivation check: with empty repo, every declared label is missing.
  assertEquals(expectedMissing.length, declared.size);

  const result = await validateLabelExistence(def, wf, fakeClient([]));

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.length,
    expectedMissing.length,
    `Expected |declaredLabels| errors when repo is empty (got ${result.errors.length}, expected ${expectedMissing.length})`,
  );
  // Every declared label name must appear somewhere in the error list.
  for (const label of expectedMissing) {
    const hit = result.errors.some((e) => e.includes(label));
    assertEquals(
      hit,
      true,
      `Expected an error message to mention missing label '${label}'. Got: ${
        result.errors.join(" | ")
      }`,
    );
  }
});

// =============================================================================
// Case 6: Client throws -> single warning, valid=true (skip semantics)
// =============================================================================

Deno.test("label-existence - client failure produces single warning and valid=true", async () => {
  const def = makeDefinition({ requirements: "ready" });
  const wf = makeWorkflow({ ready: "plan" });
  const declared = declaredSet(def, wf);
  assertGreater(
    declared.size,
    0,
    `Non-vacuity: fixture must declare at least one label (fix: ${SRC})`,
  );

  const failing = fakeClient(() => {
    return Promise.reject(new Error("gh auth required"));
  });

  const result = await validateLabelExistence(def, wf, failing);

  assertEquals(
    result.valid,
    true,
    "Client failure must not fail validation (skip semantics)",
  );
  assertEquals(result.errors.length, 0);
  assertEquals(
    result.warnings.length,
    1,
    `Expected exactly 1 skip warning, got ${result.warnings.length}: ${
      result.warnings.join(" | ")
    }`,
  );
  assertStringIncludes(result.warnings[0], MSG_LABEL_CLIENT_UNAVAILABLE);
  assertStringIncludes(result.warnings[0], "gh auth required");
});

// =============================================================================
// Empty-declaration non-vacuity guard: warning, valid=true
// =============================================================================

Deno.test("label-existence - empty declarations produce non-vacuity warning", async () => {
  const def = makeDefinition(); // no integrations.github.labels
  const wf = makeWorkflow({}); // no labelMapping entries

  const declared = declaredSet(def, wf);
  assertEquals(
    declared.size,
    0,
    "Test setup: this case exercises the empty-declaration path specifically",
  );

  const result = await validateLabelExistence(def, wf, fakeClient([]));

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
  assertEquals(result.warnings.length, 1);
  assertStringIncludes(result.warnings[0], MSG_LABEL_EMPTY);
});

// =============================================================================
// extractLabelsFromGitHubConfig — unit coverage
// =============================================================================

Deno.test("extractLabelsFromGitHubConfig - undefined yields empty set", () => {
  const out = extractLabelsFromGitHubConfig(undefined);
  assertEquals(out.size, 0);
});

Deno.test("extractLabelsFromGitHubConfig - string slots are included", () => {
  const cfg: GitHubLabelsConfig = {
    requirements: "ready",
    inProgress: "review",
  };
  const out = extractLabelsFromGitHubConfig(cfg);
  const expected = new Set(["ready", "review"]);
  assertEquals(
    out.size,
    expected.size,
    `Expected ${expected.size} labels (one per string slot), got ${out.size}`,
  );
  for (const v of expected) {
    assertEquals(out.has(v), true, `expected to include '${v}'`);
  }
});

Deno.test("extractLabelsFromGitHubConfig - add/remove arrays are both included", () => {
  const cfg: GitHubLabelsConfig = {
    completion: { add: ["approved", "closed"], remove: ["review"] },
  };
  const out = extractLabelsFromGitHubConfig(cfg);
  const expected = new Set(["approved", "closed", "review"]);
  assertEquals(
    out.size,
    expected.size,
    `Expected ${expected.size} labels from add+remove, got ${out.size}: ${
      [...out].join(",")
    }`,
  );
  for (const v of expected) {
    assertEquals(out.has(v), true, `expected to include '${v}'`);
  }
});

Deno.test("extractLabelsFromGitHubConfig - agent-specific string keys are included", () => {
  const cfg: GitHubLabelsConfig = {
    review: "review",
    gap: "gap",
  };
  const out = extractLabelsFromGitHubConfig(cfg);
  assertEquals(out.has("review"), true);
  assertEquals(out.has("gap"), true);
});
