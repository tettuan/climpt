// TODO[workflow-adt-migration]: replace REPO_ROOT/.agent/workflow.json reads with framework-owned fixture (mirror agents/common/step-registry/_fixtures/ pattern).

/**
 * Tests for agents/orchestrator/workflow-loader.ts
 *
 * Covers loadWorkflow() with valid configs, missing files,
 * cross-reference validation failures, and default rules application.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { loadWorkflow } from "./workflow-loader.ts";

/**
 * Absolute path to the repository root. Used to integration-test the real
 * `.agent/workflow.json` as the source of truth for the three-stage
 * consider -> detail -> impl pipeline.
 */
const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));

/** Minimal valid workflow config for test fixtures */
function validConfig(): Record<string, unknown> {
  return {
    version: "1.0.0",
    // T1.1: required IssueSource ADT (12-workflow-config.md §C)
    issueSource: { kind: "ghRepoIssues", projectMembership: "unbound" },
    phases: {
      implementation: { type: "actionable", priority: 1, agent: "iterator" },
      review: { type: "actionable", priority: 2, agent: "reviewer" },
      complete: { type: "terminal" },
      blocked: { type: "blocking" },
    },
    labelMapping: {
      ready: "implementation",
      review: "review",
      done: "complete",
      blocked: "blocked",
    },
    agents: {
      iterator: {
        role: "transformer",
        outputPhase: "review",
        fallbackPhase: "blocked",
      },
      reviewer: {
        role: "validator",
        outputPhases: { approved: "complete", rejected: "implementation" },
        fallbackPhase: "blocked",
      },
    },
  };
}

async function writeFixture(
  dir: string,
  config: Record<string, unknown>,
  relativePath = ".agent/workflow.json",
): Promise<void> {
  const filePath = join(dir, relativePath);
  const parent = filePath.replace(/\/[^/]+$/, "");
  await Deno.mkdir(parent, { recursive: true });
  await Deno.writeTextFile(filePath, JSON.stringify(config));
}

// =============================================================================
// Valid config
// =============================================================================

