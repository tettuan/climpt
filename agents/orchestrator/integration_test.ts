import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { WorkflowConfig } from "./workflow-types.ts";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
  Project,
  ProjectField,
} from "./github-client.ts";
import type { ProjectFieldValue, ProjectRef } from "./outbox-processor.ts";
import {
  type AgentDispatcher,
  type DispatchOutcome,
  StubDispatcher,
} from "./dispatcher.ts";
import { Orchestrator } from "./orchestrator.ts";
import { loadWorkflow } from "./workflow-loader.ts";
import { SubjectStore } from "./subject-store.ts";
import { buildOrchestratorWithChannels } from "./_test-fixtures.ts";
import { ClimptError, isExecutionError } from "../shared/errors/base.ts";
import { AgentAdaptationChainExhaustedError } from "../shared/errors/flow-errors.ts";
import { AgentQueryError } from "../shared/errors/runner-errors.ts";
import { srEntryNotConfigured } from "../shared/errors/config-errors.ts";
import type { ChannelId, IssueCloseFailedEvent } from "../events/types.ts";

// Design §2.2: one phase transition produces one "add" call (T3) plus
// one "remove" call (T4).
const LABEL_CALLS_PER_TRANSITION = 2;

// --- Shared workflow config fixture ---

/** Valid workflow config for writing to temp files. */
function createValidWorkflowJson(): Record<string, unknown> {
  return {
    version: "1.0.0",
    // T1.1: required IssueSource ADT (12-workflow-config.md §C)
    issueSource: { kind: "ghRepoIssues", projectMembership: "unbound" },
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
  #comments: { subjectId: number; comment: string }[] = [];
  #commentHistory: {
    subjectId: number;
    body: string;
    createdAt: string;
  }[] = [];
  #labelUpdates: {
    subjectId: number;
    removed: string[];
    added: string[];
  }[] = [];
  #closedIssues: number[] = [];
  #closeIssueCalls = 0;
  // Fail the first N closeIssue calls; subsequent calls succeed. Defaults
  // to 0 so existing tests keep their happy-path stub unchanged.
  #closeIssueFailUntil = 0;

  constructor(labelSequence: string[][]) {
    this.#labelSequence = labelSequence;
  }

  getIssueLabels(_subjectId: number): Promise<string[]> {
    const idx = Math.min(this.#callIndex, this.#labelSequence.length - 1);
    const labels = this.#labelSequence[idx];
    this.#callIndex++;
    return Promise.resolve([...labels]);
  }

  updateIssueLabels(
    subjectId: number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    this.#labelUpdates.push({
      subjectId,
      removed: labelsToRemove,
      added: labelsToAdd,
    });
    return Promise.resolve();
  }

  addIssueComment(subjectId: number, comment: string): Promise<void> {
    this.#comments.push({ subjectId, comment });
    this.#commentHistory.push({
      subjectId,
      body: comment,
      createdAt: new Date().toISOString(),
    });
    return Promise.resolve();
  }

  get comments(): { subjectId: number; comment: string }[] {
    return this.#comments;
  }

  get labelUpdates(): {
    subjectId: number;
    removed: string[];
    added: string[];
  }[] {
    return this.#labelUpdates;
  }

  get callIndex(): number {
    return this.#callIndex;
  }

  get closedIssues(): number[] {
    return this.#closedIssues;
  }

  get closeIssueCalls(): number {
    return this.#closeIssueCalls;
  }

  /**
   * Fail the first `n` closeIssue invocations; subsequent calls succeed.
   * Used by the self-heal E2E test to model a transient T6 failure that
   * recovers on the next run. Defaults to 0 (no injected failure).
   */
  setCloseIssueFailUntil(n: number): void {
    this.#closeIssueFailUntil = n;
  }

  createIssue(
    _title: string,
    _labels: string[],
    _body: string,
  ): Promise<number> {
    return Promise.resolve(999);
  }

  closeIssue(subjectId: number): Promise<void> {
    this.#closeIssueCalls++;
    if (this.#closeIssueCalls <= this.#closeIssueFailUntil) {
      return Promise.reject(new Error("gh issue close failed (stubbed)"));
    }
    this.#closedIssues.push(subjectId);
    return Promise.resolve();
  }

  reopenIssue(_subjectId: number): Promise<void> {
    return Promise.reject(new Error("reopenIssue not implemented"));
  }

  getRecentComments(
    subjectId: number,
    limit: number,
  ): Promise<{ body: string; createdAt: string }[]> {
    if (limit <= 0) return Promise.resolve([]);
    const filtered = this.#commentHistory
      .filter((c) => c.subjectId === subjectId)
      .slice(-limit)
      .reverse()
      .map((c) => ({ body: c.body, createdAt: c.createdAt }));
    return Promise.resolve(filtered);
  }

  listIssues(_criteria: IssueCriteria): Promise<IssueListItem[]> {
    return Promise.resolve([]);
  }

  getIssueDetail(_subjectId: number): Promise<IssueDetail> {
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

  listLabels(): Promise<string[]> {
    return Promise.resolve([]);
  }

  listLabelsDetailed(): Promise<
    { name: string; color: string; description: string }[]
  > {
    return Promise.resolve([]);
  }

  createLabel(
    _name: string,
    _color: string,
    _description: string,
  ): Promise<void> {
    return Promise.resolve();
  }

  updateLabel(
    _name: string,
    _color: string,
    _description: string,
  ): Promise<void> {
    return Promise.resolve();
  }

  addIssueToProject(
    _project: ProjectRef,
    _issueNumber: number,
  ): Promise<string> {
    return Promise.resolve("PVTI_stub");
  }
  updateProjectItemField(
    _project: ProjectRef,
    _itemId: string,
    _fieldId: string,
    _value: ProjectFieldValue,
  ): Promise<void> {
    return Promise.resolve();
  }
  closeProject(_project: ProjectRef): Promise<void> {
    return Promise.resolve();
  }
  getProjectItemIdForIssue(): Promise<string | null> {
    return Promise.resolve(null);
  }
  listProjectItems(
    _project: ProjectRef,
  ): Promise<{ id: string; issueNumber: number }[]> {
    return Promise.resolve([]);
  }
  createProjectFieldOption(
    _project: ProjectRef,
    _fieldId: string,
    name: string,
  ): Promise<{ id: string; name: string }> {
    return Promise.resolve({ id: `OPT_${name}`, name });
  }
  getIssueProjects(
    _issueNumber: number,
  ): Promise<Array<{ owner: string; number: number }>> {
    return Promise.resolve([]);
  }
  listUserProjects(_owner: string): Promise<Project[]> {
    return Promise.resolve([]);
  }
  getProject(_project: ProjectRef): Promise<Project> {
    return Promise.resolve({
      id: "PVT_stub",
      number: 0,
      owner: "",
      title: "",
      readme: "",
      shortDescription: null,
      closed: false,
    });
  }
  getProjectFields(_project: ProjectRef): Promise<ProjectField[]> {
    return Promise.resolve([]);
  }
  removeProjectItem(_project: ProjectRef, _itemId: string): Promise<void> {
    return Promise.resolve();
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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

    const result = await orchestrator.run(1);

    assertEquals(result.status, "completed");
    assertEquals(result.finalPhase, "complete");
    assertEquals(result.cycleCount, 2);

    // Label updates are split into T3 (add) then T4 (remove) per design §2.2,
    // so each cycle yields two calls with only prefixed labels in each.
    const transitions = 2; // ready->review, review->done
    assertEquals(
      github.labelUpdates.length,
      transitions * LABEL_CALLS_PER_TRANSITION,
      "Expected 2 transitions × 2 label calls per transition (design §2.2) " +
        "= 4 updates",
    );

    // Cycle 1 T3: add "docs:review"
    assertEquals(github.labelUpdates[0].removed, []);
    assertEquals(github.labelUpdates[0].added, ["docs:review"]);
    // Cycle 1 T4: remove "docs:ready" ("bug", "unrelated" are not touched)
    assertEquals(github.labelUpdates[1].removed, ["docs:ready"]);
    assertEquals(github.labelUpdates[1].added, []);

    // Cycle 2 T3: add "docs:done"
    assertEquals(github.labelUpdates[2].removed, []);
    assertEquals(github.labelUpdates[2].added, ["docs:done"]);
    // Cycle 2 T4: remove "docs:review"
    assertEquals(github.labelUpdates[3].removed, ["docs:review"]);
    assertEquals(github.labelUpdates[3].added, []);
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
    // Only docs-prefixed labels should be in updates.
    // T3 (add) precedes T4 (remove) per design §2.2.
    assertEquals(githubA.labelUpdates[0].removed, []);
    assertEquals(githubA.labelUpdates[0].added, ["docs:review"]);
    assertEquals(githubA.labelUpdates[1].removed, ["docs:ready"]);
    assertEquals(githubA.labelUpdates[1].added, []);

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
    // Only impl-prefixed labels should be in updates.
    // T3 (add) precedes T4 (remove) per design §2.2.
    assertEquals(githubB.labelUpdates[0].removed, []);
    assertEquals(githubB.labelUpdates[0].added, ["impl:review"]);
    assertEquals(githubB.labelUpdates[1].removed, ["impl:ready"]);
    assertEquals(githubB.labelUpdates[1].added, []);
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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

    const result = await orchestrator.run(1);

    assertEquals(result.status, "completed");
    assertEquals(result.finalPhase, "complete");
    assertEquals(result.cycleCount, 2);

    // Label updates use bare labels (no prefix), split T3 (add) then T4
    // (remove) per design §2.2 — two calls per transition.
    const transitions = 2; // ready->review, review->done
    assertEquals(
      github.labelUpdates.length,
      transitions * LABEL_CALLS_PER_TRANSITION,
      "Expected 2 transitions × 2 label calls per transition (design §2.2) " +
        "= 4 updates",
    );
    assertEquals(github.labelUpdates[0].removed, []);
    assertEquals(github.labelUpdates[0].added, ["review"]);
    assertEquals(github.labelUpdates[1].removed, ["ready"]);
    assertEquals(github.labelUpdates[1].added, []);
    assertEquals(github.labelUpdates[2].removed, []);
    assertEquals(github.labelUpdates[2].added, ["done"]);
    assertEquals(github.labelUpdates[3].removed, ["review"]);
    assertEquals(github.labelUpdates[3].added, []);
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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

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

// =============================================================
// Self-heal + idempotent compensation comment (design.md §3.3)
// =============================================================

/**
 * Workflow config for the self-heal scenario.
 *
 * Derived from `createValidWorkflowJson()` with two adjustments required
 * by the contract under test:
 *   1. `reviewer.closeBinding.primary.kind = "direct"` so reaching
 *      `complete` fires T6 (the irreversible side-effect whose failure
 *      the saga must catch).
 *   2. `reviewer.closeBinding.condition = "approved"` so only the happy
 *      reviewer outcome triggers the close attempt — matches design §2.2 T6.
 */
function createSelfHealWorkflowConfig(): WorkflowConfig {
  const json = createValidWorkflowJson() as unknown as WorkflowConfig;
  // deno-lint-ignore no-explicit-any
  const reviewer = json.agents.reviewer as any;
  reviewer.closeBinding = {
    primary: { kind: "direct" },
    cascade: false,
    condition: "approved",
  };
  return json;
}

Deno.test(
  "W13 self-heal: close failure leaves labels committed, comp comment posted; " +
    "next run with restored close succeeds without duplicate comment",
  async () => {
    // PR4-2b — W13 contract (To-Be 41 §D):
    //
    //   Run 1 (store-backed):
    //     Cycle 1  ready  -> review              (forward only)
    //     Cycle 2  review -> complete            T6 close throws
    //                                            -> labels stay committed
    //                                               (no rollback under W13)
    //                                            -> CompensationCommentChannel
    //                                               posts marker comment
    //                                            -> status stays "completed"
    //                                               (target phase is terminal)
    //
    //   Run 2 (same stub + store, closeIssue succeeds):
    //     Orchestrator re-reads meta labels ["done"] (W13 left them
    //     committed). Early terminal detection fires — no agent
    //     dispatched, no DirectClose invocation. Comment count remains
    //     unchanged because no new IssueCloseFailedEvent was published.
    //
    // Invariants:
    //   - I-1: Run 1 status reaches "completed" (W13 acceptance).
    //   - I-2: Run 1 posts exactly one compensation comment with a
    //          (subjectId, runId) marker.
    //   - I-3: Run 2 sees no additional compensation comment.

    const tempDir = await Deno.makeTempDir();
    try {
      const config = createSelfHealWorkflowConfig();

      const storePath = `${tempDir}/store`;
      const store = new SubjectStore(storePath);
      const subjectId = 1;
      const initialLabel = "ready";
      await store.writeIssue({
        meta: {
          number: subjectId,
          title: "self-heal test",
          labels: [initialLabel],
          state: "open",
          assignees: [],
          milestone: null,
        },
        body: "",
        comments: [],
      });

      const github = new StubGitHubClient([
        [initialLabel],
        ["review"],
        ["review"],
        ["done"],
      ]);
      github.setCloseIssueFailUntil(1);

      const dispatcher = new StubDispatcher({
        iterator: "success",
        reviewer: "approved",
      });
      const { orchestrator: orchestrator1 } = buildOrchestratorWithChannels({
        config,
        github,
        dispatcher,
        cwd: tempDir,
        runId: "self-heal-run-1",
      });

      // =======================================================
      // Run 1: cycle 1 succeeds, cycle 2 close fails (W13 no rollback)
      // =======================================================
      const first = await orchestrator1.run(subjectId, undefined, store);

      assertEquals(
        first.status,
        "completed",
        "W13: cycle status reflects target-phase reachability, not close " +
          'outcome. Fix: orchestrator must NOT set status="blocked" when ' +
          "DirectCloseChannel.execute throws.",
      );
      assertEquals(
        github.comments.length,
        1,
        "Run 1 must post exactly one compensation comment via " +
          "CompensationCommentChannel (W13 comment-only compensation). " +
          "Fix: BootKernel must register the channel and DirectCloseChannel " +
          "must publish IssueCloseFailedEvent on transport throw.",
      );
      const expectedMarker =
        `climpt-compensation:subject-${subjectId}:run-self-heal-run-1`;
      assertStringIncludes(
        github.comments[0].comment,
        expectedMarker,
        `W13 marker must include (subjectId, runId): "${expectedMarker}".`,
      );

      // =======================================================
      // Run 2: labels committed -> early terminal detection -> completed
      // =======================================================
      const { orchestrator: orchestrator2 } = buildOrchestratorWithChannels({
        config,
        github,
        dispatcher,
        cwd: tempDir,
        runId: "self-heal-run-2",
      });
      const second = await orchestrator2.run(subjectId, undefined, store);

      assertEquals(
        second.status,
        "completed",
        "Run 2 must reach completed via early terminal detection — labels " +
          "were committed in run 1 and never rolled back (W13).",
      );
      assertEquals(
        second.finalPhase,
        "complete",
        "Self-heal must land on the terminal phase (W13 cycle status).",
      );
      assertEquals(
        github.comments.length,
        1,
        "Compensation comment count stays at 1 across both runs — run 2 " +
          "does not invoke the close channel because early terminal " +
          "detection fires before agent dispatch.",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// F4 — Orchestrator catch+route for ExecutionError-class throws from dispatch
// (framework-design/02-orchestrator-catch-route.md §4 + design 16 §C +
// `agents/shared/errors/base.ts` ExecutionErrorMarker)
// ---------------------------------------------------------------------------

/**
 * Test dispatcher that rejects every dispatch with the supplied error.
 * Local to integration_test because the throw scenario is F4-specific —
 * `StubDispatcher` is the canonical happy-path fixture and must stay
 * non-throwing for every other test that uses it.
 */
class ThrowingDispatcher implements AgentDispatcher {
  constructor(readonly error: unknown) {}
  dispatch(
    _agentId: string,
    _subjectId: string | number,
  ): Promise<DispatchOutcome> {
    return Promise.reject(this.error);
  }
}

/**
 * Workflow config sized for a single dispatch cycle.
 *
 * The throwing-dispatcher tests need exactly one phase resolution → one
 * dispatch attempt → catch path. Reuses the self-heal config because it
 * already declares `iterator` and `reviewer` and a `direct` close binding;
 * the close binding is irrelevant here (the throw stops execution before
 * the close decision is reached) but keeps fixture surface stable.
 */
function createF4WorkflowConfig(): WorkflowConfig {
  return createSelfHealWorkflowConfig();
}

/**
 * Mapping from `ClosePrimary.kind` to `ChannelId`. Mirrors the production
 * mapping that channel modules use (`agents/channels/direct-close.ts:184`
 * publishes channel="D" when primary.kind==="direct"; etc.). Test
 * fixtures derive expected channel ids through this helper so a change
 * to the production mapping surfaces here as a contract drift, rather
 * than letting hardcoded literals mask the drift.
 *
 * `none` is intentionally unmapped — it means the agent has no close
 * primary so no channel publish should occur.
 */
function closePrimaryToChannelId(
  kind: "direct" | "boundary" | "outboxPre" | "custom" | "none",
): ChannelId {
  switch (kind) {
    case "direct":
      return "D";
    case "boundary":
      return "E";
    case "outboxPre":
      return "C";
    case "custom":
      return "U";
    case "none":
      throw new Error(
        `closePrimaryToChannelId: "none" has no associated ChannelId. ` +
          `Test fixture must declare a close primary to assert channel id.`,
      );
  }
}

Deno.test(
  "F4 positive: dispatcher throws AgentAdaptationChainExhaustedError → " +
    "IssueCloseFailedEvent published, status=blocked, no retry",
  async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const config = createF4WorkflowConfig();
      const subjectId = 42;
      const expectedRunId = "f4-positive-run-id";

      // Source-of-truth: construct the real error to read .code from the
      // class itself rather than hardcoding the SCREAMING_SNAKE_CASE
      // literal in the assertion.
      const err = new AgentAdaptationChainExhaustedError(
        "closure-step",
        3,
        "narrow-scope",
      );
      const expectedReason = err.code;
      // Source-of-truth: derive the expected channel from the same
      // (closeBinding.primary.kind → ChannelId) mapping the orchestrator
      // catch uses. The F4 catch publishes channel="D" because the
      // closure-step primary is "direct" (matching the production
      // mapping in `agents/channels/direct-close.ts`). If the workflow
      // changes its primary, this derivation surfaces the drift instead
      // of letting a hardcoded literal mask it.
      const reviewerBinding = config.agents.reviewer.closeBinding;
      assertEquals(
        reviewerBinding?.primary.kind,
        "direct",
        `F4 setup: workflow's reviewer agent must declare ` +
          `closeBinding.primary.kind="direct" so the F4 channel mapping ` +
          `resolves to "D". Fix: createSelfHealWorkflowConfig must set ` +
          `primary.kind to "direct".`,
      );
      const expectedChannel = closePrimaryToChannelId(
        reviewerBinding!.primary.kind,
      );

      const dispatcher = new ThrowingDispatcher(err);
      const github = new StubGitHubClient([["ready"]]);
      const collected: IssueCloseFailedEvent[] = [];

      const { orchestrator } = buildOrchestratorWithChannels({
        config,
        github,
        dispatcher,
        cwd: tempDir,
        runId: expectedRunId,
        subscribe: (bus) => {
          bus.subscribe<IssueCloseFailedEvent>(
            { kind: "issueCloseFailed" },
            (event) => {
              collected.push(event);
            },
          );
        },
      });

      const result = await orchestrator.run(subjectId);

      // Invariant 1: exactly one IssueCloseFailedEvent published.
      // What: cardinality of issueCloseFailed events.
      // Where: agents/orchestrator/orchestrator.ts dispatch catch block.
      // How-to-fix: ensure publish runs exactly once on the catch branch.
      assertEquals(
        collected.length,
        1,
        `F4 positive: orchestrator must publish IssueCloseFailedEvent ` +
          `exactly once when dispatcher throws ` +
          `AgentAdaptationChainExhaustedError ` +
          `(observed=${collected.length}, channel=${expectedChannel}, ` +
          `phase=${result.finalPhase}). ` +
          `Fix: agents/orchestrator/orchestrator.ts catch block must ` +
          `publish before the cycle break.`,
      );

      // Invariant 2: payload field mapping per spec §3.3.
      const evt = collected[0];
      assertEquals(
        evt.channel,
        expectedChannel,
        `F4 positive: channel must be "${expectedChannel}" (DirectClose, ` +
          `closure-step primary). Observed=${evt.channel}. ` +
          `Fix: catch block publish hardcodes channel "D".`,
      );
      assertEquals(
        evt.reason,
        expectedReason,
        `F4 positive: reason must be ClimptError.code, not message. ` +
          `Expected=${expectedReason}, observed=${evt.reason}. ` +
          `Fix: orchestrator catch publishes \`reason: error.code\`.`,
      );
      assertEquals(
        evt.subjectId,
        subjectId,
        `F4 positive: subjectId must round-trip from the cycle. ` +
          `Expected=${subjectId}, observed=${String(evt.subjectId)}. ` +
          `Fix: catch block forwards the loop-local subjectId.`,
      );
      assertEquals(
        evt.runId,
        expectedRunId,
        `F4 positive: runId must match the orchestrator's bound runId. ` +
          `Expected=${expectedRunId}, observed=${evt.runId}. ` +
          `Fix: catch block publishes \`runId: this.#runId ?? ""\`.`,
      );

      // Invariant 3: phase transitions to blocked.
      assertEquals(
        result.status,
        "blocked",
        `F4 positive: OrchestratorResult.status must be "blocked" when ` +
          `dispatcher throws non-recoverable ClimptError. ` +
          `Observed=${result.status}, phase=${result.finalPhase}, ` +
          `code=${expectedReason}. ` +
          `Fix: catch block must \`status = "blocked"; break\`.`,
      );

      // Invariant 4: no retry / no re-dispatch in same cycle. The catch
      // breaks before tracker.record runs, so cycleCount and history
      // stay zero — this is the dead-letter assertion.
      assertEquals(
        result.cycleCount,
        0,
        `F4 positive: dead-letter — no cycle is recorded after the throw ` +
          `(observed=${result.cycleCount}). ` +
          `Fix: ensure \`break\` exits before \`tracker.record\`.`,
      );
      assertEquals(
        result.history.length,
        0,
        `F4 positive: dead-letter — no transition history ` +
          `(observed=${result.history.length}). ` +
          `Fix: ensure cycle exits before transition records.`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "F4 negative: dispatcher throws non-ClimptError → catch is selective, " +
    "error propagates, no IssueCloseFailedEvent published",
  async () => {
    // Contradiction-verification: prove the catch is selective. Plain
    // Error is not ClimptError, so the discriminator fails and the catch
    // rethrows. BatchRunner's generic catch (skipped[]) is the
    // downstream sink for this case; here we observe the rethrow at the
    // orchestrator boundary and the absence of the F4 event.
    const tempDir = await Deno.makeTempDir();
    try {
      const config = createF4WorkflowConfig();
      const subjectId = 43;
      const expectedRunId = "f4-negative-run-id";

      const dispatcher = new ThrowingDispatcher(
        new Error("not a ClimptError"),
      );
      const github = new StubGitHubClient([["ready"]]);
      const collected: IssueCloseFailedEvent[] = [];

      const { orchestrator } = buildOrchestratorWithChannels({
        config,
        github,
        dispatcher,
        cwd: tempDir,
        runId: expectedRunId,
        subscribe: (bus) => {
          bus.subscribe<IssueCloseFailedEvent>(
            { kind: "issueCloseFailed" },
            (event) => {
              collected.push(event);
            },
          );
        },
      });

      await assertRejects(
        () => orchestrator.run(subjectId),
        Error,
        "not a ClimptError",
        `F4 negative: non-ClimptError throws must NOT be absorbed by ` +
          `the F4 catch. They escape so BatchRunner can record skipped[]. ` +
          `Fix: discriminator must be ` +
          `\`instanceof ClimptError && !recoverable\` (selective).`,
      );

      assertEquals(
        collected.length,
        0,
        `F4 negative: no IssueCloseFailedEvent must be published for ` +
          `non-ClimptError throws (observed=${collected.length}). ` +
          `Fix: tighten the catch discriminator so non-ClimptError ` +
          `bypasses the publish branch.`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "F4 negative 2: dispatcher throws recoverable ClimptError → catch is " +
    "selective on !recoverable, error propagates, no IssueCloseFailedEvent",
  async () => {
    // Contradiction-verification: prove the `!recoverable` half of the
    // discriminator is selective. `AgentQueryError` is a real concrete
    // ClimptError subclass with `recoverable = true`. The catch matches
    // `instanceof ClimptError` but the !recoverable guard rejects, so
    // the error rethrows verbatim and no F4 event is published.
    const tempDir = await Deno.makeTempDir();
    try {
      const config = createF4WorkflowConfig();
      const subjectId = 44;
      const expectedRunId = "f4-negative-2-run-id";

      const recoverableErr: ClimptError = new AgentQueryError(
        "transient SDK query failure",
      );
      // Sanity: source-of-truth check — the pin only holds while the
      // class stays recoverable. If a future refactor flips this, the
      // test surfaces the regression here rather than in the assertions.
      assertEquals(
        recoverableErr.recoverable,
        true,
        `F4 negative 2 setup: AgentQueryError must be recoverable for ` +
          `this contradiction-verification case; observed=${recoverableErr.recoverable}.`,
      );

      const dispatcher = new ThrowingDispatcher(recoverableErr);
      const github = new StubGitHubClient([["ready"]]);
      const collected: IssueCloseFailedEvent[] = [];

      const { orchestrator } = buildOrchestratorWithChannels({
        config,
        github,
        dispatcher,
        cwd: tempDir,
        runId: expectedRunId,
        subscribe: (bus) => {
          bus.subscribe<IssueCloseFailedEvent>(
            { kind: "issueCloseFailed" },
            (event) => {
              collected.push(event);
            },
          );
        },
      });

      await assertRejects(
        () => orchestrator.run(subjectId),
        AgentQueryError,
        "transient SDK query failure",
        `F4 negative 2: recoverable ClimptError must NOT be absorbed by ` +
          `the F4 catch (only \`!recoverable\` lands there). ` +
          `Fix: discriminator must include \`!error.recoverable\`.`,
      );

      assertEquals(
        collected.length,
        0,
        `F4 negative 2: no IssueCloseFailedEvent must be published for ` +
          `recoverable ClimptError throws (observed=${collected.length}). ` +
          `Fix: tighten the catch discriminator with \`!recoverable\`.`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "F4 negative 3: dispatcher throws non-recoverable ConfigError → catch is " +
    "selective on ExecutionError marker, error propagates, no event",
  async () => {
    // P0-2 contract: per design 16 §C lines 175-177 ("Boot 段階で reject ...
    // AgentRuntime は起動しない"), ConfigurationError MUST NOT reach the
    // F4 channel-D egress. The marker-interface discriminator
    // `isExecutionError(err)` rejects ConfigError even though it is
    // `recoverable=false`. This is the regression case for the previous
    // broad `instanceof ClimptError && !recoverable` discriminator,
    // which would have wrongly absorbed ConfigError into channel="D".
    const tempDir = await Deno.makeTempDir();
    try {
      const config = createF4WorkflowConfig();
      const subjectId = 45;
      const expectedRunId = "f4-negative-3-run-id";

      // Source-of-truth: a real ConfigError factory, so the test
      // exercises the actual ConfigError class shape.
      const configErr = srEntryNotConfigured();
      // Pin invariants: ConfigError must be non-recoverable AND must
      // NOT carry the ExecutionError marker. If a future refactor flips
      // either, this surfaces it before the assertions below.
      assertEquals(
        configErr.recoverable,
        false,
        `F4 negative 3 setup: ConfigError must be recoverable=false for ` +
          `this case to test the marker discriminator (broad discriminator ` +
          `would absorb it). Observed=${configErr.recoverable}.`,
      );
      assertEquals(
        isExecutionError(configErr),
        false,
        `F4 negative 3 setup: ConfigError must NOT carry the ` +
          `ExecutionErrorMarker (design 16 §C: ConfigurationError reject ` +
          `at Boot, never runtime). Fix: do not tag ConfigError with ` +
          `\`executionFailure: true\`.`,
      );

      const dispatcher = new ThrowingDispatcher(configErr);
      const github = new StubGitHubClient([["ready"]]);
      const collected: IssueCloseFailedEvent[] = [];

      const { orchestrator } = buildOrchestratorWithChannels({
        config,
        github,
        dispatcher,
        cwd: tempDir,
        runId: expectedRunId,
        subscribe: (bus) => {
          bus.subscribe<IssueCloseFailedEvent>(
            { kind: "issueCloseFailed" },
            (event) => {
              collected.push(event);
            },
          );
        },
      });

      // The error escapes the F4 catch (BatchRunner sink is the
      // canonical recorder for ConfigurationError that erroneously
      // reaches runtime — operator gets a stack trace, not a
      // compensation comment).
      await assertRejects(
        () => orchestrator.run(subjectId),
        ClimptError,
        configErr.code,
        `F4 negative 3: non-recoverable ConfigError must NOT be absorbed ` +
          `by the F4 catch (design 16 §C — Boot reject category). ` +
          `Fix: discriminator must use isExecutionError, not ` +
          `\`instanceof ClimptError && !recoverable\`.`,
      );
      assertEquals(
        collected.length,
        0,
        `F4 negative 3: no IssueCloseFailedEvent must be published for ` +
          `ConfigError throws (observed=${collected.length}). ` +
          `Fix: marker-interface discriminator rejects ConfigError.`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);

Deno.test(
  "F4 idempotence: re-running orchestrator after F4 break re-dispatches " +
    "and re-emits the event (no durable state recorded)",
  async () => {
    // P2-8 contract: F4 catch breaks before `tracker.record` runs
    // (consistent with rate-limit retry at orchestrator.ts:946 and T3-T5
    // failure paths at :1075/:1103/:1134, all of which also skip
    // record-before-break). So a second `orchestrator.run(subjectId)`
    // call is NOT short-circuited by durable state — the dispatcher is
    // invoked again and the same throw produces a second
    // IssueCloseFailedEvent. This test pins that behavior so any future
    // change to the F4 break path's durability surfaces here, rather
    // than as a downstream symptom.
    const tempDir = await Deno.makeTempDir();
    try {
      const config = createF4WorkflowConfig();
      const subjectId = 46;
      const expectedRunId = "f4-idempotence-run-id";

      const err = new AgentAdaptationChainExhaustedError(
        "closure-step",
        2,
        "narrow-scope",
      );
      const dispatcher = new ThrowingDispatcher(err);
      const github = new StubGitHubClient([["ready"], ["ready"]]);
      const collected: IssueCloseFailedEvent[] = [];

      const { orchestrator } = buildOrchestratorWithChannels({
        config,
        github,
        dispatcher,
        cwd: tempDir,
        runId: expectedRunId,
        subscribe: (bus) => {
          bus.subscribe<IssueCloseFailedEvent>(
            { kind: "issueCloseFailed" },
            (event) => {
              collected.push(event);
            },
          );
        },
      });

      const first = await orchestrator.run(subjectId);
      const second = await orchestrator.run(subjectId);

      // Both runs MUST end with status=blocked.
      assertEquals(
        first.status,
        "blocked",
        `F4 idempotence run 1: status must be "blocked" ` +
          `(observed=${first.status}). Fix: ensure F4 catch sets ` +
          `status="blocked" before break.`,
      );
      assertEquals(
        second.status,
        "blocked",
        `F4 idempotence run 2: status must be "blocked" again — F4 ` +
          `break does not record durable state, so the same dispatch ` +
          `re-runs and the same throw is caught (observed=${second.status}). ` +
          `Fix: see comment in F4 catch block at orchestrator.ts; ` +
          `record-before-break would change this contract.`,
      );

      // Each run published EXACTLY one IssueCloseFailedEvent.
      assertEquals(
        collected.length,
        2,
        `F4 idempotence: re-running orchestrator after F4 must dispatch ` +
          `again and emit a SECOND IssueCloseFailedEvent ` +
          `(observed=${collected.length}). Fix: confirm F4 catch does ` +
          `not call tracker.record (design intent — consistent with ` +
          `rate-limit retry and T3-T5 failure paths).`,
      );
      assertEquals(
        collected[0].reason,
        err.code,
        `F4 idempotence run 1 reason field`,
      );
      assertEquals(
        collected[1].reason,
        err.code,
        `F4 idempotence run 2 reason field`,
      );

      // history/cycleCount stay zero across both runs (the throw kills
      // the cycle before tracker.record).
      assertEquals(
        first.cycleCount + second.cycleCount,
        0,
        `F4 idempotence: cycleCount must be zero across both runs ` +
          `(observed=${first.cycleCount + second.cycleCount}). ` +
          `Fix: verify tracker.record is never reached in F4 catch.`,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);
