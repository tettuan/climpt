import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { WorkflowConfig } from "./workflow-types.ts";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
} from "./github-client.ts";
import { StubDispatcher } from "./dispatcher.ts";
import { compensationMarker, Orchestrator } from "./orchestrator.ts";
import { loadWorkflow } from "./workflow-loader.ts";
import { IssueStore } from "./issue-store.ts";

// Design §2.2: one phase transition produces one "add" call (T3) plus
// one "remove" call (T4).
const LABEL_CALLS_PER_TRANSITION = 2;

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
  #commentHistory: {
    issueNumber: number;
    body: string;
    createdAt: string;
  }[] = [];
  #labelUpdates: {
    issueNumber: number;
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
    this.#commentHistory.push({
      issueNumber,
      body: comment,
      createdAt: new Date().toISOString(),
    });
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

  closeIssue(issueNumber: number): Promise<void> {
    this.#closeIssueCalls++;
    if (this.#closeIssueCalls <= this.#closeIssueFailUntil) {
      return Promise.reject(new Error("gh issue close failed (stubbed)"));
    }
    this.#closedIssues.push(issueNumber);
    return Promise.resolve();
  }

  reopenIssue(_issueNumber: number): Promise<void> {
    return Promise.reject(new Error("reopenIssue not implemented"));
  }

  getRecentComments(
    issueNumber: number,
    limit: number,
  ): Promise<{ body: string; createdAt: string }[]> {
    if (limit <= 0) return Promise.resolve([]);
    const filtered = this.#commentHistory
      .filter((c) => c.issueNumber === issueNumber)
      .slice(-limit)
      .reverse()
      .map((c) => ({ body: c.body, createdAt: c.createdAt }));
    return Promise.resolve(filtered);
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

  listLabels(): Promise<string[]> {
    return Promise.resolve([]);
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
    const orchestrator = new Orchestrator(config, github, dispatcher);

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

// =============================================================
// Self-heal + idempotent compensation comment (design.md §3.3)
// =============================================================

/**
 * Workflow config for the self-heal scenario.
 *
 * Derived from `createValidWorkflowJson()` with two adjustments required
 * by the contract under test:
 *   1. `reviewer.closeOnComplete = true` so reaching `complete` fires T6
 *      (the irreversible side-effect whose failure the saga must catch).
 *   2. `reviewer.closeCondition = "approved"` so only the happy reviewer
 *      outcome triggers the close attempt — matches design §2.2 T6.
 */
function createSelfHealWorkflowConfig(): WorkflowConfig {
  const json = createValidWorkflowJson() as unknown as WorkflowConfig;
  // deno-lint-ignore no-explicit-any
  const reviewer = json.agents.reviewer as any;
  reviewer.closeOnComplete = true;
  reviewer.closeCondition = "approved";
  return json;
}

Deno.test(
  "self-heal: T6 failure on cycle 2 recovers on cycle 3 with idempotent compensation comment",
  async () => {
    // Scenario (design.md §3.3 idempotency + orchestrator.ts T6 block):
    //
    //   Run 1 (store-backed, so tracker state + meta labels persist):
    //     Cycle 1  ready  -> review     (T3/T4 commit; tracker count -> 1)
    //     Cycle 2  review -> complete   T6 closeIssue throws
    //                                   -> scope.rollback runs T4-comp
    //                                      (re-add "review") then T3-comp
    //                                      (remove "done"), posts a
    //                                      marker-tagged compensation
    //                                      comment, status="blocked".
    //                                   tracker.record is NOT called, so
    //                                   cycleSeq for this failing cycle
    //                                   is tracker.getCount(1)+1 == 2.
    //
    //   Run 2 (same stub + store, closeIssue now succeeds):
    //     Orchestrator re-loads the persisted tracker (count=1), reads
    //     meta labels ["review"] (rollback left them intact), and
    //     re-enters the same review -> complete transition. cycleSeq is
    //     again count+1 == 2 — identical to run 1's failing cycle, which
    //     is what makes compensationMarker(1, 2) a stable dedup key.
    //     T6 now succeeds, tracker.record fires, commit clears the
    //     pre-registered compensation before it can post. No new
    //     compensation comment is posted — the pre-post getRecentComments
    //     check would have caught it anyway, but the happy path never
    //     reaches that code. Either way: comment count stays at 1.
    //
    // Pattern classification (test-design skill):
    //   - Contract: "T6 failure -> next run self-heals to completed".
    //   - Invariant: "compensation comment count per (issue, cycleSeq)
    //                 remains exactly 1 across retries".

    const tempDir = await Deno.makeTempDir();
    try {
      const config = createSelfHealWorkflowConfig();

      // Pre-seed the store. Labels here are source-of-truth for the
      // orchestrator when a store is wired in (it reads via
      // store.readMeta, not github.getIssueLabels, at cycle start).
      const storePath = `${tempDir}/store`;
      const store = new IssueStore(storePath);
      const issueNumber = 1;
      const initialLabel = "ready";
      await store.writeIssue({
        meta: {
          number: issueNumber,
          title: "self-heal test",
          labels: [initialLabel],
          state: "open",
          assignees: [],
          milestone: null,
        },
        body: "",
        comments: [],
      });

      // GitHub stub: closeIssue fails exactly once (run 1 cycle 2), then
      // succeeds (run 2). Label sequence is only used as a fallback here
      // since the store provides labels; we still supply one entry per
      // possible read to keep the stub honest.
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
      const orchestrator = new Orchestrator(
        config,
        github,
        dispatcher,
        tempDir,
      );

      // =======================================================
      // Run 1: cycle 1 succeeds, cycle 2 T6 fails -> blocked
      // =======================================================
      const first = await orchestrator.run(issueNumber, undefined, store);

      assertEquals(
        first.status,
        "blocked",
        "Precondition: T6 must have failed in run 1 for the self-heal " +
          "scenario to apply. IF status != blocked THEN the invariants " +
          "below are vacuous. Fix: orchestrator.ts T6 catch must set " +
          "blocked + break.",
      );
      // Note: label rollback order and closeIssue call counts are the
      // responsibility of transaction-scope_test.ts (LIFO contract). We
      // do not re-assert them here to keep this test aligned with its
      // stated invariants (self-heal reach + marker idempotency).

      // I-2 setup: marker is posted exactly once in run 1. failingCycleSeq
      // is derived from first.cycleCount + 1 (source of truth: tracker
      // only records on full T3..T6 success, so the failing cycle's seq
      // is count+1) — no bare literal.
      const failingCycleSeq = first.cycleCount + 1;
      const expectedMarker = compensationMarker(issueNumber, failingCycleSeq);
      assertEquals(
        github.comments.length,
        1,
        "Run 1 must post exactly one compensation comment (T6 failure " +
          "-> rollback posts the pre-registered marker comment). " +
          "Fix: orchestrator.ts T6 must scope.record() the compensation " +
          "before invoking closeIssue so rollback() finds it.",
      );
      assertStringIncludes(
        github.comments[0].comment,
        expectedMarker,
        `Compensation comment must embed marker "${expectedMarker}" ` +
          `(from compensationMarker(${issueNumber}, ${failingCycleSeq})) ` +
          "so a subsequent retry can detect+skip re-posting (design §3.3).",
      );

      // =======================================================
      // Run 2: same issue, same stub+store -> self-heal
      // =======================================================
      const second = await orchestrator.run(issueNumber, undefined, store);

      // I-1: Self-heal reachability.
      assertEquals(
        second.status,
        "completed",
        "I-1: IF the transient T6 failure has cleared THEN a second " +
          "run on the same issue must reach completed. Fix: " +
          "orchestrator.ts must re-read state from the store so the " +
          "rollbacked transition is re-entered on retry.",
      );
      assertEquals(
        second.finalPhase,
        "complete",
        "I-1: Self-heal must land on the terminal phase.",
      );
      // I-2: Idempotency invariant (design §3.3) — total compensation
      // comment count across ALL runs remains 1. Run 2 must not post another
      // marker comment even though the same phase transition is
      // re-entered, because (a) the happy path commits the scope and
      // clears the pre-registered compensation, and (b) even if it
      // rolled back, getRecentComments would surface the marker and
      // skip the duplicate post.
      assertEquals(
        github.comments.length,
        1,
        "Compensation comment count must stay at 1 across both runs. " +
          "IF run 2's T6 succeeds THEN scope.commit() clears the " +
          "pre-registered compensation before it can run. " +
          "Fix: orchestrator.ts must register T6's compensation via " +
          "scope.record (not scope.step's post-success factory) and " +
          "call scope.commit() on the happy path so the marker post " +
          "is skipped exactly when we want it skipped.",
      );
      assertStringIncludes(
        github.comments[0].comment,
        expectedMarker,
        "I-2: The surviving marker must be run 1's — identity drift " +
          "would defeat dedup. Fix: compensationMarker must be a pure " +
          "function of (issueNumber, cycleSeq).",
      );

      // I-3: cycleSeq identity across runs — the precondition that
      // makes marker-based dedup possible. Expressed as a relation
      // (not specific counts) so the test exercises the invariant
      // directly (skill: Decision Framework Q2 — relationship, not
      // value).
      assertEquals(
        first.cycleCount + 1,
        second.cycleCount,
        "I-3: failing cycleSeq in run 1 (first.cycleCount + 1) must " +
          "equal recovering cycleSeq in run 2 (second.cycleCount). " +
          "Fix: tracker.record must fire only on full T3..T6 success, " +
          "and the store must persist tracker state between runs.",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);