Deno.test("workflow-loader: valid config loads successfully", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeFixture(dir, validConfig());
    const config = await loadWorkflow(dir);
    assertEquals(config.version, "1.0.0");
    assertEquals(Object.keys(config.phases).length, 4);
    assertEquals(Object.keys(config.agents).length, 2);
    assertEquals(config.labelMapping["ready"], "implementation");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// Missing file
// =============================================================================

Deno.test("workflow-loader: missing workflow.json throws", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const err = await assertRejects(
      () => loadWorkflow(dir),
      Error,
    );
    assertStringIncludes(err.message, "not found");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// IssueSource ADT (T1.1, design 12-workflow-config.md §C)
// =============================================================================

Deno.test("workflow-loader: WF-ISSUE-SOURCE-001 — missing issueSource rejected", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    delete (cfg as Record<string, unknown>).issueSource;
    await writeFixture(dir, cfg);
    const err = await assertRejects(() => loadWorkflow(dir), Error);
    assertStringIncludes(err.message, "WF-ISSUE-SOURCE-001");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: WF-ISSUE-SOURCE-002 — unknown kind rejected", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg as Record<string, unknown>).issueSource = { kind: "ghMystery" };
    await writeFixture(dir, cfg);
    const err = await assertRejects(() => loadWorkflow(dir), Error);
    assertStringIncludes(err.message, "WF-ISSUE-SOURCE-002");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: WF-ISSUE-SOURCE-003 — ghProject without project field rejected", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg as Record<string, unknown>).issueSource = { kind: "ghProject" };
    await writeFixture(dir, cfg);
    const err = await assertRejects(() => loadWorkflow(dir), Error);
    assertStringIncludes(err.message, "WF-ISSUE-SOURCE-003");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: WF-ISSUE-SOURCE-004 — explicit with empty issueIds rejected", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg as Record<string, unknown>).issueSource = {
      kind: "explicit",
      issueIds: [],
    };
    await writeFixture(dir, cfg);
    const err = await assertRejects(() => loadWorkflow(dir), Error);
    assertStringIncludes(err.message, "WF-ISSUE-SOURCE-004");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: WF-ISSUE-SOURCE-005 — invalid projectMembership rejected", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg as Record<string, unknown>).issueSource = {
      kind: "ghRepoIssues",
      projectMembership: "invalid-mode",
    };
    await writeFixture(dir, cfg);
    const err = await assertRejects(() => loadWorkflow(dir), Error);
    assertStringIncludes(err.message, "WF-ISSUE-SOURCE-005");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: ghProject variant loads with full ProjectRef", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg as Record<string, unknown>).issueSource = {
      kind: "ghProject",
      project: { owner: "tettuan", number: 42 },
      labels: ["kind:impl"],
      state: "open",
      limit: 30,
    };
    await writeFixture(dir, cfg);
    const config = await loadWorkflow(dir);
    assertEquals(config.issueSource.kind, "ghProject");
    if (config.issueSource.kind === "ghProject") {
      assertEquals(config.issueSource.project, {
        owner: "tettuan",
        number: 42,
      });
      assertEquals(config.issueSource.labels, ["kind:impl"]);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: explicit variant loads with non-empty issueIds", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg as Record<string, unknown>).issueSource = {
      kind: "explicit",
      issueIds: [11, 22, 33],
    };
    await writeFixture(dir, cfg);
    const config = await loadWorkflow(dir);
    assertEquals(config.issueSource.kind, "explicit");
    if (config.issueSource.kind === "explicit") {
      assertEquals(config.issueSource.issueIds, [11, 22, 33]);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// Default rules
// =============================================================================

Deno.test("workflow-loader: default rules applied when rules omitted", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    // No rules section
    await writeFixture(dir, cfg);
    const config = await loadWorkflow(dir);
    assertEquals(config.rules.maxCycles, 5);
    assertEquals(config.rules.cycleDelayMs, 10000);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: partial rules merged with defaults", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    cfg.rules = { maxCycles: 10 };
    await writeFixture(dir, cfg);
    const config = await loadWorkflow(dir);
    assertEquals(config.rules.maxCycles, 10);
    assertEquals(config.rules.cycleDelayMs, 10000);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// Cross-reference: labelMapping → phases
// =============================================================================

Deno.test("workflow-loader: invalid phase in labelMapping throws", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.labelMapping as Record<string, string>)["unknown-label"] =
      "nonexistent";
    await writeFixture(dir, cfg);
    const err = await assertRejects(
      () => loadWorkflow(dir),
      Error,
    );
    assertStringIncludes(err.message, "unknown-label");
    assertStringIncludes(err.message, "nonexistent");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// Cross-reference: phase.agent → agents
// =============================================================================

Deno.test("workflow-loader: invalid agent reference in phase throws", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.phases as Record<string, unknown>)["badphase"] = {
      type: "actionable",
      priority: 5,
      agent: "ghost-agent",
    };
    await writeFixture(dir, cfg);
    const err = await assertRejects(
      () => loadWorkflow(dir),
      Error,
    );
    assertStringIncludes(err.message, "ghost-agent");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// Cross-reference: agent outputPhase → phases
// =============================================================================

Deno.test("workflow-loader: invalid outputPhase reference throws", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.agents as Record<string, unknown>)["bad-transformer"] = {
      role: "transformer",
      outputPhase: "nonexistent-phase",
    };
    // Add a phase that references this agent so it's reachable
    (cfg.phases as Record<string, unknown>)["trigger"] = {
      type: "actionable",
      priority: 10,
      agent: "bad-transformer",
    };
    await writeFixture(dir, cfg);
    const err = await assertRejects(
      () => loadWorkflow(dir),
      Error,
    );
    assertStringIncludes(err.message, "bad-transformer");
    assertStringIncludes(err.message, "nonexistent-phase");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: invalid outputPhases value reference throws", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.agents as Record<string, unknown>)["bad-validator"] = {
      role: "validator",
      outputPhases: { pass: "complete", fail: "nowhere" },
    };
    (cfg.phases as Record<string, unknown>)["trigger2"] = {
      type: "actionable",
      priority: 10,
      agent: "bad-validator",
    };
    await writeFixture(dir, cfg);
    const err = await assertRejects(
      () => loadWorkflow(dir),
      Error,
    );
    assertStringIncludes(err.message, "bad-validator");
    assertStringIncludes(err.message, "nowhere");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// Cross-reference: agent fallbackPhase → phases
// =============================================================================

Deno.test("workflow-loader: invalid fallbackPhase reference throws", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.agents as Record<string, unknown>)["iterator"] = {
      role: "transformer",
      outputPhase: "review",
      fallbackPhase: "void-phase",
    };
    await writeFixture(dir, cfg);
    const err = await assertRejects(
      () => loadWorkflow(dir),
      Error,
    );
    assertStringIncludes(err.message, "iterator");
    assertStringIncludes(err.message, "void-phase");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// Actionable phase without agent
// =============================================================================

Deno.test("workflow-loader: actionable phase without agent throws", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.phases as Record<string, unknown>)["orphan"] = {
      type: "actionable",
      priority: 5,
    };
    await writeFixture(dir, cfg);
    const err = await assertRejects(
      () => loadWorkflow(dir),
      Error,
    );
    assertStringIncludes(err.message, "orphan");
    assertStringIncludes(err.message, "agent");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// Actionable phase without priority
// =============================================================================

Deno.test("workflow-loader: actionable phase without priority throws", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.phases as Record<string, unknown>)["noprio"] = {
      type: "actionable",
      agent: "iterator",
    };
    await writeFixture(dir, cfg);
    const err = await assertRejects(
      () => loadWorkflow(dir),
      Error,
    );
    assertStringIncludes(err.message, "noprio");
    assertStringIncludes(err.message, "priority");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// Explicit workflowPath
// =============================================================================

Deno.test("workflow-loader: loadWorkflow with explicit workflowPath", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const customPath = "config/my-workflow.json";
    await writeFixture(dir, validConfig(), customPath);
    const config = await loadWorkflow(dir, customPath);
    assertEquals(config.version, "1.0.0");
    assertEquals(Object.keys(config.phases).length, 4);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// labelPrefix parsing
// =============================================================================

Deno.test("workflow-loader: labelPrefix field is parsed", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    cfg.labelPrefix = "docs";
    await writeFixture(dir, cfg);
    const config = await loadWorkflow(dir);
    assertEquals(config.labelPrefix, "docs");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// Cross-reference: closeBinding.condition validation (T6.2)
// =============================================================================

Deno.test("workflow-loader: closeBinding.condition without active primary throws WF-REF-005", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.agents as Record<string, unknown>)["reviewer"] = {
      role: "validator",
      outputPhases: { approved: "complete", rejected: "implementation" },
      fallbackPhase: "blocked",
      // primary=none + condition is the post-T6.2 equivalent of the
      // legacy "closeCondition without closeOnComplete" misconfiguration.
      closeBinding: {
        primary: { kind: "none" },
        cascade: false,
        condition: "approved",
      },
    };
    await writeFixture(dir, cfg);
    const err = await assertRejects(
      () => loadWorkflow(dir),
      Error,
    );
    assertStringIncludes(
      err.message,
      "reviewer",
      "Error should name the agent. Fix: config-errors.ts wfRefCloseConditionWithoutCloseOnComplete",
    );
    assertStringIncludes(
      err.message,
      "closeBinding",
      "Error should mention closeBinding. Fix: config-errors.ts WF-REF-005",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: closeBinding.condition with unknown outcome key throws WF-REF-006", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.agents as Record<string, unknown>)["reviewer"] = {
      role: "validator",
      outputPhases: { approved: "complete", rejected: "implementation" },
      fallbackPhase: "blocked",
      closeBinding: {
        primary: { kind: "direct" },
        cascade: false,
        condition: "typo_approved", // not in outputPhases
      },
    };
    await writeFixture(dir, cfg);
    const err = await assertRejects(
      () => loadWorkflow(dir),
      Error,
    );
    assertStringIncludes(
      err.message,
      "reviewer",
      "Error should name the agent. Fix: config-errors.ts wfRefInvalidCloseCondition",
    );
    assertStringIncludes(
      err.message,
      "typo_approved",
      "Error should include the invalid closeBinding.condition value. Fix: config-errors.ts WF-REF-006",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: valid closeBinding with condition loads successfully", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.agents as Record<string, unknown>)["reviewer"] = {
      role: "validator",
      outputPhases: { approved: "complete", rejected: "implementation" },
      fallbackPhase: "blocked",
      closeBinding: {
        primary: { kind: "direct" },
        cascade: false,
        condition: "approved",
      },
    };
    await writeFixture(dir, cfg);
    const config = await loadWorkflow(dir);
    assertEquals(
      config.agents["reviewer"].closeBinding?.primary.kind,
      "direct",
    );
    assertEquals(
      config.agents["reviewer"].closeBinding?.condition,
      "approved",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: closeBinding without condition loads successfully", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.agents as Record<string, unknown>)["reviewer"] = {
      role: "validator",
      outputPhases: { approved: "complete", rejected: "implementation" },
      fallbackPhase: "blocked",
      closeBinding: {
        primary: { kind: "direct" },
        cascade: false,
      },
    };
    await writeFixture(dir, cfg);
    const config = await loadWorkflow(dir);
    assertEquals(
      config.agents["reviewer"].closeBinding?.primary.kind,
      "direct",
    );
    assertEquals(
      config.agents["reviewer"].closeBinding?.condition,
      undefined,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// labelPrefix
// =============================================================================

Deno.test("workflow-loader: labelPrefix is undefined when omitted", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeFixture(dir, validConfig());
    const config = await loadWorkflow(dir);
    assertEquals(config.labelPrefix, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// handoffs[] and payloadSchema (declarative artifact emission bindings)
// =============================================================================

Deno.test("workflow-loader: config with handoffs[] and payloadSchema loads successfully", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    cfg.payloadSchema = { $ref: "./schemas/sample-payload.json" };
    cfg.handoffs = [
      {
        id: "sample-approved",
        when: { fromAgent: "reviewer", outcome: "approved" },
        emit: {
          type: "verdict",
          schemaRef: "sample-verdict@1.0.0",
          path: "tmp/climpt/orchestrator/emits/${payload.prNumber}.json",
        },
        payloadFrom: {
          prNumber: "$.agent.result.pr_number",
          verdict: "$.agent.result.outcome",
          schema_version: "'1.0.0'",
        },
        persistPayloadTo: "subjectStore",
      },
    ];
    await writeFixture(dir, cfg);

    const config = await loadWorkflow(dir);

    assertEquals(
      config.payloadSchema?.$ref,
      "./schemas/sample-payload.json",
      "payloadSchema.$ref must round-trip through the loader. " +
        "Fix: workflow-loader populates WorkflowConfig.payloadSchema from parsed JSON.",
    );
    assertEquals(config.handoffs?.length, 1);
    assertEquals(config.handoffs?.[0].id, "sample-approved");
    assertEquals(config.handoffs?.[0].when.fromAgent, "reviewer");
    assertEquals(config.handoffs?.[0].when.outcome, "approved");
    assertEquals(
      config.handoffs?.[0].emit.schemaRef,
      "sample-verdict@1.0.0",
    );
    assertEquals(config.handoffs?.[0].persistPayloadTo, "subjectStore");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: handoffs and payloadSchema remain undefined when omitted", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeFixture(dir, validConfig());
    const config = await loadWorkflow(dir);
    assertEquals(config.handoffs, undefined);
    assertEquals(config.payloadSchema, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// Integration: three-stage pipeline (consider -> detail -> impl) from the
// real .agent/workflow.json. Confirms the loader accepts the new detailer
// agent, detail-pending phase, kind:detail label, and handoff comment
// templates without any additional schema changes.
// =============================================================================

Deno.test(
  "workflow-loader: real .agent/workflow.json exposes the three-stage pipeline",
  async () => {
    const config = await loadWorkflow(REPO_ROOT);

    // Phase: detail-pending must exist as actionable and point to detailer.
    const detailPhase = config.phases["detail-pending"];
    assertEquals(
      detailPhase?.type,
      "actionable",
      "detail-pending phase must be declared as actionable. " +
        "Fix: .agent/workflow.json phases['detail-pending'].type = 'actionable'.",
    );
    assertEquals(
      detailPhase?.agent,
      "detailer",
      "detail-pending phase must dispatch the detailer agent. " +
        "Fix: .agent/workflow.json phases['detail-pending'].agent = 'detailer'.",
    );

    // Agent: detailer must be a validator routing handoff-impl and blocked.
    const detailer = config.agents["detailer"];
    assertEquals(
      detailer?.role,
      "validator",
      "detailer must be declared as role=validator so verdicts drive routing. " +
        "Fix: .agent/workflow.json agents.detailer.role = 'validator'.",
    );
    if (detailer.role === "validator") {
      assertEquals(
        detailer.outputPhases["handoff-impl"],
        "impl-pending",
        "detailer handoff-impl verdict must route to impl-pending. " +
          "Fix: .agent/workflow.json agents.detailer.outputPhases['handoff-impl'].",
      );
      assertEquals(
        detailer.outputPhases["blocked"],
        "blocked",
        "detailer blocked verdict must route to the blocked phase. " +
          "Fix: .agent/workflow.json agents.detailer.outputPhases['blocked'].",
      );
    }

    // Agent: considerer must expose the handoff-detail verdict now that it
    // has been promoted from transformer to validator.
    const considerer = config.agents["considerer"];
    assertEquals(
      considerer?.role,
      "validator",
      "considerer must be declared as role=validator to emit verdicts. " +
        "Fix: .agent/workflow.json agents.considerer.role = 'validator'.",
    );
    if (considerer.role === "validator") {
      assertEquals(
        considerer.outputPhases["handoff-detail"],
        "detail-pending",
        "considerer handoff-detail verdict must route to detail-pending. " +
          "Fix: .agent/workflow.json agents.considerer.outputPhases['handoff-detail'].",
      );
      assertEquals(
        considerer.outputPhases["done"],
        "done",
        "considerer done verdict must route to the done phase. " +
          "Fix: .agent/workflow.json agents.considerer.outputPhases['done'].",
      );
    }

    // labelMapping: kind:detail -> detail-pending is required so triager
    // output routes to the new phase.
    assertEquals(
      config.labelMapping["kind:detail"],
      "detail-pending",
      "kind:detail label must map to detail-pending phase. " +
        "Fix: .agent/workflow.json labelMapping['kind:detail'] = 'detail-pending'.",
    );

    // Handoff comment templates for both handoff legs must be present.
    const templates = config.handoff?.commentTemplates ?? {};
    const templateNames = ["considererHandoffDetail", "detailerHandoffImpl"];
    for (const name of templateNames) {
      const template = templates[name];
      assertEquals(
        typeof template,
        "string",
        `handoff.commentTemplates['${name}'] must be defined as a string. ` +
          `Fix: add the ${name} template in .agent/workflow.json.`,
      );
      if (typeof template === "string") {
        // Non-vacuity: template must be non-empty to carry a real message.
        assertEquals(
          template.length > 0,
          true,
          `handoff.commentTemplates['${name}'] must not be empty. ` +
            `Fix: provide a meaningful body for ${name}.`,
        );
      }
    }
  },
);

// =============================================================================
// labels section — opt-in validation (WF-LABEL-003 / 004 / 005)
//
// When `labels` is absent, validation is skipped (backwards compat with
// pre-Phase-2 configs). When declared — even as {} — the full
// completeness + orphan + color-format contract is enforced.
// =============================================================================

/** Extend validConfig() with a `labels` section. */
function configWithLabels(
  labels: Record<
    string,
    { color: string; description: string; role?: "routing" | "marker" }
  >,
): Record<string, unknown> {
  const cfg = validConfig();
  cfg.labels = labels;
  return cfg;
}

Deno.test("workflow-loader: labels absent → validation skipped (backwards compat)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // validConfig() has no `labels` field; should load cleanly.
    await writeFixture(dir, validConfig());
    const config = await loadWorkflow(dir);
    assertEquals(
      config.labels,
      undefined,
      "labels must remain undefined when omitted — no implicit default.",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: WF-LABEL-003 — labels present but missing spec for a labelMapping key", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // labelMapping has 4 keys (ready, review, done, blocked); declare only 3.
    const cfg = configWithLabels({
      ready: { color: "a2eeef", description: "ready for work" },
      review: { color: "fbca04", description: "under review" },
      done: { color: "0e8a16", description: "complete" },
      // "blocked" intentionally missing.
    });
    await writeFixture(dir, cfg);
    const err = await assertRejects(() => loadWorkflow(dir), Error);
    assertStringIncludes(err.message, "WF-LABEL-003");
    assertStringIncludes(
      err.message,
      "blocked",
      "Error must name the specific missing label to guide the fix.",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: WF-LABEL-003 — prioritizer.labels entry without a spec fails", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = configWithLabels({
      ready: { color: "a2eeef", description: "ready for work" },
      review: { color: "fbca04", description: "under review" },
      done: { color: "0e8a16", description: "complete" },
      blocked: { color: "d93f0b", description: "blocked" },
      // "order:1" referenced by prioritizer below — not declared.
    });
    cfg.prioritizer = {
      mode: "label-based",
      labels: ["order:1"],
    };
    await writeFixture(dir, cfg);
    const err = await assertRejects(() => loadWorkflow(dir), Error);
    assertStringIncludes(err.message, "WF-LABEL-003");
    assertStringIncludes(err.message, "order:1");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: WF-LABEL-004 — orphan spec not referenced anywhere fails", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = configWithLabels({
      ready: { color: "a2eeef", description: "ready for work" },
      review: { color: "fbca04", description: "under review" },
      done: { color: "0e8a16", description: "complete" },
      blocked: { color: "d93f0b", description: "blocked" },
      // Orphan: referenced by neither labelMapping nor prioritizer.labels.
      "legacy:abandoned": { color: "cccccc", description: "orphan" },
    });
    await writeFixture(dir, cfg);
    const err = await assertRejects(() => loadWorkflow(dir), Error);
    assertStringIncludes(err.message, "WF-LABEL-004");
    assertStringIncludes(err.message, "legacy:abandoned");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: WF-LABEL-004 — marker role bypasses orphan check", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // A marker label is declared (so it gets synced to GitHub and code can
    // safely probe for it via labels.includes(...)), but it is NOT routed
    // via labelMapping or prioritizer.labels. The orphan check must permit
    // this because the marker role is the declarative escape hatch for
    // identification-only labels (e.g., project-sentinel).
    const cfg = configWithLabels({
      ready: { color: "a2eeef", description: "ready for work" },
      review: { color: "fbca04", description: "under review" },
      done: { color: "0e8a16", description: "complete" },
      blocked: { color: "d93f0b", description: "blocked" },
      "meta:sentinel": {
        color: "e6e6e6",
        description: "identification-only marker",
        role: "marker",
      },
    });
    await writeFixture(dir, cfg);
    const config = await loadWorkflow(dir);
    assertEquals(config.labels?.["meta:sentinel"]?.role, "marker");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: WF-LABEL-004 — explicit role='routing' still triggers orphan check", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Guard rail: a label with role='routing' (the default, stated
    // explicitly here) must still participate in orphan detection.
    // Only role='marker' is exempt — marker must be opt-in, not implicit.
    const cfg = configWithLabels({
      ready: { color: "a2eeef", description: "ready for work" },
      review: { color: "fbca04", description: "under review" },
      done: { color: "0e8a16", description: "complete" },
      blocked: { color: "d93f0b", description: "blocked" },
      "legacy:unused": {
        color: "cccccc",
        description: "declared but not routed",
        role: "routing",
      },
    });
    await writeFixture(dir, cfg);
    const err = await assertRejects(() => loadWorkflow(dir), Error);
    assertStringIncludes(err.message, "WF-LABEL-004");
    assertStringIncludes(err.message, "legacy:unused");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: WF-LABEL-005 — invalid color (non-hex) fails", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = configWithLabels({
      ready: { color: "not-a-hex", description: "ready for work" },
      review: { color: "fbca04", description: "under review" },
      done: { color: "0e8a16", description: "complete" },
      blocked: { color: "d93f0b", description: "blocked" },
    });
    await writeFixture(dir, cfg);
    const err = await assertRejects(() => loadWorkflow(dir), Error);
    assertStringIncludes(err.message, "WF-LABEL-005");
    assertStringIncludes(err.message, "ready");
    assertStringIncludes(err.message, "not-a-hex");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: WF-LABEL-005 — leading '#' on color rejected", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Common paste mistake — GitHub's label API rejects leading '#'.
    const cfg = configWithLabels({
      ready: { color: "#a2eeef", description: "ready" },
      review: { color: "fbca04", description: "review" },
      done: { color: "0e8a16", description: "done" },
      blocked: { color: "d93f0b", description: "blocked" },
    });
    await writeFixture(dir, cfg);
    const err = await assertRejects(() => loadWorkflow(dir), Error);
    assertStringIncludes(err.message, "WF-LABEL-005");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: valid labels section (complete + in-spec) loads", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = configWithLabels({
      ready: { color: "a2eeef", description: "ready for work" },
      review: { color: "fbca04", description: "under review" },
      done: { color: "0e8a16", description: "complete" },
      blocked: { color: "d93f0b", description: "blocked" },
    });
    await writeFixture(dir, cfg);
    const config = await loadWorkflow(dir);
    assertEquals(Object.keys(config.labels ?? {}).length, 4);
    assertEquals(config.labels?.ready?.color, "a2eeef");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: uppercase hex colors accepted", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // GitHub normalises to lowercase internally, but the loader must
    // accept either form to avoid gratuitously rejecting human-authored
    // configs that use the Cb palette docs (often uppercase).
    const cfg = configWithLabels({
      ready: { color: "A2EEEF", description: "ready" },
      review: { color: "FBCA04", description: "review" },
      done: { color: "0E8A16", description: "done" },
      blocked: { color: "D93F0B", description: "blocked" },
    });
    await writeFixture(dir, cfg);
    const config = await loadWorkflow(dir);
    assertEquals(config.labels?.ready?.color, "A2EEEF");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// =============================================================================
// WF-PROJECT: projectBinding cross-references (T6.eval trigger)
//
// These conformance tests pin the contract that the orchestrator and the
// workflow share: every identifier the T6.eval block consumes must be
// declared in the workflow (phases, labelMapping, labels) so the code
// never needs to fabricate a phase or label name. Each failure mode is
// verified via its WF-PROJECT-00N error code — the same codes the
// orchestrator comments reference at runtime.
// =============================================================================

/**
 * Returns a config that, on its own, would load — then the caller adds a
 * projectBinding that triggers the specific WF-PROJECT check under test.
 * The helper adds a labels section with a declared marker sentinel so the
 * default sentinel-role check passes; individual tests override as needed.
 */
function projectBindingConfig(
  extraLabels: Record<
    string,
    { color: string; description: string; role?: "routing" | "marker" }
  > = {},
): Record<string, unknown> {
  const cfg = validConfig();
  cfg.labels = {
    ready: { color: "a2eeef", description: "ready" },
    review: { color: "fbca04", description: "review" },
    done: { color: "0e8a16", description: "done" },
    blocked: { color: "d93f0b", description: "blocked" },
    "project-sentinel": {
      color: "e6e6e6",
      description: "sentinel",
      role: "marker",
    },
    ...extraLabels,
  };
  return cfg;
}

Deno.test(
  "workflow-loader: WF-PROJECT — valid projectBinding loads successfully",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const cfg = projectBindingConfig();
      cfg.projectBinding = {
        inheritProjectsForCreateIssue: false,
        donePhase: "complete",
        evalPhase: "review",
        planPhase: "implementation",
        sentinelLabel: "project-sentinel",
      };
      await writeFixture(dir, cfg);
      const config = await loadWorkflow(dir);
      assertEquals(
        config.projectBinding?.donePhase,
        "complete",
        "projectBinding must be copied through to the loaded config so " +
          "the orchestrator can read it (previous loader dropped it).",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "workflow-loader: WF-PROJECT-001 — donePhase not declared in phases throws",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const cfg = projectBindingConfig();
      cfg.projectBinding = {
        inheritProjectsForCreateIssue: false,
        donePhase: "nonexistent-phase",
        evalPhase: "review",
        planPhase: "implementation",
        sentinelLabel: "project-sentinel",
      };
      await writeFixture(dir, cfg);
      const err = await assertRejects(() => loadWorkflow(dir), Error);
      assertStringIncludes(err.message, "WF-PROJECT-001");
      assertStringIncludes(err.message, "nonexistent-phase");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "workflow-loader: WF-PROJECT-002 — donePhase must be terminal",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const cfg = projectBindingConfig();
      cfg.projectBinding = {
        inheritProjectsForCreateIssue: false,
        donePhase: "review", // actionable, not terminal
        evalPhase: "review",
        planPhase: "review",
        sentinelLabel: "project-sentinel",
      };
      await writeFixture(dir, cfg);
      const err = await assertRejects(() => loadWorkflow(dir), Error);
      assertStringIncludes(err.message, "WF-PROJECT-002");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "workflow-loader: WF-PROJECT-003 — evalPhase not declared in phases throws",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const cfg = projectBindingConfig();
      cfg.projectBinding = {
        inheritProjectsForCreateIssue: false,
        donePhase: "complete",
        evalPhase: "nonexistent-phase",
        planPhase: "implementation",
        sentinelLabel: "project-sentinel",
      };
      await writeFixture(dir, cfg);
      const err = await assertRejects(() => loadWorkflow(dir), Error);
      assertStringIncludes(err.message, "WF-PROJECT-003");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "workflow-loader: WF-PROJECT-004 — evalPhase must be actionable",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const cfg = projectBindingConfig();
      cfg.projectBinding = {
        inheritProjectsForCreateIssue: false,
        donePhase: "complete",
        evalPhase: "complete", // terminal, not actionable
        planPhase: "implementation",
        sentinelLabel: "project-sentinel",
      };
      await writeFixture(dir, cfg);
      const err = await assertRejects(() => loadWorkflow(dir), Error);
      assertStringIncludes(err.message, "WF-PROJECT-004");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "workflow-loader: WF-PROJECT-006 — evalPhase has no label in labelMapping",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const cfg = projectBindingConfig() as Record<string, unknown> & {
        phases: Record<
          string,
          { type: string; priority?: number; agent?: string }
        >;
        labelMapping: Record<string, string>;
        labels?: Record<string, { color: string; description: string }>;
        agents: Record<string, unknown>;
      };
      // Add an actionable phase that has an agent but no labelMapping entry.
      cfg.phases["eval-orphan"] = {
        type: "actionable",
        priority: 3,
        agent: "reviewer",
      };
      cfg.projectBinding = {
        inheritProjectsForCreateIssue: false,
        donePhase: "complete",
        evalPhase: "eval-orphan",
        planPhase: "implementation",
        sentinelLabel: "project-sentinel",
      };
      await writeFixture(dir, cfg);
      const err = await assertRejects(() => loadWorkflow(dir), Error);
      assertStringIncludes(err.message, "WF-PROJECT-006");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "workflow-loader: WF-PROJECT-007 — donePhase has no label in labelMapping",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const cfg = projectBindingConfig() as Record<string, unknown> & {
        phases: Record<string, { type: string; priority?: number }>;
        labelMapping: Record<string, string>;
      };
      // Drop the only labelMapping entry that targets `complete`.
      delete cfg.labelMapping["done"];
      // Add another terminal phase to keep labelMapping.complete references sane.
      cfg.phases["done-orphan"] = { type: "terminal" };
      cfg.projectBinding = {
        inheritProjectsForCreateIssue: false,
        donePhase: "done-orphan",
        evalPhase: "review",
        planPhase: "implementation",
        sentinelLabel: "project-sentinel",
      };
      // labels section validator will also flag missing `done` spec; drop the
      // labels section entirely so validateLabelsSection is bypassed and the
      // WF-PROJECT-007 path is the one exercised.
      delete (cfg as { labels?: unknown }).labels;
      await writeFixture(dir, cfg);
      const err = await assertRejects(() => loadWorkflow(dir), Error);
      assertStringIncludes(err.message, "WF-PROJECT-007");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "workflow-loader: WF-PROJECT-008 — sentinelLabel not declared in labels",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const cfg = projectBindingConfig();
      cfg.projectBinding = {
        inheritProjectsForCreateIssue: false,
        donePhase: "complete",
        evalPhase: "review",
        planPhase: "implementation",
        sentinelLabel: "not-declared-anywhere",
      };
      await writeFixture(dir, cfg);
      const err = await assertRejects(() => loadWorkflow(dir), Error);
      assertStringIncludes(err.message, "WF-PROJECT-008");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "workflow-loader: WF-PROJECT-009 — sentinelLabel must have role=marker",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      // Declare sentinel but as a routing label (the orphan check would
      // then flag it, so also reference it from labelMapping to isolate
      // the WF-PROJECT-009 path).
      const cfg = projectBindingConfig({
        "wrong-role-sentinel": {
          color: "cccccc",
          description: "wrong role",
          role: "routing",
        },
      }) as Record<string, unknown> & {
        labelMapping: Record<string, string>;
      };
      cfg.labelMapping["wrong-role-sentinel"] = "blocked";
      cfg.projectBinding = {
        inheritProjectsForCreateIssue: false,
        donePhase: "complete",
        evalPhase: "review",
        planPhase: "implementation",
        sentinelLabel: "wrong-role-sentinel",
      };
      await writeFixture(dir, cfg);
      const err = await assertRejects(() => loadWorkflow(dir), Error);
      assertStringIncludes(err.message, "WF-PROJECT-009");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "workflow-loader: WF-PROJECT-010 — planPhase not declared in phases throws",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const cfg = projectBindingConfig();
      cfg.projectBinding = {
        inheritProjectsForCreateIssue: false,
        donePhase: "complete",
        evalPhase: "review",
        planPhase: "nonexistent-phase",
        sentinelLabel: "project-sentinel",
      };
      await writeFixture(dir, cfg);
      const err = await assertRejects(() => loadWorkflow(dir), Error);
      assertStringIncludes(err.message, "WF-PROJECT-010");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "workflow-loader: WF-PROJECT-011 — planPhase must be actionable",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const cfg = projectBindingConfig();
      cfg.projectBinding = {
        inheritProjectsForCreateIssue: false,
        donePhase: "complete",
        evalPhase: "review",
        planPhase: "complete", // terminal, not actionable
        sentinelLabel: "project-sentinel",
      };
      await writeFixture(dir, cfg);
      const err = await assertRejects(() => loadWorkflow(dir), Error);
      assertStringIncludes(err.message, "WF-PROJECT-011");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "workflow-loader: WF-PROJECT-013 — planPhase has no label in labelMapping",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      const cfg = projectBindingConfig() as Record<string, unknown> & {
        phases: Record<
          string,
          { type: string; priority?: number; agent?: string }
        >;
      };
      cfg.phases["plan-orphan"] = {
        type: "actionable",
        priority: 3,
        agent: "reviewer",
      };
      cfg.projectBinding = {
        inheritProjectsForCreateIssue: false,
        donePhase: "complete",
        evalPhase: "review",
        planPhase: "plan-orphan",
        sentinelLabel: "project-sentinel",
      };
      await writeFixture(dir, cfg);
      const err = await assertRejects(() => loadWorkflow(dir), Error);
      assertStringIncludes(err.message, "WF-PROJECT-013");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "workflow-loader: WF-PROJECT — absent projectBinding loads successfully (I1)",
  async () => {
    const dir = await Deno.makeTempDir();
    try {
      // No projectBinding at all — cross-ref check must short-circuit.
      // This pins Invariant I1 (design/13_project_orchestration.md §3).
      await writeFixture(dir, validConfig());
      const config = await loadWorkflow(dir);
      assertEquals(
        config.projectBinding,
        undefined,
        "Loader must preserve projectBinding=undefined when absent so the " +
          "orchestrator's I1 guard stays bitwise-equivalent to v1.13.x.",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);
