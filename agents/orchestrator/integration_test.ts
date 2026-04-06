import { assertEquals, assertRejects } from "@std/assert";
import type { WorkflowConfig } from "./workflow-types.ts";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
} from "./github-client.ts";
import { StubDispatcher } from "./dispatcher.ts";
import { Orchestrator } from "./orchestrator.ts";
import { loadWorkflow } from "./workflow-loader.ts";

// --- Shared workflow config fixture ---

/** Valid workflow config for writing to temp files. */
function createValidWorkflowJson(): Record<string, unknown> {
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
      "from-reviewer": "revision",
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
        outputPhases: {
          approved: "complete",
          rejected: "revision",
        },
        fallbackPhase: "blocked",
      },
    },
    rules: {
      maxCycles: 5,
      cycleDelayMs: 0,
    },
  };
}

// --- Stub GitHubClient (same pattern as orchestrator_test.ts) ---

class StubGitHubClient implements GitHubClient {
  #labelSequence: string[][];
  #callIndex = 0;
  #comments: { issueNumber: number; comment: string }[] = [];
  #labelUpdates: {
    issueNumber: number;
    removed: string[];
    added: string[];
  }[] = [];

  constructor(labelSequence: string[][]) {
    this.#labelSequence = labelSequence;
  }

  getIssueLabels(_issueNumber: number): Promise<string[]> {
    const idx = Math.min(this.#callIndex, this.#labelSequence.length - 1);
    const labels = this.#labelSequence[idx];
    this.#callIndex++;
    return Promise.resolve([...labels]);
  }

  updateIssueLabels(
    issueNumber: number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    this.#labelUpdates.push({
      issueNumber,
      removed: labelsToRemove,
      added: labelsToAdd,
    });
    return Promise.resolve();
  }

  addIssueComment(issueNumber: number, comment: string): Promise<void> {
    this.#comments.push({ issueNumber, comment });
    return Promise.resolve();
  }

  get comments(): { issueNumber: number; comment: string }[] {
    return this.#comments;
  }

  get labelUpdates(): {
    issueNumber: number;
    removed: string[];
    added: string[];
  }[] {
    return this.#labelUpdates;
  }

  get callIndex(): number {
    return this.#callIndex;
  }

  createIssue(
    _title: string,
    _labels: string[],
    _body: string,
  ): Promise<number> {
    return Promise.resolve(999);
  }

  closeIssue(_issueNumber: number): Promise<void> {
    return Promise.resolve();
  }

  listIssues(_criteria: IssueCriteria): Promise<IssueListItem[]> {
    return Promise.resolve([]);
  }

  getIssueDetail(_issueNumber: number): Promise<IssueDetail> {
    return Promise.resolve({
      number: 0,
      title: "",
      body: "",
      labels: [],
      state: "open",
      assignees: [],
      milestone: null,
      comments: [],
    });
  }
}

// =============================================================
// Task #12: Default workflow path
// =============================================================

