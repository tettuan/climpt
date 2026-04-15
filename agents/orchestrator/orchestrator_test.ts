import { assertEquals, assertRejects } from "@std/assert";
import { ConfigError } from "../shared/errors/config-errors.ts";
import { DEFAULT_ISSUE_STORE, type WorkflowConfig } from "./workflow-types.ts";
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
  #closedIssues: number[] = [];
  #closeIssueShouldThrow = false;

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

  closeIssue(issueNumber: number): Promise<void> {
    if (this.#closeIssueShouldThrow) {
      return Promise.reject(new Error("gh issue close failed"));
    }
    this.#closedIssues.push(issueNumber);
    return Promise.resolve();
  }

  get closedIssues(): number[] {
    return this.#closedIssues;
  }

  setCloseIssueShouldThrow(v: boolean): void {
    this.#closeIssueShouldThrow = v;
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

Deno.test("dry run: no dispatch, no label updates, no comments", async () => {
  const config = createTestConfig();
  const github = new StubGitHubClient([
    ["ready"],
  ]);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1, { dryRun: true });

  assertEquals(result.status, "dry-run");
  assertEquals(result.finalPhase, "implementation");
  assertEquals(result.cycleCount, 0);
  assertEquals(result.history.length, 0);
  assertEquals(dispatcher.callCount, 0);
  assertEquals(github.labelUpdates.length, 0);
  assertEquals(github.comments.length, 0);
});

Deno.test("dry run with terminal phase: returns completed immediately", async () => {
  const config = createTestConfig();
  const github = new StubGitHubClient([["done"]]);
  const dispatcher = new StubDispatcher();
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1, { dryRun: true });

  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "complete");
  assertEquals(result.cycleCount, 0);
  assertEquals(dispatcher.callCount, 0);
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

Deno.test("handoff comments render handoffData variables into template", async () => {
  const config = createTestConfig();
  // Source of truth: the template from config
  const template = config.handoff!.commentTemplates!["reviewerApproved"];

  const github = new StubGitHubClient([
    ["ready"],
    ["review"],
    ["done"],
  ]);

  // handoffData provides a value for the {summary} placeholder in the template
  const handoffValue = "Agent output from closure step";
  const dispatcher = new StubDispatcher(
    { iterator: "success", reviewer: "approved" },
    undefined,
    { summary: handoffValue },
  );
  const orchestrator = new Orchestrator(config, github, dispatcher);

  await orchestrator.run(1);

  const approvedComments = github.comments.filter((c) =>
    c.comment.includes("[Agent Review Complete]")
  );
  assertEquals(
    approvedComments.length,
    1,
    "Expected exactly 1 reviewerApproved comment. " +
      `Fix: check handoff.commentTemplates["reviewerApproved"] in createTestConfig()`,
  );

  // Relationship: handoffData value replaces the placeholder in the template
  assertEquals(
    approvedComments[0].comment.includes(handoffValue),
    true,
    `handoffData value "${handoffValue}" should appear in rendered comment. ` +
      `Template: "${template}". ` +
      `Fix: check orchestrator.ts Step 12 vars construction or handoff-manager.ts renderAndPost`,
  );
  // Relationship: placeholder must not remain
  assertEquals(
    approvedComments[0].comment.includes("{summary}"),
    false,
    `Placeholder {summary} should be replaced when handoffData provides a value. ` +
      `Fix: check renderTemplate in phase-transition.ts`,
  );
});

Deno.test("handoff comments preserve placeholders when handoffData is absent", async () => {
  const config = createTestConfig();
  const github = new StubGitHubClient([
    ["ready"],
    ["review"],
    ["done"],
  ]);
  // No handoffData -> placeholders remain as-is (renderTemplate spec)
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  await orchestrator.run(1);

  const approvedComments = github.comments.filter((c) =>
    c.comment.includes("[Agent Review Complete]")
  );
  assertEquals(approvedComments.length, 1);
  // Invariant: unresolved placeholders are preserved as literal text (renderTemplate contract)
  assertEquals(
    approvedComments[0].comment.includes("{summary}"),
    true,
    "When handoffData is absent, {summary} placeholder must remain as literal text. " +
      "Fix: check renderTemplate in phase-transition.ts preserves unmatched variables",
  );
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

// === closeOnComplete Tests ===

/**
 * Test Design: Contract tests for closeOnComplete feature.
 *
 * Source of truth: orchestrator.ts terminal phase handling logic.
 * The orchestrator calls closeIssue when:
 *   1. target phase is terminal
 *   2. !dryRun
 *   3. agent.closeOnComplete === true
 *   4. agent.closeCondition is undefined OR matches outcome
 *
 * Diagnosability: each assertion message identifies the violated contract
 * and which file to fix (orchestrator.ts or workflow config).
 */

/** Config with closeOnComplete enabled on reviewer (validator) */
function createCloseOnCompleteConfig(): WorkflowConfig {
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
        closeOnComplete: true,
        closeCondition: "approved",
      },
    },
    rules: { maxCycles: 5, cycleDelayMs: 0 },
  };
}

