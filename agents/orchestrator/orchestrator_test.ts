import { assertEquals } from "@std/assert";
import type { WorkflowConfig } from "./workflow-types.ts";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
} from "./github-client.ts";
import type { DispatchOutcome } from "./dispatcher.ts";
import { StubDispatcher } from "./dispatcher.ts";
import { Orchestrator } from "./orchestrator.ts";
import { IssueStore } from "./issue-store.ts";

// --- Test fixtures ---

/** Minimal WorkflowConfig matching the design doc example. */
function createTestConfig(): WorkflowConfig {
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
    handoff: {
      commentTemplates: {
        reviewerApproved:
          "[Agent Review Complete] All requirements verified\n{summary}",
        reviewerRejected: "[Agent Review] Gaps found\n{summary}",
      },
    },
  };
}

// --- Stub GitHubClient ---

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

// --- Tests ---

Deno.test("single cycle: implementation -> review -> approved -> complete", async () => {
  const config = createTestConfig();
  // Cycle 1: labels=["ready"] -> iterator dispatched -> transition to "review"
  // Cycle 2: labels=["review"] -> reviewer dispatched (approved) -> transition to "complete"
  // Cycle 3: labels=["done"] -> terminal -> break
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
});

Deno.test("revision cycle: rejected -> revision -> review -> approved -> complete", async () => {
  const config = createTestConfig();
  // Cycle 1: ["ready"] -> iterator -> "review"
  // Cycle 2: ["review"] -> reviewer (rejected) -> "revision"
  // Cycle 3: ["implementation-gap"] -> iterator -> "review"
  // Cycle 4: ["review"] -> reviewer (approved) -> "complete"
  // Cycle 5: ["done"] -> terminal
  const github = new StubGitHubClient([
    ["ready"],
    ["review"],
    ["implementation-gap"],
    ["review"],
    ["done"],
  ]);

  // Reviewer alternates: first call rejected, second call approved
  let reviewerCallCount = 0;
  const dispatcher: StubDispatcher & {
    dispatch: typeof StubDispatcher.prototype.dispatch;
  } = {
    ...new StubDispatcher(),
    dispatch(agentId: string, _issueNumber: number) {
      if (agentId === "reviewer") {
        reviewerCallCount++;
        const outcome = reviewerCallCount === 1 ? "rejected" : "approved";
        return Promise.resolve({ outcome, durationMs: 0 });
      }
      return Promise.resolve({ outcome: "success", durationMs: 0 });
    },
  } as StubDispatcher & { dispatch: typeof StubDispatcher.prototype.dispatch };

  const orchestrator = new Orchestrator(config, github, dispatcher);
  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "complete");
  assertEquals(result.cycleCount, 4);
  assertEquals(result.history[1].from, "review");
  assertEquals(result.history[1].to, "revision");
  assertEquals(result.history[1].outcome, "rejected");
  assertEquals(result.history[3].outcome, "approved");
});

Deno.test("cycle exceeded: always actionable -> hits maxCycles -> cycle_exceeded", async () => {
  const config = createTestConfig();
  config.rules.maxCycles = 2;

  // Labels always resolve to actionable phase "revision" (priority 1)
  const github = new StubGitHubClient([
    ["implementation-gap"],
    ["implementation-gap"],
    ["implementation-gap"],
    ["implementation-gap"],
  ]);
  const dispatcher = new StubDispatcher({ iterator: "success" });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(result.status, "cycle_exceeded");
  assertEquals(result.cycleCount, 2);
});

Deno.test("dry run: no label updates or comments", async () => {
  const config = createTestConfig();
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

  const result = await orchestrator.run(1, { dryRun: true });

  assertEquals(result.status, "completed");
  assertEquals(result.cycleCount, 2);
  assertEquals(github.labelUpdates.length, 0);
  assertEquals(github.comments.length, 0);
});

Deno.test("terminal phase at start: immediate completion", async () => {
  const config = createTestConfig();
  const github = new StubGitHubClient([["done"]]);
  const dispatcher = new StubDispatcher();
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "complete");
  assertEquals(result.cycleCount, 0);
  assertEquals(result.history.length, 0);
});

Deno.test("blocking phase at start: immediate blocked result", async () => {
  const config = createTestConfig();
  const github = new StubGitHubClient([["blocked"]]);
  const dispatcher = new StubDispatcher();
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(result.status, "blocked");
  assertEquals(result.finalPhase, "blocked");
  assertEquals(result.cycleCount, 0);
  assertEquals(result.history.length, 0);
});