Deno.test("integration: default workflow path loads and runs single cycle", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tempDir}/.agent`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/.agent/workflow.json`,
      JSON.stringify(createValidWorkflowJson()),
    );

    // Load from default path (.agent/workflow.json)
    const config = await loadWorkflow(tempDir);

    assertEquals(config.version, "1.0.0");
    assertEquals(Object.keys(config.phases).length, 5);

    // Run orchestrator: ready -> review -> done
    const github = new StubGitHubClient([
      ["ready"],
      ["review"],
      ["done"],
    ]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    const result = await orchestrator.run(1);

    assertEquals(result.status, "completed");
    assertEquals(result.finalPhase, "complete");
    assertEquals(result.cycleCount, 2);
    assertEquals(result.history.length, 2);
    assertEquals(result.history[0].from, "implementation");
    assertEquals(result.history[0].to, "review");
    assertEquals(result.history[0].agent, "iterator");
    assertEquals(result.history[1].from, "review");
    assertEquals(result.history[1].to, "complete");
    assertEquals(result.history[1].agent, "reviewer");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("integration: default workflow path applies default rules", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tempDir}/.agent`, { recursive: true });
    const json = createValidWorkflowJson();
    // Omit rules to test defaults
    delete json.rules;
    await Deno.writeTextFile(
      `${tempDir}/.agent/workflow.json`,
      JSON.stringify(json),
    );

    const config = await loadWorkflow(tempDir);

    assertEquals(config.rules.maxCycles, 5);
    assertEquals(config.rules.cycleDelayMs, 10000);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================
// Task #13: Custom workflow path
// =============================================================

Deno.test("integration: custom workflow path loads correctly", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tempDir}/.agent`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/.agent/workflow-custom.json`,
      JSON.stringify(createValidWorkflowJson()),
    );

    // Load from custom path
    const config = await loadWorkflow(tempDir, ".agent/workflow-custom.json");

    assertEquals(config.version, "1.0.0");
    assertEquals(Object.keys(config.phases).length, 5);

    // Run orchestrator with loaded config
    const github = new StubGitHubClient([
      ["ready"],
      ["review"],
      ["done"],
    ]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    const result = await orchestrator.run(1);

    assertEquals(result.status, "completed");
    assertEquals(result.finalPhase, "complete");
    assertEquals(result.cycleCount, 2);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("integration: default path fails when only custom file exists", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tempDir}/.agent`, { recursive: true });
    // Write to custom path only, not the default
    await Deno.writeTextFile(
      `${tempDir}/.agent/workflow-custom.json`,
      JSON.stringify(createValidWorkflowJson()),
    );

    // Loading without explicit path should fail (no default file)
    await assertRejects(
      () => loadWorkflow(tempDir),
      Error,
      "Workflow config not found",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("integration: custom path in nested directory", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tempDir}/config/workflows`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/config/workflows/my-workflow.json`,
      JSON.stringify(createValidWorkflowJson()),
    );

    const config = await loadWorkflow(
      tempDir,
      "config/workflows/my-workflow.json",
    );

    assertEquals(config.version, "1.0.0");

    // Verify it runs correctly
    const github = new StubGitHubClient([["done"]]);
    const dispatcher = new StubDispatcher();
    const orchestrator = new Orchestrator(config, github, dispatcher);

    const result = await orchestrator.run(1);

    assertEquals(result.status, "completed");
    assertEquals(result.finalPhase, "complete");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================
// Task #14: Label prefix isolation
// =============================================================

