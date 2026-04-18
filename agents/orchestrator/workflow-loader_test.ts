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
// Cross-reference: closeCondition validation
// =============================================================================

Deno.test("workflow-loader: closeCondition without closeOnComplete throws WF-REF-005", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.agents as Record<string, unknown>)["reviewer"] = {
      role: "validator",
      outputPhases: { approved: "complete", rejected: "implementation" },
      fallbackPhase: "blocked",
      closeCondition: "approved", // no closeOnComplete
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
      "closeOnComplete",
      "Error should mention closeOnComplete. Fix: config-errors.ts WF-REF-005",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: closeCondition with unknown outcome key throws WF-REF-006", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.agents as Record<string, unknown>)["reviewer"] = {
      role: "validator",
      outputPhases: { approved: "complete", rejected: "implementation" },
      fallbackPhase: "blocked",
      closeOnComplete: true,
      closeCondition: "typo_approved", // not in outputPhases
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
      "Error should include the invalid closeCondition value. Fix: config-errors.ts WF-REF-006",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: valid closeOnComplete and closeCondition loads successfully", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.agents as Record<string, unknown>)["reviewer"] = {
      role: "validator",
      outputPhases: { approved: "complete", rejected: "implementation" },
      fallbackPhase: "blocked",
      closeOnComplete: true,
      closeCondition: "approved",
    };
    await writeFixture(dir, cfg);
    const config = await loadWorkflow(dir);
    assertEquals(config.agents["reviewer"].closeOnComplete, true);
    assertEquals(config.agents["reviewer"].closeCondition, "approved");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workflow-loader: closeOnComplete without closeCondition loads successfully", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cfg = validConfig();
    (cfg.agents as Record<string, unknown>)["reviewer"] = {
      role: "validator",
      outputPhases: { approved: "complete", rejected: "implementation" },
      fallbackPhase: "blocked",
      closeOnComplete: true,
    };
    await writeFixture(dir, cfg);
    const config = await loadWorkflow(dir);
    assertEquals(config.agents["reviewer"].closeOnComplete, true);
    assertEquals(config.agents["reviewer"].closeCondition, undefined);
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
  labels: Record<string, { color: string; description: string }>,
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