Deno.test("no known labels: blocked with unknown phase", async () => {
  const config = createTestConfig();
  const github = new StubGitHubClient([["unknown-label"]]);
  const dispatcher = new StubDispatcher();
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(result.status, "blocked");
  assertEquals(result.finalPhase, "unknown");
  assertEquals(result.cycleCount, 0);
});

Deno.test("verbose mode does not change behavior", async () => {
  const config = createTestConfig();
  const github = new StubGitHubClient([["done"]]);
  const dispatcher = new StubDispatcher();
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1, { verbose: true });

  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "complete");
});

Deno.test("agent failure triggers fallback to blocked", async () => {
  const config = createTestConfig();
  // iterator fails -> fallbackPhase is "blocked" -> terminal/blocking check breaks
  const github = new StubGitHubClient([
    ["ready"],
    ["blocked"],
  ]);
  const dispatcher = new StubDispatcher({ iterator: "failed" });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(result.status, "blocked");
  assertEquals(result.finalPhase, "blocked");
  assertEquals(result.cycleCount, 1);
  assertEquals(result.history[0].from, "implementation");
  assertEquals(result.history[0].to, "blocked");
  assertEquals(result.history[0].outcome, "failed");
});

Deno.test("handoff comments posted on reviewer outcomes", async () => {
  const config = createTestConfig();
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

  await orchestrator.run(1);

  // reviewerApproved template exists and should be posted
  const approvedComments = github.comments.filter((c) =>
    c.comment.includes("[Agent Review Complete]")
  );
  assertEquals(approvedComments.length, 1);
});