Deno.test("integration: labelPrefix correctly namespaces labels", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tempDir}/.agent`, { recursive: true });
    const json = createValidWorkflowJson();
    json.labelPrefix = "docs";
    await Deno.writeTextFile(
      `${tempDir}/.agent/workflow.json`,
      JSON.stringify(json),
    );

    const config = await loadWorkflow(tempDir);

    assertEquals(config.labelPrefix, "docs");

    // GitHub returns mixed labels: prefixed workflow + non-workflow
    // Only "docs:ready" should resolve; "bug" and "unrelated" are ignored
    const github = new StubGitHubClient([
      ["docs:ready", "bug", "unrelated"],
      ["docs:review", "bug", "unrelated"],
      ["docs:done", "bug", "unrelated"],
    ]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    const result = await orchestrator.run(1);

    assertEquals(result.status, "completed");
    assertEquals(result.finalPhase, "complete");
    assertEquals(result.cycleCount, 2);

    // Verify label updates use prefixed labels
    assertEquals(github.labelUpdates.length, 2);

    // Cycle 1: remove "docs:ready", add "docs:review"
    // "bug" and "unrelated" should NOT be in labelsToRemove
    assertEquals(github.labelUpdates[0].removed, ["docs:ready"]);
    assertEquals(github.labelUpdates[0].added, ["docs:review"]);

    // Cycle 2: remove "docs:review", add "docs:done"
    assertEquals(github.labelUpdates[1].removed, ["docs:review"]);
    assertEquals(github.labelUpdates[1].added, ["docs:done"]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("integration: different prefixes do not cross-contaminate", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tempDir}/.agent`, { recursive: true });

    // Config A: prefix "docs"
    const jsonA = createValidWorkflowJson();
    jsonA.labelPrefix = "docs";
    await Deno.writeTextFile(
      `${tempDir}/.agent/workflow.json`,
      JSON.stringify(jsonA),
    );
    const configA = await loadWorkflow(tempDir);

    // Config B: prefix "impl"
    const jsonB = createValidWorkflowJson();
    jsonB.labelPrefix = "impl";
    await Deno.writeTextFile(
      `${tempDir}/.agent/workflow.json`,
      JSON.stringify(jsonB),
    );
    const configB = await loadWorkflow(tempDir);

    // Both prefixed labels present on the issue
    // Config A orchestrator should only resolve "docs:ready", ignore "impl:ready"
    const githubA = new StubGitHubClient([
      ["docs:ready", "impl:ready"],
      ["docs:review", "impl:ready"],
      ["docs:done", "impl:ready"],
    ]);
    const dispatcherA = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestratorA = new Orchestrator(configA, githubA, dispatcherA);

    const resultA = await orchestratorA.run(1);

    assertEquals(resultA.status, "completed");
    assertEquals(resultA.finalPhase, "complete");
    assertEquals(resultA.cycleCount, 2);
    // Only docs-prefixed labels should be in updates
    assertEquals(githubA.labelUpdates[0].removed, ["docs:ready"]);
    assertEquals(githubA.labelUpdates[0].added, ["docs:review"]);

    // Config B orchestrator should only resolve "impl:ready", ignore "docs:ready"
    const githubB = new StubGitHubClient([
      ["docs:ready", "impl:ready"],
      ["docs:ready", "impl:review"],
      ["docs:ready", "impl:done"],
    ]);
    const dispatcherB = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestratorB = new Orchestrator(configB, githubB, dispatcherB);

    const resultB = await orchestratorB.run(1);

    assertEquals(resultB.status, "completed");
    assertEquals(resultB.finalPhase, "complete");
    assertEquals(resultB.cycleCount, 2);
    // Only impl-prefixed labels should be in updates
    assertEquals(githubB.labelUpdates[0].removed, ["impl:ready"]);
    assertEquals(githubB.labelUpdates[0].added, ["impl:review"]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("integration: no prefix preserves backward compatibility", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tempDir}/.agent`, { recursive: true });
    const json = createValidWorkflowJson();
    // No labelPrefix set
    await Deno.writeTextFile(
      `${tempDir}/.agent/workflow.json`,
      JSON.stringify(json),
    );

    const config = await loadWorkflow(tempDir);

    assertEquals(config.labelPrefix, undefined);

    // Bare labels (no prefix) should resolve normally
    const github = new StubGitHubClient([
      ["ready"],
      ["review"],
      ["done"],
    ]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    const result = await orchestrator.run(1);

    assertEquals(result.status, "completed");
    assertEquals(result.finalPhase, "complete");
    assertEquals(result.cycleCount, 2);

    // Label updates use bare labels (no prefix)
    assertEquals(github.labelUpdates[0].removed, ["ready"]);
    assertEquals(github.labelUpdates[0].added, ["review"]);
    assertEquals(github.labelUpdates[1].removed, ["review"]);
    assertEquals(github.labelUpdates[1].added, ["done"]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("integration: prefixed labels without matching prefix are ignored", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tempDir}/.agent`, { recursive: true });
    const json = createValidWorkflowJson();
    json.labelPrefix = "docs";
    await Deno.writeTextFile(
      `${tempDir}/.agent/workflow.json`,
      JSON.stringify(json),
    );

    const config = await loadWorkflow(tempDir);

    // Only non-matching labels present: should block (no actionable phase)
    const github = new StubGitHubClient([
      ["impl:ready", "bug", "ready"],
    ]);
    const dispatcher = new StubDispatcher();
    const orchestrator = new Orchestrator(config, github, dispatcher);

    const result = await orchestrator.run(1);

    // "ready" without "docs:" prefix should NOT resolve when prefix is set
    // "impl:ready" does not match "docs:" prefix
    assertEquals(result.status, "blocked");
    assertEquals(result.finalPhase, "unknown");
    assertEquals(result.cycleCount, 0);
    assertEquals(github.labelUpdates.length, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