Deno.test("closeOnComplete: closes issue when outcome matches closeCondition and target is terminal", async () => {
  const config = createCloseOnCompleteConfig();
  // Cycle 1: iterator success -> review
  // Cycle 2: reviewer approved -> complete (terminal) -> closeIssue
  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(
    result.status,
    "completed",
    "Status should be completed. Fix: orchestrator.ts terminal phase handling",
  );
  assertEquals(
    result.issueClosed,
    true,
    "issueClosed should be true when closeOnComplete fires. Fix: orchestrator.ts closeOnComplete logic",
  );
  assertEquals(
    github.closedIssues.length,
    1,
    "closeIssue should be called exactly once. Fix: orchestrator.ts closeOnComplete logic",
  );
  assertEquals(
    github.closedIssues[0],
    1,
    "closeIssue should receive the correct issue number",
  );
});

Deno.test("closeOnComplete: does NOT close when outcome does not match closeCondition", async () => {
  const config = createCloseOnCompleteConfig();
  // reviewer rejects -> goes to implementation (not terminal) -> no close
  const github = new StubGitHubClient([["review"], ["ready"], ["ready"]]);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "rejected",
  });
  config.rules.maxCycles = 2;
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(
    github.closedIssues.length,
    0,
    "closeIssue should not be called when outcome doesn't lead to terminal. " +
      "Fix: orchestrator.ts closeCondition check",
  );
  assertEquals(
    result.issueClosed,
    undefined,
    "issueClosed should be undefined when close was not triggered",
  );
});

Deno.test("closeOnComplete: closes without closeCondition (any terminal outcome)", async () => {
  const config = createCloseOnCompleteConfig();
  // Remove closeCondition -> any terminal transition triggers close
  delete (config.agents["reviewer"] as unknown as Record<string, unknown>)
    .closeCondition;

  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(result.issueClosed, true);
  assertEquals(github.closedIssues.length, 1);
});

Deno.test("closeOnComplete: does NOT close when closeOnComplete is absent", async () => {
  const config = createTestConfig(); // no closeOnComplete
  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(
    github.closedIssues.length,
    0,
    "closeIssue should not be called when closeOnComplete is not set. " +
      "Fix: orchestrator.ts should only close when agent.closeOnComplete is true",
  );
  assertEquals(result.issueClosed, undefined);
});

Deno.test("closeOnComplete: early terminal detection does NOT trigger close", async () => {
  const config = createCloseOnCompleteConfig();
  // Issue starts with terminal labels -> no agent dispatched -> no close
  const github = new StubGitHubClient([["done"]]);
  const dispatcher = new StubDispatcher();
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(
    github.closedIssues.length,
    0,
    "Early terminal detection should not trigger close (no agent dispatched). " +
      "Fix: orchestrator.ts should only close after agent dispatch, not at early terminal check",
  );
  assertEquals(result.issueClosed, undefined);
});

Deno.test("closeOnComplete: closeIssue failure is non-fatal", async () => {
  const config = createCloseOnCompleteConfig();
  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  github.setCloseIssueShouldThrow(true);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(
    result.status,
    "completed",
    "Workflow should complete even if closeIssue fails. " +
      "Fix: orchestrator.ts closeOnComplete error must be non-fatal",
  );
  assertEquals(
    result.issueClosed,
    undefined,
    "issueClosed should not be true when closeIssue threw",
  );
  assertEquals(github.closedIssues.length, 0);
});