Deno.test("full cycle with labelPrefix: prefixed labels resolve and transition correctly", async () => {
  const config = createTestConfig();
  config.labelPrefix = "wf";
  // Labels arrive prefixed from GitHub
  // Cycle 1: ["wf:ready"] -> iterator (success) -> transition to "review"
  // Cycle 2: ["wf:review"] -> reviewer (approved) -> transition to "complete"
  // Cycle 3: ["wf:done"] -> terminal -> break
  const github = new StubGitHubClient([
    ["wf:ready"],
    ["wf:review"],
    ["wf:done"],
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
  // Label updates should use prefixed labels
  assertEquals(github.labelUpdates.length, 2);
  assertEquals(github.labelUpdates[0].removed, ["wf:ready"]);
  assertEquals(github.labelUpdates[0].added, ["wf:review"]);
  assertEquals(github.labelUpdates[1].removed, ["wf:review"]);
  assertEquals(github.labelUpdates[1].added, ["wf:done"]);
});

// === Batch Tests ===

/**
 * Full-featured stub for batch tests.
 * Supports listIssues, getIssueDetail, and per-issue label sequences.
 */
class BatchStubGitHubClient implements GitHubClient {
  #issues: IssueListItem[];
  #details: Map<number, IssueDetail>;
  /** Per-issue label sequences for getIssueLabels. */
  #labelSequences: Map<number, string[][]>;
  #labelCallCounts: Map<number, number> = new Map();
  labelUpdates: {
    issueNumber: number;
    removed: string[];
    added: string[];
  }[] = [];
  commentsCalls: { issueNumber: number; comment: string }[] = [];
  listIssuesCalls: IssueCriteria[] = [];

  constructor(
    issues: IssueListItem[],
    details: Map<number, IssueDetail>,
    labelSequences: Map<number, string[][]>,
  ) {
    this.#issues = issues;
    this.#details = details;
    this.#labelSequences = labelSequences;
  }

  getIssueLabels(issueNumber: number): Promise<string[]> {
    const seq = this.#labelSequences.get(issueNumber) ?? [[]];
    const idx = this.#labelCallCounts.get(issueNumber) ?? 0;
    const labels = seq[Math.min(idx, seq.length - 1)];
    this.#labelCallCounts.set(issueNumber, idx + 1);
    return Promise.resolve([...labels]);
  }

  updateIssueLabels(
    issueNumber: number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    this.labelUpdates.push({
      issueNumber,
      removed: labelsToRemove,
      added: labelsToAdd,
    });
    return Promise.resolve();
  }

  addIssueComment(issueNumber: number, comment: string): Promise<void> {
    this.commentsCalls.push({ issueNumber, comment });
    return Promise.resolve();
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

  listIssues(criteria: IssueCriteria): Promise<IssueListItem[]> {
    this.listIssuesCalls.push(criteria);
    return Promise.resolve(this.#issues);
  }

  getIssueDetail(issueNumber: number): Promise<IssueDetail> {
    const detail = this.#details.get(issueNumber);
    if (detail === undefined) {
      return Promise.reject(new Error(`No detail for #${issueNumber}`));
    }
    return Promise.resolve(detail);
  }
}

function createBatchTestConfig(): WorkflowConfig {
  return {
    version: "1.0.0",
    issueStore: { path: ".agent/issues" },
    prioritizer: {
      agent: "triage-agent",
      labels: ["P1", "P2", "P3"],
      defaultLabel: "P3",
    },
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

/** Helper: create a temp dir with issue store seeded via syncer. */
async function setupBatchStore(
  tmpDir: string,
  issues: { num: number; labels: string[] }[],
): Promise<IssueStore> {
  const storePath = `${tmpDir}/.agent/issues`;
  const store = new IssueStore(storePath);
  for (const issue of issues) {
    // deno-lint-ignore no-await-in-loop
    await store.writeIssue({
      meta: {
        number: issue.num,
        title: `Issue ${issue.num}`,
        labels: issue.labels,
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: `Body of issue ${issue.num}`,
      comments: [],
    });
  }
  return store;
}

Deno.test("runBatch with prioritizeOnly dispatches prioritizer agent", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createBatchTestConfig();
    config.issueStore = { path: ".agent/issues" };

    // Pre-seed store with issues that have labels
    await setupBatchStore(tmpDir, [
      { num: 10, labels: ["ready"] },
      { num: 20, labels: ["ready"] },
    ]);

    const details = new Map<number, IssueDetail>();
    details.set(10, {
      number: 10,
      title: "Issue 10",
      body: "Body 10",
      labels: ["ready"],
      state: "open",
      assignees: [],
      milestone: null,
      comments: [],
    });
    details.set(20, {
      number: 20,
      title: "Issue 20",
      body: "Body 20",
      labels: ["ready"],
      state: "open",
      assignees: [],
      milestone: null,
      comments: [],
    });

    const listItems: IssueListItem[] = [
      { number: 10, title: "Issue 10", labels: ["ready"], state: "open" },
      { number: 20, title: "Issue 20", labels: ["ready"], state: "open" },
    ];

    const labelSeqs = new Map<number, string[][]>();
    const github = new BatchStubGitHubClient(listItems, details, labelSeqs);

    // Track dispatched agent IDs
    const dispatchedAgents: string[] = [];
    const dispatcher = {
      dispatch(
        agentId: string,
        _issueNumber: number,
      ): Promise<DispatchOutcome> {
        dispatchedAgents.push(agentId);
        return Promise.resolve({ outcome: "success", durationMs: 0 });
      },
    };

    // Write a priorities.json for the triage agent to "produce"
    const storePath = `${tmpDir}/.agent/issues`;
    const prioritiesPath = `${storePath}/priorities.json`;
    await Deno.writeTextFile(
      prioritiesPath,
      JSON.stringify([
        { issue: 10, priority: "P1" },
        { issue: 20, priority: "P2" },
      ]),
    );

    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);
    const result = await orchestrator.runBatch({}, { prioritizeOnly: true });

    // Prioritizer agent should have been dispatched
    assertEquals(dispatchedAgents.includes("triage-agent"), true);
    assertEquals(result.status, "completed");
    assertEquals(result.totalIssues, 2);
    assertEquals(result.processed.length, 0);

    // Local store should have updated labels
    const store = new IssueStore(storePath);
    const meta10 = await store.readMeta(10);
    assertEquals(meta10.labels.includes("P1"), true);
    const meta20 = await store.readMeta(20);
    assertEquals(meta20.labels.includes("P2"), true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("runBatch processes issues in priority queue order", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createBatchTestConfig();
    config.issueStore = { path: ".agent/issues" };

    // Pre-seed: issue 10 has P2 + ready, issue 20 has P1 + ready
    // P1 should be processed before P2
    await setupBatchStore(tmpDir, [
      { num: 10, labels: ["ready", "P2"] },
      { num: 20, labels: ["ready", "P1"] },
    ]);

    const details = new Map<number, IssueDetail>();
    details.set(10, {
      number: 10,
      title: "Issue 10",
      body: "Body 10",
      labels: ["ready", "P2"],
      state: "open",
      assignees: [],
      milestone: null,
      comments: [],
    });
    details.set(20, {
      number: 20,
      title: "Issue 20",
      body: "Body 20",
      labels: ["ready", "P1"],
      state: "open",
      assignees: [],
      milestone: null,
      comments: [],
    });

    const listItems: IssueListItem[] = [
      { number: 10, title: "Issue 10", labels: ["ready", "P2"], state: "open" },
      { number: 20, title: "Issue 20", labels: ["ready", "P1"], state: "open" },
    ];

    // Label sequences for getIssueLabels during run():
    // Each issue: first call returns actionable, second returns terminal
    const labelSeqs = new Map<number, string[][]>();
    labelSeqs.set(20, [["ready"], ["done"]]);
    labelSeqs.set(10, [["ready"], ["done"]]);

    const github = new BatchStubGitHubClient(listItems, details, labelSeqs);

    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });

    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);
    const result = await orchestrator.runBatch({});

    assertEquals(result.status, "completed");
    assertEquals(result.processed.length, 2);
    // P1 issue (#20) should be processed first
    assertEquals(result.processed[0].issueNumber, 20);
    assertEquals(result.processed[1].issueNumber, 10);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("runBatch skips non-actionable issues", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createBatchTestConfig();
    config.issueStore = { path: ".agent/issues" };

    // Issue 10 is actionable (ready), issue 20 is terminal (done)
    await setupBatchStore(tmpDir, [
      { num: 10, labels: ["ready", "P1"] },
      { num: 20, labels: ["done"] },
    ]);

    const details = new Map<number, IssueDetail>();
    details.set(10, {
      number: 10,
      title: "Issue 10",
      body: "Body 10",
      labels: ["ready", "P1"],
      state: "open",
      assignees: [],
      milestone: null,
      comments: [],
    });
    details.set(20, {
      number: 20,
      title: "Issue 20",
      body: "Body 20",
      labels: ["done"],
      state: "open",
      assignees: [],
      milestone: null,
      comments: [],
    });

    const listItems: IssueListItem[] = [
      { number: 10, title: "Issue 10", labels: ["ready", "P1"], state: "open" },
      { number: 20, title: "Issue 20", labels: ["done"], state: "open" },
    ];

    const labelSeqs = new Map<number, string[][]>();
    labelSeqs.set(10, [["ready"], ["done"]]);

    const github = new BatchStubGitHubClient(listItems, details, labelSeqs);
    const dispatcher = new StubDispatcher({ iterator: "success" });
    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);

    const result = await orchestrator.runBatch({});

    // Only issue 10 should be processed
    assertEquals(result.processed.length, 1);
    assertEquals(result.processed[0].issueNumber, 10);
    // Issue 20 should be skipped
    assertEquals(result.skipped.length, 1);
    assertEquals(result.skipped[0].issueNumber, 20);
    assertEquals(result.skipped[0].reason, "not actionable");
    assertEquals(result.totalIssues, 2);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("runBatch processes outbox after each agent dispatch", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createBatchTestConfig();
    config.issueStore = { path: ".agent/issues" };

    await setupBatchStore(tmpDir, [
      { num: 10, labels: ["ready", "P1"] },
    ]);

    const details = new Map<number, IssueDetail>();
    details.set(10, {
      number: 10,
      title: "Issue 10",
      body: "Body 10",
      labels: ["ready", "P1"],
      state: "open",
      assignees: [],
      milestone: null,
      comments: [],
    });

    const listItems: IssueListItem[] = [
      { number: 10, title: "Issue 10", labels: ["ready", "P1"], state: "open" },
    ];

    const labelSeqs = new Map<number, string[][]>();
    labelSeqs.set(10, [["ready"], ["done"]]);

    const github = new BatchStubGitHubClient(listItems, details, labelSeqs);

    // Write an outbox action before running
    const outboxDir = `${tmpDir}/.agent/issues/10/outbox`;
    await Deno.mkdir(outboxDir, { recursive: true });
    await Deno.writeTextFile(
      `${outboxDir}/001-comment.json`,
      JSON.stringify({ action: "comment", body: "Agent completed" }),
    );

    const dispatcher = new StubDispatcher({ iterator: "success" });
    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);

    const result = await orchestrator.runBatch({});

    assertEquals(result.processed.length, 1);
    // Outbox comment should have been posted to GitHub
    const commentCalls = github.commentsCalls.filter(
      (c) => c.comment === "Agent completed",
    );
    assertEquals(commentCalls.length, 1);
    assertEquals(commentCalls[0].issueNumber, 10);

    // Outbox should be cleared after processing
    const outboxFiles: string[] = [];
    for await (const entry of Deno.readDir(outboxDir)) {
      outboxFiles.push(entry.name);
    }
    assertEquals(outboxFiles.length, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
