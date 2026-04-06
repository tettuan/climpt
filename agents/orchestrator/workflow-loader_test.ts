/**
 * Tests for agents/orchestrator/workflow-loader.ts
 *
 * Covers loadWorkflow() with valid configs, missing files,
 * cross-reference validation failures, and default rules application.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { loadWorkflow } from "./workflow-loader.ts";

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
