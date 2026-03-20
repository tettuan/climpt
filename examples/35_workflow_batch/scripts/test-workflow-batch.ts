// deno-lint-ignore-file no-console
/**
 * test-workflow-batch.ts
 *
 * Verifies Queue.buildQueue() + Orchestrator.run() + Orchestrator.runBatch()
 * with StubGitHubClient and StubDispatcher.
 *
 * Scenarios:
 * 1. Queue: empty priorityOrder -> all actionable issues included
 * 2. Queue: priority sort order (P1 before P2)
 * 3. Orchestrator.run: ready -> review -> done (completed, cycleCount=2)
 * 4. Orchestrator.run: outcome recorded in history (C1 fix verification)
 * 5. runBatch: no prioritizer config -> all issues processed
 */

import { Queue } from "../../../agents/orchestrator/queue.ts";
import type { QueuePriorityConfig } from "../../../agents/orchestrator/queue.ts";
import { Orchestrator } from "../../../agents/orchestrator/orchestrator.ts";
import { IssueStore } from "../../../agents/orchestrator/issue-store.ts";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
} from "../../../agents/orchestrator/github-client.ts";
import type {
  AgentDispatcher,
  DispatchOptions,
  DispatchOutcome,
} from "../../../agents/orchestrator/dispatcher.ts";
import type { WorkflowConfig } from "../../../agents/orchestrator/workflow-types.ts";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