Deno.test("closeOnComplete: closeCondition filters even when target is terminal", async () => {
  // Validator where both outcomes route to terminal, but closeCondition is "approved"
  const config: WorkflowConfig = {
    version: "1.0.0",
    phases: {
      review: { type: "actionable", priority: 1, agent: "reviewer" },
      closed: { type: "terminal" },
      archived: { type: "terminal" },
    },
    labelMapping: {
      review: "review",
      done: "closed",
      archive: "archived",
    },
    agents: {
      reviewer: {
        role: "validator",
        outputPhases: { approved: "closed", auto_closed: "archived" },
        fallbackPhase: "review",
        closeOnComplete: true,
        closeCondition: "approved",
      },
    },
    rules: { maxCycles: 5, cycleDelayMs: 0 },
  };

  // outcome is "auto_closed" -> routes to terminal "archived" but closeCondition is "approved"
  const github = new StubGitHubClient([["review"], ["archive"]]);
  const dispatcher = new StubDispatcher({ reviewer: "auto_closed" });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "archived");
  assertEquals(
    github.closedIssues.length,
    0,
    "closeIssue should NOT be called when outcome is 'auto_closed' but closeCondition is 'approved'. " +
      "Fix: orchestrator.ts must check closeCondition against outcome, not just terminal phase",
  );
  assertEquals(result.issueClosed, undefined);
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
    issueStore: DEFAULT_ISSUE_STORE,
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
  const storePath = `${tmpDir}/${DEFAULT_ISSUE_STORE.path}`;
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
    config.issueStore = DEFAULT_ISSUE_STORE;

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
    const storePath = `${tmpDir}/${DEFAULT_ISSUE_STORE.path}`;
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
    config.issueStore = DEFAULT_ISSUE_STORE;

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
    config.issueStore = DEFAULT_ISSUE_STORE;

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
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
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
    config.issueStore = DEFAULT_ISSUE_STORE;

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
    const outboxDir = `${tmpDir}/${DEFAULT_ISSUE_STORE.path}/10/outbox`;
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

// === Store-backed run() tests ===

Deno.test("run with store reads labels from store instead of GitHub", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig();
    const store = new IssueStore(`${tmpDir}/store`);
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Test",
        labels: ["ready"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });

    // GitHub client that would return different labels - should NOT be called for label reads
    const github = new StubGitHubClient([["done"]]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    const result = await orchestrator.run(1, {}, store);

    // Store labels ["ready"] -> iterator (success) -> review -> reviewer (approved) -> complete
    // GitHub's getIssueLabels should NOT be called (callIndex stays 0)
    assertEquals(github.callIndex, 0);
    assertEquals(result.status, "completed");
    assertEquals(result.finalPhase, "complete");
    assertEquals(result.cycleCount, 2);
    assertEquals(result.history[0].from, "implementation");
    assertEquals(result.history[0].agent, "iterator");
    assertEquals(result.history[1].from, "review");
    assertEquals(result.history[1].agent, "reviewer");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("run with store persists workflow state after each cycle", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig();
    const store = new IssueStore(`${tmpDir}/store`);
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Test",
        labels: ["ready"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });

    const github = new StubGitHubClient([]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    await orchestrator.run(1, {}, store);

    // Workflow state should be persisted with final state after both cycles
    const state = await store.readWorkflowState(1, "default");
    assertEquals(state !== null, true);
    assertEquals(state!.issueNumber, 1);
    assertEquals(state!.cycleCount, 2);
    assertEquals(state!.history.length, 2);
    assertEquals(state!.history[0].from, "implementation");
    assertEquals(state!.history[0].to, "review");
    assertEquals(state!.history[1].from, "review");
    assertEquals(state!.history[1].to, "complete");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("run with store updates store meta labels after transition", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig();
    const store = new IssueStore(`${tmpDir}/store`);
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Test",
        labels: ["ready"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });

    const github = new StubGitHubClient([]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    await orchestrator.run(1, {}, store);

    // Store meta should be updated with final labels after both cycles
    // ready -> review (cycle 1) -> done (cycle 2, approved)
    const meta = await store.readMeta(1);
    assertEquals(meta.labels.includes("ready"), false);
    assertEquals(meta.labels.includes("review"), false);
    assertEquals(meta.labels.includes("done"), true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("run with store restores cycle count from persisted state", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig();
    config.rules.maxCycles = 3;
    const store = new IssueStore(`${tmpDir}/store`);
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Test",
        // Labels must map to the persisted phase ("revision") so the
        // staleness reset does NOT fire: `from-reviewer` -> `revision`
        // per createTestConfig.labelMapping. A divergence here would
        // correctly reset history (see the dedicated regression test).
        labels: ["from-reviewer"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });

    // Pre-seed workflow state with 2 existing cycles
    await store.writeWorkflowState(1, {
      issueNumber: 1,
      currentPhase: "revision",
      cycleCount: 2,
      correlationId: "wf-test",
      history: [
        {
          from: "implementation",
          to: "review",
          agent: "iterator",
          outcome: "success",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
        {
          from: "review",
          to: "revision",
          agent: "reviewer",
          outcome: "rejected",
          timestamp: "2026-01-01T00:01:00.000Z",
        },
      ],
    }, "default");

    const github = new StubGitHubClient([]);
    const dispatcher = new StubDispatcher({ iterator: "success" });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    const result = await orchestrator.run(1, {}, store);

    // Should dispatch one more cycle (cycle 3), then be exceeded
    // Total cycles = 2 (restored) + 1 (new) = 3
    assertEquals(result.cycleCount, 3);
    assertEquals(result.status, "cycle_exceeded");
    assertEquals(result.history.length, 3);
    // First two are restored, third is new. Live labels now resolve
    // to `revision` (matching persisted phase), so the new cycle
    // transitions revision -> review via the iterator agent.
    assertEquals(result.history[0].from, "implementation");
    assertEquals(result.history[2].from, "revision");
    assertEquals(result.history[2].agent, "iterator");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("run resets history when persisted phase regressed via labels", async () => {
  // Scenario: an issue reached "complete" (terminal) in a previous run,
  // but the user manually relabeled it back to "ready" to retry. The
  // persisted state still carries the terminal phase plus a saturated
  // history (cycleCount == maxCycles). Without the staleness reset the
  // orchestrator would short-circuit with `cycle_exceeded`; with the
  // reset it should treat the label change as explicit retry intent
  // and dispatch a fresh cycle.
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig();
    config.rules.maxCycles = 2;
    const store = new IssueStore(`${tmpDir}/store`);
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Test",
        // Live labels point at "implementation" via "ready" mapping.
        labels: ["ready"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });

    // Persisted state: terminal phase `complete` with a saturated
    // cycle history that would otherwise trip `cycle_exceeded`.
    await store.writeWorkflowState(1, {
      issueNumber: 1,
      currentPhase: "complete",
      cycleCount: 2,
      correlationId: "wf-prior-run",
      history: [
        {
          from: "implementation",
          to: "review",
          agent: "iterator",
          outcome: "success",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
        {
          from: "review",
          to: "complete",
          agent: "reviewer",
          outcome: "approved",
          timestamp: "2026-01-01T00:01:00.000Z",
        },
      ],
    }, "default");

    const github = new StubGitHubClient([]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    const result = await orchestrator.run(1, {}, store);

    // Without the staleness reset, persisted cycleCount (2) would equal
    // maxCycles (2) at tracker construction time and the run would exit
    // with status "cycle_exceeded" before dispatching anything. With
    // the reset, a fresh two-cycle run completes normally.
    assertEquals(result.status, "completed");
    assertEquals(result.finalPhase, "complete");
    // Both history entries are post-reset; the pre-seeded records must
    // not appear.
    assertEquals(result.history.length, 2);
    assertEquals(result.history[0].agent, "iterator");
    assertEquals(result.history[0].from, "implementation");
    assertEquals(result.history[0].to, "review");
    assertEquals(result.history[1].agent, "reviewer");
    assertEquals(result.history[1].to, "complete");

    // Persisted state on disk reflects the post-reset run, not the
    // pre-seeded history.
    const finalState = await store.readWorkflowState(1, "default");
    assertEquals(finalState?.cycleCount, 2);
    assertEquals(finalState?.currentPhase, "complete");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("run preserves history when persisted phase matches live labels", async () => {
  // Companion to the regression test above: when the persisted phase
  // still matches the phase resolved from live labels, history must be
  // carried forward unchanged.
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig();
    config.rules.maxCycles = 5;
    const store = new IssueStore(`${tmpDir}/store`);
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Test",
        // "from-reviewer" maps to "revision", matching persisted state.
        labels: ["from-reviewer"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });

    await store.writeWorkflowState(1, {
      issueNumber: 1,
      currentPhase: "revision",
      cycleCount: 1,
      correlationId: "wf-prior",
      history: [
        {
          from: "review",
          to: "revision",
          agent: "reviewer",
          outcome: "rejected",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ],
    }, "default");

    const github = new StubGitHubClient([]);
    const dispatcher = new StubDispatcher({ iterator: "success" });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    const result = await orchestrator.run(1, {}, store);

    // Restored record plus one new cycle: history length 2, first entry
    // is the pre-seeded reviewer record (not reset).
    assertEquals(result.history.length >= 2, true);
    assertEquals(result.history[0].agent, "reviewer");
    assertEquals(result.history[0].outcome, "rejected");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// Conformance tests for staleness-check label precedence (Fix-B).
//
// `#resolveLivePhaseId` uses precedence
//   blocking > actionable > terminal
// to detect regression when an actionable label coexists with a
// terminal one. Main loop precedence (terminal-first) is preserved
// elsewhere to honour `closeOnComplete` semantics.

Deno.test("run detects regression when live has [done, from-reviewer] but persisted is complete", async () => {
  // [done, from-reviewer] coexists: terminal `done` + actionable
  // `from-reviewer` (revision). Persisted is `complete` (terminal).
  // Old terminal-first precedence would resolve livePhase=complete and
  // falsely match persisted, suppressing the reset. New precedence
  // resolves livePhase=revision (actionable), differs from persisted,
  // so regression reset fires and a fresh cycle dispatches.
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig();
    config.rules.maxCycles = 2;
    const store = new IssueStore(`${tmpDir}/store`);
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Test",
        labels: ["done", "from-reviewer"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });

    // Persisted state: terminal `complete` with saturated cycle history.
    await store.writeWorkflowState(1, {
      issueNumber: 1,
      currentPhase: "complete",
      cycleCount: 2,
      correlationId: "wf-prior-run",
      history: [
        {
          from: "implementation",
          to: "review",
          agent: "iterator",
          outcome: "success",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
        {
          from: "review",
          to: "complete",
          agent: "reviewer",
          outcome: "approved",
          timestamp: "2026-01-01T00:01:00.000Z",
        },
      ],
    }, "default");

    const github = new StubGitHubClient([]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    const result = await orchestrator.run(1, {}, store);

    // Reset proof: persisted history was dropped (length 0). The main
    // loop then re-applied terminal-first precedence at iteration time
    // (preserving `closeOnComplete` semantics) and exited cleanly on
    // `done` without dispatching. Without the reset, persisted history
    // would survive and `cycleCount` would not be zero.
    assertEquals(
      result.status,
      "completed",
      "main loop terminal-first detection should still complete cleanly",
    );
    assertEquals(result.finalPhase, "complete");
    assertEquals(
      result.history.length,
      0,
      "regression reset must drop pre-seeded history before main loop runs",
    );
    assertEquals(
      result.cycleCount,
      0,
      "main loop exits on terminal label before dispatching any cycle",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("run detects regression when live has [done, ready] but persisted is implementation", async () => {
  // [done, ready] coexists: terminal `done` + actionable `ready`
  // (implementation). Persisted is `implementation` (actionable).
  // Under the precedence in effect, the resolved livePhase is compared
  // against persisted to decide whether to reset history.
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig();
    config.rules.maxCycles = 2;
    const store = new IssueStore(`${tmpDir}/store`);
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Test",
        labels: ["done", "ready"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });

    // Persisted state: actionable `implementation` with saturated cycle
    // history. With terminal-first precedence (old behaviour) `done`
    // wins, livePhase=complete, diverges from `implementation`, reset
    // fires. With actionable-first precedence (Fix-B) `ready` wins,
    // livePhase=implementation, matches persisted, no reset.
    await store.writeWorkflowState(1, {
      issueNumber: 1,
      currentPhase: "implementation",
      cycleCount: 2,
      correlationId: "wf-prior-run",
      history: [
        {
          from: "implementation",
          to: "review",
          agent: "iterator",
          outcome: "success",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
        {
          from: "review",
          to: "complete",
          agent: "reviewer",
          outcome: "approved",
          timestamp: "2026-01-01T00:01:00.000Z",
        },
      ],
    }, "default");

    const github = new StubGitHubClient([]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    const result = await orchestrator.run(1, {}, store);

    // Expectation per Fix-B spec: regression reset fires because
    // phase diverges (ready prioritised, persisted differs).
    assertEquals(
      result.status,
      "completed",
      "regression reset should fire so a fresh cycle can complete",
    );
    assertEquals(result.finalPhase, "complete");
    assertEquals(
      result.history.length,
      2,
      "history should be post-reset (pre-seeded entries dropped)",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("run preserves blocking priority when [blocked, ready] coexist", async () => {
  // [blocked, ready] coexists: blocking `blocked` + actionable `ready`
  // (implementation). Persisted is `implementation` (actionable).
  // Blocking must take precedence to honour user manual stop intent;
  // livePhase=blocked diverges from persisted=implementation, so the
  // regression reset fires but the run halts on the blocking phase.
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig();
    config.rules.maxCycles = 5;
    const store = new IssueStore(`${tmpDir}/store`);
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Test",
        labels: ["blocked", "ready"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });

    await store.writeWorkflowState(1, {
      issueNumber: 1,
      currentPhase: "implementation",
      cycleCount: 1,
      correlationId: "wf-prior-run",
      history: [
        {
          from: "implementation",
          to: "review",
          agent: "iterator",
          outcome: "success",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ],
    }, "default");

    const github = new StubGitHubClient([]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    const result = await orchestrator.run(1, {}, store);

    // Blocking precedence: livePhase=blocked, diverges from persisted
    // actionable, reset fires; main loop then halts on blocking phase.
    assertEquals(
      result.status,
      "blocked",
      "blocking label must short-circuit the run",
    );
    assertEquals(result.finalPhase, "blocked");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("run without store works exactly as before (backward compatibility)", async () => {
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

  // Call run() without store parameter - should work identically to original
  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "complete");
  assertEquals(result.cycleCount, 2);
  assertEquals(result.history.length, 2);
  // getIssueLabels called twice (once per cycle); terminal phase breaks before 3rd read
  assertEquals(github.callIndex, 2);
});

// === Issue lock tests ===

Deno.test("run with store acquires issue lock", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig();
    const store = new IssueStore(`${tmpDir}/store`);
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Test",
        labels: ["ready"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });

    const github = new StubGitHubClient([]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    const result = await orchestrator.run(1, {}, store);
    assertEquals(result.status, "completed");

    // Lock should be released after run — re-acquiring must succeed
    const lock = await store.acquireIssueLock("default", 1);
    assertEquals(lock !== null, true);
    lock!.release();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("run with locked issue returns blocked", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig();
    const store = new IssueStore(`${tmpDir}/store`);
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Test",
        labels: ["ready"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });

    const github = new StubGitHubClient([]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
    });
    const orchestrator = new Orchestrator(config, github, dispatcher);

    // Pre-acquire the issue lock
    const holdLock = await store.acquireIssueLock("default", 1);
    assertEquals(holdLock !== null, true);

    const result = await orchestrator.run(1, {}, store);
    assertEquals(result.status, "blocked");
    assertEquals(result.cycleCount, 0);

    holdLock!.release();
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// === Batch status and prioritize guard tests ===

Deno.test("runBatch prioritizeOnly without prioritizer config throws ConfigError", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createBatchTestConfig();
    delete config.prioritizer; // Remove prioritizer config
    config.issueStore = DEFAULT_ISSUE_STORE;

    await setupBatchStore(tmpDir, [
      { num: 10, labels: ["ready"] },
    ]);

    const listItems: IssueListItem[] = [
      { number: 10, title: "Issue 10", labels: ["ready"], state: "open" },
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
    const github = new BatchStubGitHubClient(
      listItems,
      details,
      new Map(),
    );
    const dispatcher = new StubDispatcher({});
    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);

    await assertRejects(
      () => orchestrator.runBatch({}, { prioritizeOnly: true }),
      ConfigError,
      "WF-BATCH-001",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("runBatch prioritizeOnly with dryRun skips store writes", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createBatchTestConfig();
    config.issueStore = DEFAULT_ISSUE_STORE;

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
    const github = new BatchStubGitHubClient(
      listItems,
      details,
      new Map(),
    );

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

    // Write priorities.json for prioritizer agent
    const storePath = `${tmpDir}/${DEFAULT_ISSUE_STORE.path}`;
    await Deno.writeTextFile(
      `${storePath}/priorities.json`,
      JSON.stringify([
        { issue: 10, priority: "P1" },
        { issue: 20, priority: "P2" },
      ]),
    );

    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);
    const result = await orchestrator.runBatch(
      {},
      { prioritizeOnly: true, dryRun: true },
    );

    // Prioritizer agent was dispatched
    assertEquals(dispatchedAgents.includes("triage-agent"), true);
    assertEquals(result.status, "completed");

    // Store should NOT have been updated (dryRun)
    const store = new IssueStore(storePath);
    const meta10 = await store.readMeta(10);
    assertEquals(meta10.labels.includes("P1"), false);
    const meta20 = await store.readMeta(20);
    assertEquals(meta20.labels.includes("P2"), false);

    // GitHub should NOT have label updates
    assertEquals(github.labelUpdates.length, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("runBatch all-terminal issues returns completed status", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createBatchTestConfig();
    config.issueStore = DEFAULT_ISSUE_STORE;

    // All issues are terminal (done label)
    await setupBatchStore(tmpDir, [
      { num: 10, labels: ["done"] },
      { num: 20, labels: ["done"] },
    ]);

    const details = new Map<number, IssueDetail>();
    details.set(10, {
      number: 10,
      title: "Issue 10",
      body: "Body 10",
      labels: ["done"],
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
      { number: 10, title: "Issue 10", labels: ["done"], state: "open" },
      { number: 20, title: "Issue 20", labels: ["done"], state: "open" },
    ];
    const github = new BatchStubGitHubClient(
      listItems,
      details,
      new Map(),
    );
    const dispatcher = new StubDispatcher({});
    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);

    const result = await orchestrator.runBatch({});

    assertEquals(result.status, "completed");
    assertEquals(result.processed.length, 0);
    assertEquals(result.skipped.length, 2);
    assertEquals(result.skipped[0].reason, "not actionable");
    assertEquals(result.skipped[1].reason, "not actionable");
    assertEquals(result.totalIssues, 2);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("runBatch empty sync returns completed status", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createBatchTestConfig();
    config.issueStore = DEFAULT_ISSUE_STORE;

    // No issues in store — empty listItems
    const github = new BatchStubGitHubClient(
      [],
      new Map(),
      new Map(),
    );
    const dispatcher = new StubDispatcher({});
    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);

    const result = await orchestrator.runBatch({});

    assertEquals(result.status, "completed");
    assertEquals(result.processed.length, 0);
    assertEquals(result.skipped.length, 0);
    assertEquals(result.totalIssues, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("runBatch with processing error returns partial status", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createBatchTestConfig();
    config.issueStore = DEFAULT_ISSUE_STORE;

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
    labelSeqs.set(10, [["ready"]]);

    const github = new BatchStubGitHubClient(listItems, details, labelSeqs);

    // Dispatcher that throws for all agents
    const dispatcher = {
      dispatch(
        _agentId: string,
        _issueNumber: number,
      ): Promise<DispatchOutcome> {
        return Promise.reject(new Error("agent dispatch failed"));
      },
    };
    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);

    const result = await orchestrator.runBatch({});

    assertEquals(result.status, "partial");
    assertEquals(result.processed.length, 0);
    assertEquals(result.skipped.length, 1);
    assertEquals(result.skipped[0].issueNumber, 10);
    assertEquals(result.skipped[0].reason, "agent dispatch failed");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// === Rate limit throttle tests ===

Deno.test("rate limit throttle: completes normally when resetsAt is in the past", async () => {
  const config = createTestConfig();
  config.rules.rateLimitThreshold = 0.90;

  // Cycle 1: ["ready"] -> iterator (success) -> transition to "review"
  // Cycle 2: ["review"] -> reviewer (approved) -> transition to "complete"
  // Cycle 3: ["done"] -> terminal -> break
  const github = new StubGitHubClient([
    ["ready"],
    ["review"],
    ["done"],
  ]);

  // StubDispatcher with rateLimitInfo where utilization >= threshold
  // and resetsAt is in the past so #waitForRateLimitReset exits immediately
  const rateLimitInfo = {
    utilization: 0.95,
    resetsAt: Math.floor(Date.now() / 1000) - 60, // 60 seconds in the past
    rateLimitType: "seven_day",
  };
  const dispatcher = new StubDispatcher(
    { iterator: "success", reviewer: "approved" },
    rateLimitInfo,
  );
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "complete");
  assertEquals(result.cycleCount, 2);
  // Dispatcher was called for both agents
  assertEquals(dispatcher.callCount, 2);
});

Deno.test("rate limit throttle: skipped when utilization is below threshold", async () => {
  const config = createTestConfig();
  config.rules.rateLimitThreshold = 0.95;

  // Single cycle to terminal
  const github = new StubGitHubClient([
    ["ready"],
    ["done"],
  ]);

  // utilization (0.50) < threshold (0.95), so throttle should be skipped
  const rateLimitInfo = {
    utilization: 0.50,
    resetsAt: Math.floor(Date.now() / 1000) + 3600, // far future - but should not wait
    rateLimitType: "seven_day",
  };
  const dispatcher = new StubDispatcher(
    { iterator: "success" },
    rateLimitInfo,
  );
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  // Should complete without waiting (utilization below threshold)
  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "complete");
  assertEquals(result.cycleCount, 1);
});

Deno.test("rate limit throttle: no rateLimitInfo proceeds without throttle", async () => {
  const config = createTestConfig();
  config.rules.rateLimitThreshold = 0.90;

  const github = new StubGitHubClient([
    ["ready"],
    ["done"],
  ]);

  // No rateLimitInfo at all
  const dispatcher = new StubDispatcher({ iterator: "success" });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "complete");
  assertEquals(result.cycleCount, 1);
});

Deno.test("outbox failure logs structured events", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig();
    const store = new IssueStore(`${tmpDir}/store`);
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Test",
        labels: ["ready"],
        state: "open",
        assignees: [],
        milestone: null,
      },
      body: "test",
      comments: [],
    });

    // Write an invalid outbox action
    const outboxDir = `${tmpDir}/store/1/outbox`;
    await Deno.mkdir(outboxDir, { recursive: true });
    await Deno.writeTextFile(
      `${outboxDir}/001-bad.json`,
      "not valid json",
    );

    const github = new StubGitHubClient([["done"]]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);

    const result = await orchestrator.run(1, {}, store);

    // Run should still complete (outbox failure is not fatal)
    assertEquals(result.status, "completed");

    // Read log file to verify outbox events were emitted
    const logDir = `${tmpDir}/tmp/logs/orchestrator`;
    let logContent = "";
    for await (const entry of Deno.readDir(logDir)) {
      if (entry.name.endsWith(".jsonl")) {
        logContent = await Deno.readTextFile(`${logDir}/${entry.name}`);
        break;
      }
    }

    const lines = logContent.trim().split("\n").map((l) => JSON.parse(l));
    const outboxProcessed = lines.find((l) =>
      l.metadata?.event === "outbox_processed"
    );
    const outboxFailed = lines.find((l) =>
      l.metadata?.event === "outbox_action_failed"
    );
    const outboxNotCleared = lines.find((l) =>
      l.metadata?.event === "outbox_not_cleared"
    );

    assertEquals(outboxProcessed !== undefined, true);
    assertEquals(outboxProcessed.metadata.failed, 1);
    assertEquals(outboxFailed !== undefined, true);
    assertEquals(outboxFailed.metadata.action, "unknown");
    assertEquals(outboxNotCleared !== undefined, true);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("rate limit throttle: invalid resetsAt (0) skips wait without error", async () => {
  const config = createTestConfig();
  config.rules.rateLimitThreshold = 0.90;

  const github = new StubGitHubClient([
    ["ready"],
    ["done"],
  ]);

  // resetsAt is 0 (invalid) — should skip wait gracefully
  const rateLimitInfo = {
    utilization: 0.95,
    resetsAt: 0,
    rateLimitType: "seven_day",
  };
  const dispatcher = new StubDispatcher(
    { iterator: "success" },
    rateLimitInfo,
  );
  const orchestrator = new Orchestrator(config, github, dispatcher);

  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "complete");
  assertEquals(result.cycleCount, 1);
});

// === Verdict propagation tests ===

Deno.test("verdict propagation: approved routes via validator outputPhases to complete", async () => {
  const config = createTestConfig();
  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator = new Orchestrator(config, github, dispatcher);
  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "complete");
  assertEquals(result.cycleCount, 2);
  assertEquals(result.history[1].from, "review");
  assertEquals(result.history[1].to, "complete");
  assertEquals(result.history[1].outcome, "approved");
});

Deno.test("verdict propagation: rejected routes via validator outputPhases to revision", async () => {
  const config = createTestConfig();
  const github = new StubGitHubClient([
    ["ready"],
    ["review"],
    ["implementation-gap"],
    ["implementation-gap"],
  ]);
  config.rules.maxCycles = 3;
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "rejected",
  });
  const orchestrator = new Orchestrator(config, github, dispatcher);
  const result = await orchestrator.run(1);

  assertEquals(result.history[1].from, "review");
  assertEquals(result.history[1].to, "revision");
  assertEquals(result.history[1].outcome, "rejected");
});

Deno.test("verdict propagation: unknown verdict falls back to fallbackPhase", async () => {
  const config = createTestConfig();
  const github = new StubGitHubClient([["review"], ["blocked"]]);
  const dispatcher = new StubDispatcher({ reviewer: "unknown-verdict" });
  const orchestrator = new Orchestrator(config, github, dispatcher);
  const result = await orchestrator.run(1);

  assertEquals(result.status, "blocked");
  assertEquals(result.finalPhase, "blocked");
  assertEquals(result.history[0].from, "review");
  assertEquals(result.history[0].to, "blocked");
  assertEquals(result.history[0].outcome, "unknown-verdict");
});