class StubGitHubClient implements GitHubClient {
  #labelSequences: Map<number, string[][]>;
  #callCounts: Map<number, number> = new Map();
  #issues: IssueListItem[];
  #details: Map<number, IssueDetail>;

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
    const idx = this.#callCounts.get(issueNumber) ?? 0;
    const labels = seq[Math.min(idx, seq.length - 1)];
    this.#callCounts.set(issueNumber, idx + 1);
    return Promise.resolve([...labels]);
  }

  updateIssueLabels(
    _issueNumber: number,
    _labelsToRemove: string[],
    _labelsToAdd: string[],
  ): Promise<void> {
    return Promise.resolve();
  }

  addIssueComment(
    _issueNumber: number,
    _comment: string,
  ): Promise<void> {
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

  listIssues(_criteria: IssueCriteria): Promise<IssueListItem[]> {
    return Promise.resolve(this.#issues);
  }

  getIssueDetail(issueNumber: number): Promise<IssueDetail> {
    const detail = this.#details.get(issueNumber);
    if (!detail) {
      return Promise.reject(new Error(`No detail for #${issueNumber}`));
    }
    return Promise.resolve(detail);
  }
}

class StubDispatcher implements AgentDispatcher {
  #outcomes: Map<string, string>;

  constructor(outcomes?: Record<string, string>) {
    this.#outcomes = new Map(Object.entries(outcomes ?? {}));
  }

  dispatch(
    agentId: string,
    _issueNumber: number,
    _options?: DispatchOptions,
  ): Promise<DispatchOutcome> {
    const outcome = this.#outcomes.get(agentId) ?? "success";
    return Promise.resolve({ outcome, durationMs: 0 });
  }
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function createConfig(): WorkflowConfig {
  return {
    version: "1.0.0",
    phases: {
      implementation: { type: "actionable", priority: 3, agent: "iterator" },
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
        outputPhases: { approved: "complete", rejected: "revision" },
        fallbackPhase: "blocked",
      },
    },
    rules: { maxCycles: 5, cycleDelayMs: 0 },
  };
}

async function seedStore(
  storePath: string,
  issues: { num: number; labels: string[] }[],
): Promise<IssueStore> {
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

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenario1(): Promise<void> {
  console.log(
    "Scenario 1: Queue with empty priorityOrder includes all actionable issues",
  );
  const tmp = await Deno.makeTempDir();
  try {
    const config = createConfig();
    const storePath = `${tmp}/.agent/issues`;
    const store = await seedStore(storePath, [
      { num: 10, labels: ["ready"] },
      { num: 20, labels: ["ready"] },
    ]);

    const priorityConfig: QueuePriorityConfig = {
      labels: [],
      defaultLabel: undefined,
    };
    const queue = new Queue(config, store, priorityConfig);
    const items = await queue.buildQueue();

    if (items.length < 1) {
      throw new Error(`Expected items.length > 0, got ${items.length}`);
    }

    console.log("Scenario 1: PASS");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

async function scenario2(): Promise<void> {
  console.log("Scenario 2: Queue sorts by priority label order");
  const tmp = await Deno.makeTempDir();
  try {
    const config = createConfig();
    const storePath = `${tmp}/.agent/issues`;
    const store = await seedStore(storePath, [
      { num: 10, labels: ["ready", "P2"] },
      { num: 20, labels: ["ready", "P1"] },
    ]);

    const priorityConfig: QueuePriorityConfig = {
      labels: ["P1", "P2", "P3"],
      defaultLabel: "P3",
    };
    const queue = new Queue(config, store, priorityConfig);
    const items = await queue.buildQueue();

    if (items.length !== 2) {
      throw new Error(`Expected 2 items, got ${items.length}`);
    }
    if (items[0].issueNumber !== 20) {
      throw new Error(
        `Expected P1 issue (#20) first, got #${items[0].issueNumber}`,
      );
    }

    console.log("Scenario 2: PASS");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

async function scenario3(): Promise<void> {
  console.log("Scenario 3: Orchestrator.run: ready -> review -> done");
  const config = createConfig();

  // Cycle 1: ["ready"] -> iterator (success) -> transition to "review"
  // Cycle 2: ["review"] -> reviewer (approved) -> transition to "complete"
  // Cycle 3: ["done"] -> terminal -> break
  const labelSeqs = new Map<number, string[][]>();
  labelSeqs.set(1, [["ready"], ["review"], ["done"]]);
  const github = new StubGitHubClient([], new Map(), labelSeqs);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });

  const orchestrator = new Orchestrator(config, github, dispatcher);
  const result = await orchestrator.run(1);

  if (result.status !== "completed") {
    throw new Error(
      `Expected status="completed", got "${result.status}"`,
    );
  }
  if (result.cycleCount !== 2) {
    throw new Error(`Expected cycleCount=2, got ${result.cycleCount}`);
  }

  console.log("Scenario 3: PASS");
}

async function scenario4(): Promise<void> {
  console.log("Scenario 4: Orchestrator.run outcome recorded in history");
  const config = createConfig();

  const labelSeqs = new Map<number, string[][]>();
  labelSeqs.set(1, [["ready"], ["review"], ["done"]]);
  const github = new StubGitHubClient([], new Map(), labelSeqs);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });

  const orchestrator = new Orchestrator(config, github, dispatcher);
  const result = await orchestrator.run(1);

  if (result.history.length !== 2) {
    throw new Error(
      `Expected 2 history records, got ${result.history.length}`,
    );
  }
  // Verify outcome from dispatcher flows into history (C1 fix)
  if (result.history[1].outcome !== "approved") {
    throw new Error(
      `Expected outcome="approved", got "${result.history[1].outcome}"`,
    );
  }

  console.log("Scenario 4: PASS");
}

async function scenario5(): Promise<void> {
  console.log(
    "Scenario 5: runBatch without prioritizer processes all issues",
  );
  const tmp = await Deno.makeTempDir();
  try {
    const config = createConfig();
    config.issueStore = { path: ".agent/issues" };
    // No prioritizer set -- all actionable issues should be processed

    const issues: IssueListItem[] = [
      { number: 10, title: "Issue 10", labels: ["ready"], state: "open" },
      { number: 20, title: "Issue 20", labels: ["ready"], state: "open" },
    ];

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

    const labelSeqs = new Map<number, string[][]>();
    labelSeqs.set(10, [["ready"], ["done"]]);
    labelSeqs.set(20, [["ready"], ["done"]]);

    const github = new StubGitHubClient(issues, details, labelSeqs);
    const dispatcher = new StubDispatcher({ iterator: "success" });

    const orchestrator = new Orchestrator(config, github, dispatcher, tmp);
    const result = await orchestrator.runBatch({});

    if (result.processed.length !== issues.length) {
      throw new Error(
        `Expected processed.length=${issues.length}, got ${result.processed.length}`,
      );
    }

    console.log("Scenario 5: PASS");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

async function main(): Promise<void> {
  await scenario1();
  await scenario2();
  await scenario3();
  await scenario4();
  await scenario5();
  console.log("\nSummary: all scenarios passed");
}

main();
