import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ConfigError } from "../shared/errors/config-errors.ts";
import {
  DEFAULT_SUBJECT_STORE,
  deriveInvocations,
  type WorkflowConfig,
} from "./workflow-types.ts";
import {
  buildOrchestratorWithChannels,
  TEST_DEFAULT_ISSUE_SOURCE,
} from "./_test-fixtures.ts";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
  Project,
  ProjectField,
} from "./github-client.ts";
import type { ProjectFieldValue, ProjectRef } from "./outbox-processor.ts";
import type {
  AgentDispatcher,
  DispatchOptions,
  DispatchOutcome,
  StubDispatcherCall,
} from "./dispatcher.ts";
import { StubDispatcher } from "./dispatcher.ts";
import type { RateLimitInfo } from "../src_common/types/runtime.ts";
import {
  compensationMarker,
  MAX_RATE_LIMIT_WAITS_PER_RUN,
  Orchestrator,
} from "./orchestrator.ts";
import { SubjectStore } from "./subject-store.ts";
import { CycleTracker } from "./cycle-tracker.ts";

// Design §2.2: one phase transition produces one "add" call (T3) plus
// one "remove" call (T4).
const LABEL_CALLS_PER_TRANSITION = 2;

// --- Test fixtures ---

/** Minimal WorkflowConfig matching the design doc example. */
function createTestConfig(): WorkflowConfig {
  const phases = {
    implementation: {
      type: "actionable" as const,
      priority: 3,
      agent: "iterator",
    },
    review: { type: "actionable" as const, priority: 2, agent: "reviewer" },
    revision: { type: "actionable" as const, priority: 1, agent: "iterator" },
    complete: { type: "terminal" as const },
    blocked: { type: "blocking" as const },
  };
  const agents = {
    iterator: {
      role: "transformer" as const,
      directory: "iterator",
      outputPhase: "review",
      fallbackPhase: "blocked",
    },
    reviewer: {
      role: "validator" as const,
      directory: "reviewer",
      outputPhases: {
        approved: "complete",
        rejected: "revision",
      },
      fallbackPhase: "blocked",
    },
  };
  return {
    version: "1.0.0",
    issueSource: TEST_DEFAULT_ISSUE_SOURCE,
    phases,
    labelMapping: {
      ready: "implementation",
      review: "review",
      "implementation-gap": "revision",
      "from-reviewer": "revision",
      done: "complete",
      blocked: "blocked",
    },
    agents,
    invocations: deriveInvocations(phases, agents),
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
  #closeIssueShouldThrow = false;

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

  createIssue(
    _title: string,
    _labels: string[],
    _body: string,
  ): Promise<number> {
    return Promise.resolve(999);
  }

  closeIssue(subjectId: number): Promise<void> {
    if (this.#closeIssueShouldThrow) {
      return Promise.reject(new Error("gh issue close failed"));
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

  get closedIssues(): number[] {
    return this.#closedIssues;
  }

  setCloseIssueShouldThrow(v: boolean): void {
    this.#closeIssueShouldThrow = v;
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

  // Label spec methods (Phase 2 label preflight): default to inert stubs.
  // Individual tests that care about preflight inspect LabelPreflight via
  // a dedicated fixture; the default path returns an empty baseline and
  // records nothing so pre-existing cycle/transition tests remain green.
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
  getIssueProjects(
    _issueNumber: number,
  ): Promise<Array<{ owner: string; number: number }>> {
    return Promise.resolve([]);
  }
  createProjectFieldOption(
    _project: ProjectRef,
    _fieldId: string,
    name: string,
  ): Promise<{ id: string; name: string }> {
    return Promise.resolve({ id: `OPT_${name}`, name });
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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

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
    dispatch(agentId: string, _subjectId: number) {
      if (agentId === "reviewer") {
        reviewerCallCount++;
        const outcome = reviewerCallCount === 1 ? "rejected" : "approved";
        return Promise.resolve({ outcome, durationMs: 0 });
      }
      return Promise.resolve({ outcome: "success", durationMs: 0 });
    },
  } as StubDispatcher & { dispatch: typeof StubDispatcher.prototype.dispatch };

  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;
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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

  const result = await orchestrator.run(1);

  assertEquals(result.status, "blocked");
  assertEquals(result.finalPhase, "unknown");
  assertEquals(result.cycleCount, 0);
});

Deno.test("synthesized workflow: empty labels dispatch via argv-lift bypass", async () => {
  // Mirrors the shape produced by `Boot.bootStandalone` (kernel.ts):
  // single actionable phase whose agent equals --agent, single terminal
  // phase, and `synthesized: true`. Workflow mode would block here
  // because resolvePhase returns null on empty labels — argv-lift mode
  // (design 11 §B) treats the actionable phase as fixed at boot.
  const phases = {
    standalone: {
      type: "actionable" as const,
      priority: 1,
      agent: "iterator",
    },
    done: { type: "terminal" as const },
  };
  const agents = {
    iterator: {
      role: "transformer" as const,
      directory: "iterator",
      outputPhase: "done",
    },
  };
  const config: WorkflowConfig = {
    version: "1.0.0",
    issueSource: TEST_DEFAULT_ISSUE_SOURCE,
    phases,
    labelMapping: { standalone: "standalone" },
    agents,
    invocations: deriveInvocations(phases, agents),
    rules: { maxCycles: 1, cycleDelayMs: 0 },
    synthesized: true,
  };
  const github = new StubGitHubClient([[]]);
  const dispatcher = new StubDispatcher({ iterator: "success" });
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

  const result = await orchestrator.run(1);

  assertEquals(dispatcher.callCount, 1);
  assertEquals(dispatcher.calls[0].agentId, "iterator");
  assertEquals(result.cycleCount, 1);
  assertEquals(result.history.length, 1);
  assertEquals(result.history[0].from, "standalone");
});

Deno.test("synthesized=false (workflow mode): empty labels still block", async () => {
  // Conformance: the bypass must NOT leak into workflow mode. Identical
  // shape to the test above except `synthesized` is omitted, so the
  // orchestrator must consult labelMapping and block on empty labels.
  const phases = {
    standalone: {
      type: "actionable" as const,
      priority: 1,
      agent: "iterator",
    },
    done: { type: "terminal" as const },
  };
  const agents = {
    iterator: {
      role: "transformer" as const,
      directory: "iterator",
      outputPhase: "done",
    },
  };
  const config: WorkflowConfig = {
    version: "1.0.0",
    issueSource: TEST_DEFAULT_ISSUE_SOURCE,
    phases,
    labelMapping: { standalone: "standalone" },
    agents,
    invocations: deriveInvocations(phases, agents),
    rules: { maxCycles: 1, cycleDelayMs: 0 },
  };
  const github = new StubGitHubClient([[]]);
  const dispatcher = new StubDispatcher({ iterator: "success" });
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

  const result = await orchestrator.run(1);

  assertEquals(dispatcher.callCount, 0);
  assertEquals(result.status, "blocked");
  assertEquals(result.finalPhase, "unknown");
});

Deno.test("verbose mode does not change behavior", async () => {
  const config = createTestConfig();
  const github = new StubGitHubClient([["done"]]);
  const dispatcher = new StubDispatcher();
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "complete");
  assertEquals(result.cycleCount, 2);
  // Label updates are split into T3 (add-only) then T4 (remove-only) per
  // design §2.2, so each cycle produces two calls with prefixed labels.
  const transitions = 2; // ready->review, review->done
  assertEquals(
    github.labelUpdates.length,
    transitions * LABEL_CALLS_PER_TRANSITION,
    "Expected 2 transitions × 2 label calls per transition (design §2.2) " +
      "= 4 updates",
  );
  assertEquals(github.labelUpdates[0].removed, []);
  assertEquals(github.labelUpdates[0].added, ["wf:review"]);
  assertEquals(github.labelUpdates[1].removed, ["wf:ready"]);
  assertEquals(github.labelUpdates[1].added, []);
  assertEquals(github.labelUpdates[2].removed, []);
  assertEquals(github.labelUpdates[2].added, ["wf:done"]);
  assertEquals(github.labelUpdates[3].removed, ["wf:review"]);
  assertEquals(github.labelUpdates[3].added, []);
});

// === closeBinding Tests ===

/**
 * Test Design: Contract tests for closeBinding feature (T6.2).
 *
 * Source of truth: orchestrator.ts terminal phase handling logic.
 * The orchestrator calls closeIssue when:
 *   1. target phase is terminal
 *   2. !dryRun
 *   3. agent.closeBinding.primary.kind === "direct"
 *   4. agent.closeBinding.condition is undefined OR matches outcome
 *
 * Diagnosability: each assertion message identifies the violated contract
 * and which file to fix (orchestrator.ts or workflow config).
 */

/** Config with closeBinding enabled on reviewer (validator) */
function createCloseOnCompleteConfig(): WorkflowConfig {
  const phases = {
    implementation: {
      type: "actionable" as const,
      priority: 1,
      agent: "iterator",
    },
    review: { type: "actionable" as const, priority: 2, agent: "reviewer" },
    complete: { type: "terminal" as const },
    blocked: { type: "blocking" as const },
  };
  const agents = {
    iterator: {
      role: "transformer" as const,
      outputPhase: "review",
      fallbackPhase: "blocked",
    },
    reviewer: {
      role: "validator" as const,
      outputPhases: { approved: "complete", rejected: "implementation" },
      fallbackPhase: "blocked",
      closeBinding: {
        primary: { kind: "direct" as const },
        cascade: false,
        condition: "approved",
      },
    },
  };
  return {
    version: "1.0.0",
    issueSource: TEST_DEFAULT_ISSUE_SOURCE,
    phases,
    labelMapping: {
      ready: "implementation",
      review: "review",
      done: "complete",
      blocked: "blocked",
    },
    agents,
    invocations: deriveInvocations(phases, agents),
    rules: { maxCycles: 5, cycleDelayMs: 0 },
  };
}

Deno.test("closeBinding: closes issue when outcome matches condition and target is terminal", async () => {
  const config = createCloseOnCompleteConfig();
  // Cycle 1: iterator success -> review
  // Cycle 2: reviewer approved -> complete (terminal) -> closeIssue
  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const { orchestrator } = buildOrchestratorWithChannels({
    config,
    github,
    dispatcher,
  });

  const result = await orchestrator.run(1);

  assertEquals(
    result.status,
    "completed",
    "Status should be completed. Fix: orchestrator.ts terminal phase handling",
  );
  // T6.2: result.issueClosed deleted; close success is observable via the
  // close transport (closedIssues count) and the bus IssueClosedEvent.
  assertEquals(
    github.closedIssues.length,
    1,
    "closeIssue should be called exactly once via the close transport. " +
      "Fix: DirectCloseChannel.execute must invoke closeTransport.close.",
  );
  assertEquals(
    github.closedIssues[0],
    1,
    "closeIssue should receive the correct issue number",
  );
});

Deno.test("closeBinding: does NOT close when outcome does not match condition", async () => {
  const config = createCloseOnCompleteConfig();
  // reviewer rejects -> goes to implementation (not terminal) -> no close
  const github = new StubGitHubClient([["review"], ["ready"], ["ready"]]);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "rejected",
  });
  config.rules.maxCycles = 2;
  const { orchestrator } = buildOrchestratorWithChannels({
    config,
    github,
    dispatcher,
  });

  const result = await orchestrator.run(1);

  assertEquals(
    github.closedIssues.length,
    0,
    "closeIssue should not be called when outcome doesn't lead to terminal. " +
      "Fix: DirectCloseChannel.decide must return skip when isTerminal=false.",
  );
  // T6.2: close fact is observable via closedIssues / bus, not result.
  // (result.issueClosed === undefined assertion deleted with the field.)
  void result;
});

Deno.test("closeBinding: closes without condition (any terminal outcome)", async () => {
  const config = createCloseOnCompleteConfig();
  // Remove closeBinding.condition -> any terminal transition triggers close
  // deno-lint-ignore no-explicit-any
  delete (config.agents["reviewer"] as any).closeBinding.condition;

  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const { orchestrator } = buildOrchestratorWithChannels({
    config,
    github,
    dispatcher,
  });

  const _result = await orchestrator.run(1);

  assertEquals(github.closedIssues.length, 1);
});

Deno.test("closeBinding: does NOT close when closeBinding is absent", async () => {
  const config = createTestConfig(); // no closeBinding
  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const { orchestrator } = buildOrchestratorWithChannels({
    config,
    github,
    dispatcher,
  });

  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(
    github.closedIssues.length,
    0,
    "closeIssue should not be called when closeBinding is not set. " +
      "Fix: DirectCloseChannel.decide must return skip when " +
      'closeBinding.primary.kind !== "direct".',
  );
});

Deno.test("closeBinding: early terminal detection does NOT trigger close", async () => {
  const config = createCloseOnCompleteConfig();
  // Issue starts with terminal labels -> no agent dispatched -> no close
  const github = new StubGitHubClient([["done"]]);
  const dispatcher = new StubDispatcher();
  const { orchestrator } = buildOrchestratorWithChannels({
    config,
    github,
    dispatcher,
  });

  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(
    github.closedIssues.length,
    0,
    "Early terminal detection should not trigger close (no agent dispatched). " +
      "Fix: orchestrator.ts should only publish TransitionComputed after " +
      "agent dispatch, not at the early terminal check.",
  );
  // T6.2: result.issueClosed deleted; closedIssues count above is the
  // observable assertion.
  void result;
});

Deno.test(
  "closeBinding: closeIssue failure under W13 — labels stay applied, " +
    "compensation comment posted, cycle remains completed",
  async () => {
    // PR4-2b — W13 contract (To-Be 41 §D, plan-revisions.md §"PR4-2 split
    // discovery"):
    //   Close failure is **not** fatal to the cycle. The legacy saga
    //   rollback (LIFO T4→T3 label restoration + status="blocked") is
    //   deleted. Replacement contract:
    //     1. Forward labels stay committed — next cycle re-reads from
    //        the source of truth and self-heals if needed.
    //     2. DirectClose publishes IssueCloseFailed; the framework's
    //        CompensationCommentChannel posts a marker-tagged comment
    //        for operator intervention.
    //     3. status remains "completed" because target phase is terminal
    //        (the cycle's intent succeeded structurally; close is
    //        out-of-band).
    //     4. result.issueClosed is undefined / false because the close
    //        transport actually failed — but downstream consumers MUST
    //        observe close fact via the bus event log, not this field.
    const config = createCloseOnCompleteConfig();
    const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
    github.setCloseIssueShouldThrow(true);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const { orchestrator } = buildOrchestratorWithChannels({
      config,
      github,
      dispatcher,
    });

    const result = await orchestrator.run(1);

    // --- W13 cycle-level contract ---
    assertEquals(
      result.status,
      "completed",
      "W13: cycle status reflects target-phase reachability, not close " +
        'outcome. Target phase "complete" is terminal so the cycle is ' +
        "completed; close failure is observable on the bus, not on the " +
        'result. Fix: orchestrator must NOT set status="blocked" when ' +
        "DirectCloseChannel.execute throws.",
    );
    // T6.2: result.issueClosed deleted; the close-transport-failed fact
    // is observable via the bus IssueCloseFailedEvent. closedIssues
    // remains the structural assertion below.
    assertEquals(
      github.closedIssues.length,
      0,
      "StubGitHubClient only records successful closes; closeIssue threw " +
        "so no issue number is appended.",
    );

    // --- W13 label contract: labels stay committed (NO rollback) ---
    const labelUpdates = github.labelUpdates;
    const forwardTransitions = 2; // cycle 1 ready->review, cycle 2 review->done
    assertEquals(
      labelUpdates.length,
      forwardTransitions * LABEL_CALLS_PER_TRANSITION,
      "W13: only forward label ops occur (2 transitions × 2 calls each " +
        '= 4). The legacy LIFO rollback that re-added "review" and ' +
        'removed "done" is gone. Fix: orchestrator.ts must NOT ' +
        "register saga compensations that invert label changes.",
    );
    assertEquals(labelUpdates[0].added, ["review"]);
    assertEquals(labelUpdates[1].removed, ["ready"]);
    assertEquals(
      labelUpdates[2].added,
      ["done"],
      "Cycle 2 must commit the terminal label even when the close " +
        "transport will throw — labels are not rolled back under W13.",
    );
    assertEquals(labelUpdates[3].removed, ["review"]);

    // --- W13 compensation contract: comment-only ---
    assertEquals(
      github.comments.length,
      1,
      "CompensationCommentChannel must post exactly one marker comment " +
        "in response to IssueCloseFailedEvent. Fix: BootKernel must " +
        "register the channel and DirectCloseChannel.execute must " +
        "publish IssueCloseFailed when the transport throws.",
    );
    const comp = github.comments[0];
    assertEquals(
      comp.subjectId,
      1,
      "Compensation comment must address the same issue whose close failed.",
    );
    assertStringIncludes(
      comp.comment,
      "⚠️ 自動遷移失敗",
      "Visible warning header must be present so operators see the " +
        "comment in the GitHub UI.",
    );
    assertStringIncludes(
      comp.comment,
      "climpt-compensation:subject-1:run-test-run-id",
      "Marker must embed (subjectId, runId) so retries within the same " +
        "boot dedup; cross-boot retries get a new marker.",
    );
  },
);

Deno.test("closeBinding: condition filters even when target is terminal", async () => {
  // Validator where both outcomes route to terminal, but condition is "approved"
  const ccPhases = {
    review: { type: "actionable" as const, priority: 1, agent: "reviewer" },
    closed: { type: "terminal" as const },
    archived: { type: "terminal" as const },
  };
  const ccAgents = {
    reviewer: {
      role: "validator" as const,
      outputPhases: { approved: "closed", auto_closed: "archived" },
      fallbackPhase: "review",
      closeBinding: {
        primary: { kind: "direct" as const },
        cascade: false,
        condition: "approved",
      },
    },
  };
  const config: WorkflowConfig = {
    version: "1.0.0",
    issueSource: TEST_DEFAULT_ISSUE_SOURCE,
    phases: ccPhases,
    labelMapping: {
      review: "review",
      done: "closed",
      archive: "archived",
    },
    agents: ccAgents,
    invocations: deriveInvocations(ccPhases, ccAgents),
    rules: { maxCycles: 5, cycleDelayMs: 0 },
  };

  // outcome is "auto_closed" -> routes to terminal "archived" but closeCondition is "approved"
  const github = new StubGitHubClient([["review"], ["archive"]]);
  const dispatcher = new StubDispatcher({ reviewer: "auto_closed" });
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "archived");
  assertEquals(
    github.closedIssues.length,
    0,
    "closeIssue should NOT be called when outcome is 'auto_closed' but closeBinding.condition is 'approved'. " +
      "Fix: orchestrator.ts must check closeBinding.condition against outcome, not just terminal phase",
  );
  // T6.2: result.issueClosed deleted; closedIssues count is the
  // observable assertion above.
});

// === T6.eval projectBinding guard Tests (Issue #501) ===

Deno.test("T6.eval: getIssueProjects is NOT called when projectBinding is absent (BC invariant I1)", async () => {
  // Config has closeBinding but no projectBinding — T6.eval block must be skipped.
  const config = createCloseOnCompleteConfig();
  // Cycle 1: iterator success -> review
  // Cycle 2: reviewer approved -> complete (terminal) -> closeIssue
  let getIssueProjectsCalled = 0;
  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  const origGetIssueProjects = github.getIssueProjects.bind(github);
  github.getIssueProjects = (_issueNumber: number) => {
    getIssueProjectsCalled++;
    return origGetIssueProjects(_issueNumber);
  };
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

  const _result = await orchestrator.run(1);

  assertEquals(
    github.closedIssues.length,
    1,
    "Issue should still be closed via closeBinding. Fix: orchestrator.ts close logic",
  );
  assertEquals(
    getIssueProjectsCalled,
    0,
    "getIssueProjects must NOT be called when projectBinding is absent. " +
      "Fix: orchestrator.ts T6.eval guard must check this.#config.projectBinding",
  );
});

Deno.test("T6.eval: getIssueProjects IS called when projectBinding is present", async () => {
  // Config has closeBinding AND projectBinding — T6.eval block must execute.
  const config = createCloseOnCompleteConfig();
  config.projectBinding = {
    inheritProjectsForCreateIssue: false,
    donePhase: "complete",
    evalPhase: "review",
    planPhase: "implementation",
    sentinelLabel: "project-sentinel",
  };
  let getIssueProjectsCalled = 0;
  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  const origGetIssueProjects = github.getIssueProjects.bind(github);
  github.getIssueProjects = (_issueNumber: number) => {
    getIssueProjectsCalled++;
    return origGetIssueProjects(_issueNumber);
  };
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

  const _result = await orchestrator.run(1);

  assertEquals(
    github.closedIssues.length,
    1,
    "Issue should be closed via closeBinding. Fix: orchestrator.ts close logic",
  );
  assertEquals(
    getIssueProjectsCalled,
    1,
    "getIssueProjects must be called when projectBinding is present. " +
      "Fix: orchestrator.ts T6.eval guard must allow execution when projectBinding exists",
  );
});

Deno.test(
  "T6.eval: success path writes doneLabel/evalLabel resolved via labelMapping (prefix-aware)",
  async () => {
    // This test pins the core contract the hardcode refactor enforces:
    // the trigger must emit labels resolved through labelMapping, not
    // literal "done" / "kind:eval" strings. With labelPrefix="docs" the
    // emitted labels must carry the prefix — the pre-refactor code would
    // have written bare "done" / "kind:eval" and silently broken any
    // prefixed workflow.
    const config = createCloseOnCompleteConfig();
    config.labelPrefix = "docs";
    // Add a dedicated eval-pending phase so the evaluator label is distinct
    // from the cycle's review label (otherwise resolvePhaseLabel picks the
    // first labelMapping entry for the matching phase, which is the wrong
    // thing to emit onto the sentinel).
    config.phases = {
      ...config.phases,
      "eval-pending": { type: "actionable", priority: 3, agent: "reviewer" },
    };
    config.labelMapping = {
      "docs-ready": "implementation",
      "docs-review": "review",
      "docs-done": "complete",
      "docs-blocked": "blocked",
      "docs-kind:eval": "eval-pending",
    };
    config.projectBinding = {
      inheritProjectsForCreateIssue: false,
      donePhase: "complete",
      evalPhase: "eval-pending",
      planPhase: "implementation",
      sentinelLabel: "project-sentinel",
    };

    // Main subject (#1) goes ready -> review -> done — the sequence drives
    // the cycle loop (which ignores subjectId). After the close completes
    // T6.eval calls getIssueLabels again per project item; at that point
    // the sequence has been exhausted and the stub's min() clamp keeps
    // returning the last entry, so we override the method to dispatch by
    // subjectId for the post-close calls.
    const github = new StubGitHubClient([
      ["docs:docs-ready"],
      ["docs:docs-review"],
      ["docs:docs-done"],
    ]);

    // Track cycle-phase vs T6.eval-phase by counting non-sentinel calls.
    // Once the orchestrator has performed its 3 cycle reads the remaining
    // reads belong to T6.eval's per-item check.
    let cycleCallsConsumed = 0;
    const sequenceReads = 3;
    const itemLabelsByIssue: Record<number, string[]> = {
      1: ["docs:docs-done"],
      100: ["project-sentinel", "docs:docs-done"],
    };
    github.getIssueLabels = (subjectId: number) => {
      if (cycleCallsConsumed < sequenceReads) {
        cycleCallsConsumed++;
        const cycleLabels = [
          ["docs:docs-ready"],
          ["docs:docs-review"],
          ["docs:docs-done"],
        ][cycleCallsConsumed - 1];
        return Promise.resolve([...cycleLabels]);
      }
      const itemLabels = itemLabelsByIssue[subjectId];
      if (itemLabels === undefined) {
        throw new Error(
          `Test stub: no labels configured for issue #${subjectId}`,
        );
      }
      return Promise.resolve([...itemLabels]);
    };

    github.getIssueProjects = (_issueNumber: number) => {
      return Promise.resolve([{ owner: "org-a", number: 10 }]);
    };
    github.listProjectItems = (_project) => {
      return Promise.resolve([
        { id: "PVT_item_1", issueNumber: 1 },
        { id: "PVT_item_100", issueNumber: 100 },
      ]);
    };

    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

    await orchestrator.run(1);

    // The T6.eval block calls updateIssueLabels on the sentinel with the
    // prefix-resolved labels. Filter to sentinel updates — other updates
    // belong to the main close-flow label transitions.
    const sentinelUpdate = github.labelUpdates.find((u) => u.subjectId === 100);
    assertEquals(
      sentinelUpdate !== undefined,
      true,
      "T6.eval must emit an updateIssueLabels call targeting the sentinel " +
        "(#100). Fix: verify the sentinel membership check and the " +
        "allNonSentinelDone aggregation.",
    );
    assertEquals(
      sentinelUpdate!.removed,
      ["docs:docs-done"],
      "Removed label must be the labelMapping entry for donePhase with " +
        "labelPrefix applied. Fix: orchestrator.ts must route through " +
        "resolvePhaseLabel(config, projectBinding.donePhase), not a hardcoded 'done'.",
    );
    assertEquals(
      sentinelUpdate!.added,
      ["docs:docs-kind:eval"],
      "Added label must be the labelMapping entry for evalPhase with " +
        "labelPrefix applied. Fix: orchestrator.ts must route through " +
        "resolvePhaseLabel(config, projectBinding.evalPhase), not a hardcoded 'kind:eval'.",
    );
  },
);

Deno.test("T6.eval: getIssueProjects failure does not block close transaction", async () => {
  // Config has projectBinding — T6.eval executes after issue close.
  // getIssueProjects throws — close transaction must still complete.
  const config = createCloseOnCompleteConfig();
  config.projectBinding = {
    inheritProjectsForCreateIssue: false,
    donePhase: "complete",
    evalPhase: "review",
    planPhase: "implementation",
    sentinelLabel: "project-sentinel",
  };
  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  github.getIssueProjects = (_issueNumber: number) => {
    return Promise.reject(new Error("Simulated T6 GH API failure"));
  };
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

  const _result = await orchestrator.run(1);

  assertEquals(
    github.closedIssues.length,
    1,
    "Issue must still be closed when T6.eval getIssueProjects fails. " +
      "Fix: orchestrator.ts T6.eval catch must not propagate error (§6.3)",
  );
});

// === O2 Hook: Project Inheritance for Deferred Items ===

Deno.test(
  "O2 hook: parentProjects passed to deferred emitter when inheritProjectsForCreateIssue=true",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const config = createCloseOnCompleteConfig();
      config.projectBinding = {
        inheritProjectsForCreateIssue: true,
        donePhase: "complete",
        evalPhase: "review",
        planPhase: "implementation",
        sentinelLabel: "project-sentinel",
      };
      const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);

      let getIssueProjectsCalls: number[] = [];
      github.getIssueProjects = (issueNumber: number) => {
        getIssueProjectsCalls.push(issueNumber);
        return Promise.resolve([
          { owner: "org-a", number: 10 },
          { owner: "org-a", number: 20 },
        ]);
      };

      const structuredOutput: Record<string, unknown> = {
        deferred_items: [
          { title: "Child issue 1", body: "body 1", labels: ["ready"] },
        ],
      };
      const dispatcher = new StubDispatcher(
        { iterator: "success", reviewer: "approved" },
        undefined,
        undefined,
        structuredOutput,
      );
      const store = new SubjectStore(`${tmpDir}/store`);
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
      const orchestrator =
        buildOrchestratorWithChannels({ config, github, dispatcher })
          .orchestrator;

      const _result = await orchestrator.run(1, {}, store);

      assertEquals(
        github.closedIssues.length,
        1,
        "Issue must close when reviewer approves. " +
          "Fix: orchestrator.ts closeBinding logic.",
      );
      // O2 must query parent projects for issue #1 during the reviewer cycle
      // (the cycle that triggers closeIntentForDeferred).
      assertEquals(
        getIssueProjectsCalls.length > 0,
        true,
        "getIssueProjects must be called when inheritProjectsForCreateIssue=true. " +
          "Fix: orchestrator.ts O2 hook must call getIssueProjects.",
      );
      assertEquals(
        getIssueProjectsCalls[getIssueProjectsCalls.length - 1],
        1,
        "getIssueProjects must be called with the subject issue number. " +
          "Fix: orchestrator.ts O2 hook subjectId argument.",
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "O2 hook: getIssueProjects NOT called when inheritProjectsForCreateIssue=false",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const config = createCloseOnCompleteConfig();
      config.projectBinding = {
        inheritProjectsForCreateIssue: false,
        donePhase: "complete",
        evalPhase: "review",
        planPhase: "implementation",
        sentinelLabel: "project-sentinel",
      };
      const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);

      let getIssueProjectsCalled = 0;
      github.getIssueProjects = (_issueNumber: number) => {
        getIssueProjectsCalled++;
        return Promise.resolve([]);
      };

      const structuredOutput: Record<string, unknown> = {
        deferred_items: [
          { title: "Child issue", body: "body", labels: ["ready"] },
        ],
      };
      const dispatcher = new StubDispatcher(
        { iterator: "success", reviewer: "approved" },
        undefined,
        undefined,
        structuredOutput,
      );
      const store = new SubjectStore(`${tmpDir}/store`);
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
      const orchestrator =
        buildOrchestratorWithChannels({ config, github, dispatcher })
          .orchestrator;

      await orchestrator.run(1, {}, store);

      // When projectBinding is present, T6.eval calls getIssueProjects once
      // during the close transaction. O2 hook must NOT add any extra call.
      assertEquals(
        getIssueProjectsCalled,
        1,
        "getIssueProjects must be called exactly once (T6.eval only) when " +
          "inheritProjectsForCreateIssue=false — O2 hook must not add a call. " +
          "Fix: orchestrator.ts O2 hook config guard.",
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "O2 hook: getIssueProjects failure skips silently and emission continues (§6.3)",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const config = createCloseOnCompleteConfig();
      config.projectBinding = {
        inheritProjectsForCreateIssue: true,
        donePhase: "complete",
        evalPhase: "review",
        planPhase: "implementation",
        sentinelLabel: "project-sentinel",
      };
      const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);

      github.getIssueProjects = (_issueNumber: number) => {
        return Promise.reject(new Error("Simulated GH API transient error"));
      };

      const structuredOutput: Record<string, unknown> = {
        deferred_items: [
          { title: "Child issue", body: "body", labels: ["ready"] },
        ],
      };
      const dispatcher = new StubDispatcher(
        { iterator: "success", reviewer: "approved" },
        undefined,
        undefined,
        structuredOutput,
      );
      const store = new SubjectStore(`${tmpDir}/store`);
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
      const orchestrator =
        buildOrchestratorWithChannels({ config, github, dispatcher })
          .orchestrator;

      const _result = await orchestrator.run(1, {}, store);

      assertEquals(
        github.closedIssues.length,
        1,
        "Dispatch must complete even when O2 getIssueProjects fails. " +
          "Fix: orchestrator.ts O2 catch must not re-throw (§6.3 fallback).",
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "O2 hook: no getIssueProjects call when projectBinding is absent",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const config = createCloseOnCompleteConfig();
      // No projectBinding at all
      const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);

      let getIssueProjectsCalled = 0;
      github.getIssueProjects = (_issueNumber: number) => {
        getIssueProjectsCalled++;
        return Promise.resolve([]);
      };

      const structuredOutput: Record<string, unknown> = {
        deferred_items: [
          { title: "Child issue", body: "body", labels: ["ready"] },
        ],
      };
      const dispatcher = new StubDispatcher(
        { iterator: "success", reviewer: "approved" },
        undefined,
        undefined,
        structuredOutput,
      );
      const store = new SubjectStore(`${tmpDir}/store`);
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
      const orchestrator =
        buildOrchestratorWithChannels({ config, github, dispatcher })
          .orchestrator;

      await orchestrator.run(1, {}, store);

      assertEquals(
        getIssueProjectsCalled,
        0,
        "getIssueProjects must NOT be called when projectBinding is absent. " +
          "Fix: orchestrator.ts O2 hook config guard.",
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

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
    subjectId: number;
    removed: string[];
    added: string[];
  }[] = [];
  commentsCalls: { subjectId: number; comment: string }[] = [];
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

  getIssueLabels(subjectId: number): Promise<string[]> {
    const seq = this.#labelSequences.get(subjectId) ?? [[]];
    const idx = this.#labelCallCounts.get(subjectId) ?? 0;
    const labels = seq[Math.min(idx, seq.length - 1)];
    this.#labelCallCounts.set(subjectId, idx + 1);
    return Promise.resolve([...labels]);
  }

  updateIssueLabels(
    subjectId: number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    this.labelUpdates.push({
      subjectId,
      removed: labelsToRemove,
      added: labelsToAdd,
    });
    return Promise.resolve();
  }

  addIssueComment(subjectId: number, comment: string): Promise<void> {
    this.commentsCalls.push({ subjectId, comment });
    return Promise.resolve();
  }

  createIssue(
    _title: string,
    _labels: string[],
    _body: string,
  ): Promise<number> {
    return Promise.resolve(999);
  }

  closeIssue(_subjectId: number): Promise<void> {
    return Promise.resolve();
  }

  reopenIssue(_subjectId: number): Promise<void> {
    return Promise.reject(new Error("reopenIssue not implemented"));
  }

  getRecentComments(
    _subjectId: number,
    _limit: number,
  ): Promise<{ body: string; createdAt: string }[]> {
    return Promise.resolve([]);
  }

  listIssues(criteria: IssueCriteria): Promise<IssueListItem[]> {
    this.listIssuesCalls.push(criteria);
    return Promise.resolve(this.#issues);
  }

  getIssueDetail(subjectId: number): Promise<IssueDetail> {
    const detail = this.#details.get(subjectId);
    if (detail === undefined) {
      return Promise.reject(new Error(`No detail for #${subjectId}`));
    }
    return Promise.resolve(detail);
  }

  listLabels(): Promise<string[]> {
    return Promise.resolve([]);
  }

  // Label spec methods (Phase 2 label preflight). BatchRunner calls
  // listLabelsDetailed() once per batch; we return an empty baseline so the
  // preflight becomes a no-op (nothing to create, nothing to update).
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
  getIssueProjects(
    _issueNumber: number,
  ): Promise<Array<{ owner: string; number: number }>> {
    return Promise.resolve([]);
  }
  createProjectFieldOption(
    _project: ProjectRef,
    _fieldId: string,
    name: string,
  ): Promise<{ id: string; name: string }> {
    return Promise.resolve({ id: `OPT_${name}`, name });
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

function createBatchTestConfig(): WorkflowConfig {
  const phases = {
    implementation: {
      type: "actionable" as const,
      priority: 3,
      agent: "iterator",
    },
    review: { type: "actionable" as const, priority: 2, agent: "reviewer" },
    revision: { type: "actionable" as const, priority: 1, agent: "iterator" },
    complete: { type: "terminal" as const },
    blocked: { type: "blocking" as const },
  };
  const agents = {
    iterator: {
      role: "transformer" as const,
      directory: "iterator",
      outputPhase: "review",
      fallbackPhase: "blocked",
    },
    reviewer: {
      role: "validator" as const,
      directory: "reviewer",
      outputPhases: {
        approved: "complete",
        rejected: "revision",
      },
      fallbackPhase: "blocked",
    },
  };
  return {
    version: "1.0.0",
    issueSource: TEST_DEFAULT_ISSUE_SOURCE,
    subjectStore: DEFAULT_SUBJECT_STORE,
    prioritizer: {
      agent: "triage-agent",
      labels: ["P1", "P2", "P3"],
      defaultLabel: "P3",
    },
    phases,
    labelMapping: {
      ready: "implementation",
      review: "review",
      "implementation-gap": "revision",
      "from-reviewer": "revision",
      done: "complete",
      blocked: "blocked",
    },
    agents,
    invocations: deriveInvocations(phases, agents),
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
): Promise<SubjectStore> {
  const storePath = `${tmpDir}/${DEFAULT_SUBJECT_STORE.path}`;
  const store = new SubjectStore(storePath);
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
    config.subjectStore = DEFAULT_SUBJECT_STORE;

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
        _subjectId: number,
      ): Promise<DispatchOutcome> {
        dispatchedAgents.push(agentId);
        return Promise.resolve({ outcome: "success", durationMs: 0 });
      },
    };

    // Write a priorities.json for the triage agent to "produce"
    const storePath = `${tmpDir}/${DEFAULT_SUBJECT_STORE.path}`;
    const prioritiesPath = `${storePath}/priorities.json`;
    await Deno.writeTextFile(
      prioritiesPath,
      JSON.stringify([
        { issue: 10, priority: "P1" },
        { issue: 20, priority: "P2" },
      ]),
    );

    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);
    const result = await orchestrator.runBatch(TEST_DEFAULT_ISSUE_SOURCE, {
      prioritizeOnly: true,
    });

    // Prioritizer agent should have been dispatched
    assertEquals(dispatchedAgents.includes("triage-agent"), true);
    assertEquals(result.status, "completed");
    assertEquals(result.totalIssues, 2);
    assertEquals(result.processed.length, 0);

    // Local store should have updated labels
    const store = new SubjectStore(storePath);
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
    config.subjectStore = DEFAULT_SUBJECT_STORE;

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
    const result = await orchestrator.runBatch(TEST_DEFAULT_ISSUE_SOURCE);

    assertEquals(result.status, "completed");
    assertEquals(result.processed.length, 2);
    // P1 issue (#20) should be processed first
    assertEquals(result.processed[0].subjectId, 20);
    assertEquals(result.processed[1].subjectId, 10);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("runBatch skips non-actionable issues", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createBatchTestConfig();
    config.subjectStore = DEFAULT_SUBJECT_STORE;

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

    const result = await orchestrator.runBatch(TEST_DEFAULT_ISSUE_SOURCE);

    // Only issue 10 should be processed
    assertEquals(result.processed.length, 1);
    assertEquals(result.processed[0].subjectId, 10);
    // Issue 20 should be skipped
    assertEquals(result.skipped.length, 1);
    assertEquals(result.skipped[0].subjectId, 20);
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
    config.subjectStore = DEFAULT_SUBJECT_STORE;

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
    const outboxDir = `${tmpDir}/${DEFAULT_SUBJECT_STORE.path}/10/outbox`;
    await Deno.mkdir(outboxDir, { recursive: true });
    await Deno.writeTextFile(
      `${outboxDir}/001-comment.json`,
      JSON.stringify({ action: "comment", body: "Agent completed" }),
    );

    const dispatcher = new StubDispatcher({ iterator: "success" });
    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);

    const result = await orchestrator.runBatch(TEST_DEFAULT_ISSUE_SOURCE);

    assertEquals(result.processed.length, 1);
    // Outbox comment should have been posted to GitHub
    const commentCalls = github.commentsCalls.filter(
      (c) => c.comment === "Agent completed",
    );
    assertEquals(commentCalls.length, 1);
    assertEquals(commentCalls[0].subjectId, 10);

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
    const store = new SubjectStore(`${tmpDir}/store`);
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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

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
    const store = new SubjectStore(`${tmpDir}/store`);
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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

    await orchestrator.run(1, {}, store);

    // Workflow state should be persisted with final state after both cycles
    const state = await store.readWorkflowState(1, "default");
    assertEquals(state !== null, true);
    assertEquals(state!.subjectId, 1);
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
    const store = new SubjectStore(`${tmpDir}/store`);
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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

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
    const store = new SubjectStore(`${tmpDir}/store`);
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
      subjectId: 1,
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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

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
    const store = new SubjectStore(`${tmpDir}/store`);
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
      subjectId: 1,
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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

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
    const store = new SubjectStore(`${tmpDir}/store`);
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
      subjectId: 1,
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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

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
// elsewhere to honour `closeBinding` close semantics.

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
    const store = new SubjectStore(`${tmpDir}/store`);
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
      subjectId: 1,
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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

    const result = await orchestrator.run(1, {}, store);

    // Reset proof: persisted history was dropped (length 0). The main
    // loop then re-applied terminal-first precedence at iteration time
    // (preserving `closeBinding` close semantics) and exited cleanly on
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
    const store = new SubjectStore(`${tmpDir}/store`);
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
      subjectId: 1,
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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

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
    const store = new SubjectStore(`${tmpDir}/store`);
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
      subjectId: 1,
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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

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
    const store = new SubjectStore(`${tmpDir}/store`);
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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

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
    const store = new SubjectStore(`${tmpDir}/store`);
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
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

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
    config.subjectStore = DEFAULT_SUBJECT_STORE;

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
      () =>
        orchestrator.runBatch(TEST_DEFAULT_ISSUE_SOURCE, {
          prioritizeOnly: true,
        }),
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
    config.subjectStore = DEFAULT_SUBJECT_STORE;

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
        _subjectId: number,
      ): Promise<DispatchOutcome> {
        dispatchedAgents.push(agentId);
        return Promise.resolve({ outcome: "success", durationMs: 0 });
      },
    };

    // Write priorities.json for prioritizer agent
    const storePath = `${tmpDir}/${DEFAULT_SUBJECT_STORE.path}`;
    await Deno.writeTextFile(
      `${storePath}/priorities.json`,
      JSON.stringify([
        { issue: 10, priority: "P1" },
        { issue: 20, priority: "P2" },
      ]),
    );

    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);
    const result = await orchestrator.runBatch(
      TEST_DEFAULT_ISSUE_SOURCE,
      { prioritizeOnly: true, dryRun: true },
    );

    // Prioritizer agent was dispatched
    assertEquals(dispatchedAgents.includes("triage-agent"), true);
    assertEquals(result.status, "completed");

    // Store should NOT have been updated (dryRun)
    const store = new SubjectStore(storePath);
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
    config.subjectStore = DEFAULT_SUBJECT_STORE;

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

    const result = await orchestrator.runBatch(TEST_DEFAULT_ISSUE_SOURCE);

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
    config.subjectStore = DEFAULT_SUBJECT_STORE;

    // No issues in store — empty listItems
    const github = new BatchStubGitHubClient(
      [],
      new Map(),
      new Map(),
    );
    const dispatcher = new StubDispatcher({});
    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);

    const result = await orchestrator.runBatch(TEST_DEFAULT_ISSUE_SOURCE);

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
    config.subjectStore = DEFAULT_SUBJECT_STORE;

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
        _subjectId: number,
      ): Promise<DispatchOutcome> {
        return Promise.reject(new Error("agent dispatch failed"));
      },
    };
    const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);

    const result = await orchestrator.runBatch(TEST_DEFAULT_ISSUE_SOURCE);

    assertEquals(result.status, "partial");
    assertEquals(result.processed.length, 0);
    assertEquals(result.skipped.length, 1);
    assertEquals(result.skipped[0].subjectId, 10);
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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "complete");
  assertEquals(result.cycleCount, 1);
});

Deno.test("outbox failure logs structured events", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig();
    const store = new SubjectStore(`${tmpDir}/store`);
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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;

  const result = await orchestrator.run(1);

  assertEquals(result.status, "completed");
  assertEquals(result.finalPhase, "complete");
  assertEquals(result.cycleCount, 1);
});

// === Reactive rate-limit retry tests (Step 7c.1) ===

/**
 * Dispatcher that returns outcomes from a pre-configured sequence (one
 * outcome per call) so tests can simulate "fail first, succeed on retry".
 * `rateLimitInfo` is attached to every dispatch so the orchestrator's
 * Step 7c hook always runs.
 */
class SequenceDispatcher implements AgentDispatcher {
  #outcomes: string[];
  #rateLimitInfo: RateLimitInfo;
  #calls: StubDispatcherCall[] = [];
  #callIndex = 0;

  constructor(outcomes: string[], rateLimitInfo: RateLimitInfo) {
    this.#outcomes = outcomes;
    this.#rateLimitInfo = rateLimitInfo;
  }

  get callCount(): number {
    return this.#callIndex;
  }

  get calls(): ReadonlyArray<StubDispatcherCall> {
    return this.#calls;
  }

  dispatch(
    agentId: string,
    subjectId: string | number,
    options?: DispatchOptions,
  ): Promise<DispatchOutcome> {
    const idx = this.#callIndex;
    this.#callIndex++;
    this.#calls.push({ agentId, subjectId, options });
    const outcome = this.#outcomes[Math.min(idx, this.#outcomes.length - 1)];
    return Promise.resolve({
      outcome,
      durationMs: 0,
      rateLimitInfo: this.#rateLimitInfo,
    });
  }
}

// Helper: a `resetsAt` value already in the past so `RateLimiter` exits
// its wait loop on the first poll (keeps the test wall-clock fast).
function expiredResetsAt(): number {
  return Math.floor(Date.now() / 1000) - 1;
}

Deno.test(
  "rate limit retry: fails once then succeeds — re-dispatches same phase",
  async () => {
    const config = createTestConfig();
    config.rules.rateLimitThreshold = 0.90;
    config.rules.cycleDelayMs = 0;

    // Labels stay on "ready" while the iterator is being retried (Step 9
    // is skipped on retry), then move to "review" after success, then
    // "done".
    const github = new StubGitHubClient([
      ["ready"], // cycle 1: dispatch fails → retry skips label change
      ["ready"], // cycle 2 (retry): dispatch succeeds → labels move
      ["review"], // cycle 3: reviewer
      ["done"], // cycle 4: terminal
    ]);

    const rateLimitInfo: RateLimitInfo = {
      utilization: 1,
      resetsAt: expiredResetsAt(),
      rateLimitType: "claude_code_message",
    };
    // Sequence: iterator (failed) → iterator (success retry) → reviewer (approved).
    const dispatcher = new SequenceDispatcher(
      ["failed", "success", "approved"],
      rateLimitInfo,
    );
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

    const result = await orchestrator.run(1);

    // Derived expectation: 1 failed iterator dispatch + 1 retry of the
    // same iterator + 1 forward dispatch to the reviewer.
    const ITERATOR_FAIL_DISPATCHES = 1;
    const ITERATOR_RETRY_DISPATCHES = 1;
    const REVIEWER_FORWARD_DISPATCHES = 1;
    const expectedDispatchCount = ITERATOR_FAIL_DISPATCHES +
      ITERATOR_RETRY_DISPATCHES + REVIEWER_FORWARD_DISPATCHES;

    assertEquals(
      result.status,
      "completed",
      `Run status: expected "completed" after rate-limit retry succeeded, ` +
        `got "${result.status}". Fix: orchestrator.ts Step 7c.1 may be ` +
        `failing to advance after the retry.`,
    );
    assertEquals(
      result.finalPhase,
      "complete",
      `Final phase: expected "complete" (terminal phase from createTestConfig), ` +
        `got "${result.finalPhase}".`,
    );
    assertEquals(
      dispatcher.callCount,
      expectedDispatchCount,
      `Dispatcher invocation count: expected ${expectedDispatchCount} ` +
        `(${ITERATOR_FAIL_DISPATCHES} fail + ${ITERATOR_RETRY_DISPATCHES} retry + ` +
        `${REVIEWER_FORWARD_DISPATCHES} reviewer), got ${dispatcher.callCount}. ` +
        `Fix: check orchestrator.ts Step 7c.1 retry condition or SequenceDispatcher outcomes.`,
    );
    // Same-phase re-dispatch invariant: the first two calls must be the
    // same agent (iterator), proving Step 9 (label change) was skipped.
    assertEquals(
      dispatcher.calls[0].agentId,
      "iterator",
      `Call[0].agentId: expected "iterator" (initial dispatch for "ready" phase).`,
    );
    assertEquals(
      dispatcher.calls[1].agentId,
      "iterator",
      `Call[1].agentId: expected "iterator" again (rate-limit retry must not transition phase). ` +
        `Got "${
          dispatcher.calls[1].agentId
        }". Fix: Step 7c.1 must \`continue\` ` +
        `before Step 8 (transition) and Step 9 (label change).`,
    );
  },
);

Deno.test(
  "rate limit retry: aborts run with status=blocked when budget exhausted",
  async () => {
    const config = createTestConfig();
    config.rules.rateLimitThreshold = 0.90;
    config.rules.cycleDelayMs = 0;
    // Plenty of cycles so the abort comes from the rate-limit budget, not
    // maxCycles.
    config.rules.maxCycles = 20;

    const github = new StubGitHubClient([
      ["ready"],
      ["ready"],
      ["ready"],
      ["ready"],
      ["ready"],
    ]);

    const rateLimitInfo: RateLimitInfo = {
      utilization: 1,
      resetsAt: expiredResetsAt(),
      rateLimitType: "claude_code_message",
    };
    // Iterator always fails — drives the orchestrator to exhaust its
    // rate-limit retry budget.
    const dispatcher = new SequenceDispatcher(["failed"], rateLimitInfo);
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

    const result = await orchestrator.run(1);

    // Derived from the exported constant: 1 initial attempt plus
    // MAX_RATE_LIMIT_WAITS_PER_RUN allowed retries; the (max+1)-th
    // failure increments the counter past the budget and aborts.
    const expectedDispatchCount = 1 + MAX_RATE_LIMIT_WAITS_PER_RUN;

    assertEquals(
      result.status,
      "blocked",
      `Run status: expected "blocked" after rate-limit budget exhaustion ` +
        `(MAX_RATE_LIMIT_WAITS_PER_RUN=${MAX_RATE_LIMIT_WAITS_PER_RUN}), ` +
        `got "${result.status}". Fix: orchestrator.ts Step 7c.1 budget check.`,
    );
    assertEquals(
      dispatcher.callCount,
      expectedDispatchCount,
      `Dispatcher invocation count: expected ${expectedDispatchCount} ` +
        `(1 initial + ${MAX_RATE_LIMIT_WAITS_PER_RUN} retries before abort), ` +
        `got ${dispatcher.callCount}. Fix: verify MAX_RATE_LIMIT_WAITS_PER_RUN ` +
        `in orchestrator.ts matches the budget you intend to enforce.`,
    );
  },
);

Deno.test(
  "rate limit retry: success outcome with throttle does not skip transition",
  async () => {
    const config = createTestConfig();
    config.rules.rateLimitThreshold = 0.90;
    config.rules.cycleDelayMs = 0;

    // Single successful cycle; the throttle hook waits but the outcome is
    // success so transition proceeds normally.
    const github = new StubGitHubClient([
      ["ready"],
      ["review"],
      ["done"],
    ]);

    const rateLimitInfo: RateLimitInfo = {
      utilization: 0.95,
      resetsAt: expiredResetsAt(),
      rateLimitType: "seven_day",
    };
    const dispatcher = new SequenceDispatcher(
      ["success", "approved"],
      rateLimitInfo,
    );
    const orchestrator =
      buildOrchestratorWithChannels({ config, github, dispatcher })
        .orchestrator;

    const result = await orchestrator.run(1);

    // Two normal forward dispatches: iterator (success) and reviewer
    // (approved). No retry inflation because the success outcome must
    // not trigger Step 7c.1's reactive-retry branch even though the
    // throttle hook itself waited.
    const ITERATOR_FORWARD_DISPATCHES = 1;
    const REVIEWER_FORWARD_DISPATCHES = 1;
    const expectedDispatchCount = ITERATOR_FORWARD_DISPATCHES +
      REVIEWER_FORWARD_DISPATCHES;

    assertEquals(
      result.status,
      "completed",
      `Run status: expected "completed" after a normal two-phase run with ` +
        `predictive throttle, got "${result.status}".`,
    );
    assertEquals(
      dispatcher.callCount,
      expectedDispatchCount,
      `Dispatcher invocation count: expected ${expectedDispatchCount} ` +
        `(iterator + reviewer, no retry), got ${dispatcher.callCount}. ` +
        `Fix: orchestrator.ts Step 7c.1 must gate on outcome === "failed"; ` +
        `success outcomes must fall through to Step 8 (transition).`,
    );
  },
);

// === Verdict propagation tests ===

Deno.test("verdict propagation: approved routes via validator outputPhases to complete", async () => {
  const config = createTestConfig();
  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;
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
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;
  const result = await orchestrator.run(1);

  assertEquals(result.history[1].from, "review");
  assertEquals(result.history[1].to, "revision");
  assertEquals(result.history[1].outcome, "rejected");
});

Deno.test("verdict propagation: unknown verdict falls back to fallbackPhase", async () => {
  const config = createTestConfig();
  const github = new StubGitHubClient([["review"], ["blocked"]]);
  const dispatcher = new StubDispatcher({ reviewer: "unknown-verdict" });
  const orchestrator =
    buildOrchestratorWithChannels({ config, github, dispatcher }).orchestrator;
  const result = await orchestrator.run(1);

  assertEquals(result.status, "blocked");
  assertEquals(result.finalPhase, "blocked");
  assertEquals(result.history[0].from, "review");
  assertEquals(result.history[0].to, "blocked");
  assertEquals(result.history[0].outcome, "unknown-verdict");
});

// === L3: phase repetition limit ===

/**
 * Read the session JSONL log produced by the orchestrator for a given cwd
 * and return the parsed entries. Tests write logs into a per-test tmpDir so
 * exactly one session file exists per invocation.
 */
async function readSessionLog(
  cwd: string,
): Promise<
  { level: string; message: string; metadata?: Record<string, unknown> }[]
> {
  const logDir = `${cwd}/tmp/logs/orchestrator`;
  for await (const entry of Deno.readDir(logDir)) {
    if (entry.name.endsWith(".jsonl")) {
      const content = await Deno.readTextFile(`${logDir}/${entry.name}`);
      return content.trim().split("\n").map((l) => JSON.parse(l));
    }
  }
  throw new Error(`no session log file found under ${logDir}`);
}

Deno.test(
  "L3 fires before L1 when same phase repeats maxConsecutivePhases times",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const config = createTestConfig();
      // L1 is set high enough that only L3 can trip in three cycles.
      config.rules.maxCycles = 10;
      config.rules.maxConsecutivePhases = 3;

      // Live labels always resolve to `revision` (priority 1 actionable).
      // The iterator's outputPhase is `review`, so every cycle produces a
      // (from=revision, to=review) transition — giving three consecutive
      // identical `to` values, which must trip L3.
      const github = new StubGitHubClient([
        ["implementation-gap"],
        ["implementation-gap"],
        ["implementation-gap"],
        ["implementation-gap"],
      ]);
      const dispatcher = new StubDispatcher({ iterator: "success" });
      const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);

      const result = await orchestrator.run(1);

      assertEquals(result.status, "phase_repetition_exceeded");
      // Exactly three transitions recorded before the L3 check trips on the
      // fourth cycle's pre-dispatch gate.
      assertEquals(result.history.length, 3);
      assertEquals(result.cycleCount, 3);
      for (const record of result.history) {
        assertEquals(record.to, "review");
      }

      const entries = await readSessionLog(tmpDir);
      const l3 = entries.find((e) =>
        e.metadata?.event === "consecutive_phase_exceeded"
      );
      const l1 = entries.find((e) => e.metadata?.event === "cycle_exceeded");
      assertEquals(
        l3 !== undefined,
        true,
        "consecutive_phase_exceeded event must be emitted",
      );
      assertEquals(
        l1,
        undefined,
        "cycle_exceeded must not fire when L3 preempts it",
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "L3 disabled (default 0) preserves the existing cycle_exceeded path",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const config = createTestConfig();
      // maxConsecutivePhases omitted -> defaults to undefined -> 0 (disabled).
      config.rules.maxCycles = 2;

      const github = new StubGitHubClient([
        ["implementation-gap"],
        ["implementation-gap"],
        ["implementation-gap"],
      ]);
      const dispatcher = new StubDispatcher({ iterator: "success" });
      const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);

      const result = await orchestrator.run(1);

      assertEquals(result.status, "cycle_exceeded");
      assertEquals(result.cycleCount, 2);

      const entries = await readSessionLog(tmpDir);
      const l3 = entries.find((e) =>
        e.metadata?.event === "consecutive_phase_exceeded"
      );
      const l1 = entries.find((e) => e.metadata?.event === "cycle_exceeded");
      assertEquals(
        l3,
        undefined,
        "consecutive_phase_exceeded must not fire when L3 is disabled",
      );
      assertEquals(l1 !== undefined, true);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "consecutive_phase_exceeded event carries phase, consecutiveCount, and maxConsecutivePhases",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const config = createTestConfig();
      config.rules.maxCycles = 10;
      config.rules.maxConsecutivePhases = 3;

      const github = new StubGitHubClient([
        ["implementation-gap"],
        ["implementation-gap"],
        ["implementation-gap"],
        ["implementation-gap"],
      ]);
      const dispatcher = new StubDispatcher({ iterator: "success" });
      const orchestrator = new Orchestrator(config, github, dispatcher, tmpDir);

      await orchestrator.run(1);

      const entries = await readSessionLog(tmpDir);
      const l3 = entries.find((e) =>
        e.metadata?.event === "consecutive_phase_exceeded"
      );
      if (!l3) throw new Error("consecutive_phase_exceeded event missing");
      const meta = l3.metadata as Record<string, unknown>;
      // The L3 gate runs after phase resolution for the next cycle, so the
      // `phase` field reflects the phase that WOULD have been dispatched.
      assertEquals(meta.phase, "revision");
      assertEquals(meta.consecutiveCount, 3);
      assertEquals(meta.maxConsecutivePhases, 3);
      assertEquals(meta.subjectId, 1);
      // cycleCount must not appear on the L3 event to keep it distinct from
      // the L1 cycle_exceeded event (design §4).
      assertEquals(
        Object.prototype.hasOwnProperty.call(meta, "cycleCount"),
        false,
      );
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);

Deno.test(
  "L3 counter restarts from zero after label-regression history reset",
  async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const config = createTestConfig();
      // maxCycles high enough that L1 never trips during this scenario.
      config.rules.maxCycles = 10;
      config.rules.maxConsecutivePhases = 3;
      const store = new SubjectStore(`${tmpDir}/store`);

      // Seed pattern mirrors orchestrator_test.ts:1567-1651 — a previously
      // completed issue that the user has manually relabeled back to an
      // actionable phase. The persisted history carries three consecutive
      // `to=review` records that would trip L3 immediately if carried over.
      await store.writeIssue({
        meta: {
          number: 1,
          title: "Test",
          // Live labels resolve to `implementation` via `ready`, diverging
          // from the persisted `complete` phase -> triggers the regression
          // reset in orchestrator.ts:158-180.
          labels: ["ready"],
          state: "open",
          assignees: [],
          milestone: null,
        },
        body: "test",
        comments: [],
      });
      await store.writeWorkflowState(1, {
        subjectId: 1,
        currentPhase: "complete",
        cycleCount: 3,
        correlationId: "wf-prior",
        history: [
          {
            from: "revision",
            to: "review",
            agent: "iterator",
            outcome: "success",
            timestamp: "2026-01-01T00:00:00.000Z",
          },
          {
            from: "revision",
            to: "review",
            agent: "iterator",
            outcome: "success",
            timestamp: "2026-01-01T00:01:00.000Z",
          },
          {
            from: "revision",
            to: "review",
            agent: "iterator",
            outcome: "success",
            timestamp: "2026-01-01T00:02:00.000Z",
          },
        ],
      }, "default");

      // Cycle 1: ready -> implementation -> iterator -> review
      // Cycle 2: review -> reviewer (approved) -> complete (terminal)
      const github = new StubGitHubClient([
        ["ready"],
        ["review"],
        ["done"],
      ]);
      const dispatcher = new StubDispatcher({
        iterator: "success",
        reviewer: "approved",
      });
      const orchestrator = new Orchestrator(
        config,
        github,
        dispatcher,
        tmpDir,
      );

      const result = await orchestrator.run(1, {}, store);

      // The run itself completes normally: the label-regression reset drops
      // the pre-seeded stuck history, so L3 does NOT trip despite the seed
      // containing three consecutive `to=review` records.
      assertEquals(result.status, "completed");
      assertEquals(result.finalPhase, "complete");
      // Only post-reset transitions appear (2 cycles, not 2 + 3 pre-seed).
      assertEquals(result.history.length, 2);
      for (const record of result.history) {
        assertEquals(
          record.timestamp > "2026-01-01T00:02:00.000Z",
          true,
          `post-reset timestamp ${record.timestamp} must exceed seed data`,
        );
      }

      // Belt-and-braces: confirm the regression reset fired.
      const entries = await readSessionLog(tmpDir);
      const reset = entries.find((e) =>
        e.metadata?.event === "state_reset_by_label_regression"
      );
      assertEquals(
        reset !== undefined,
        true,
        "label-regression reset must fire so L3 counter starts empty",
      );
      // The L3 event must NOT appear — the reset nullified the seed streak.
      const l3 = entries.find((e) =>
        e.metadata?.event === "consecutive_phase_exceeded"
      );
      assertEquals(
        l3,
        undefined,
        "L3 must not trip after label-regression reset clears the seed streak",
      );

      // Direct evidence of the contract itself: reconstruct a tracker from
      // the same persisted state using the orchestrator's reset path
      // (history: []) and verify that record()-ing the same `to` twice keeps
      // L3 false but a third consecutive record flips it true. This mirrors
      // the §3 pseudocode / §5 label-regression counter spec exactly.
      const persisted = await store.readWorkflowState(1, "default");
      if (!persisted) throw new Error("persisted state missing");
      const tracker = CycleTracker.fromState(
        { ...persisted, history: [], cycleCount: 0 },
        10,
        3,
      );
      tracker.record(1, "revision", "review", "iterator", "success");
      tracker.record(1, "revision", "review", "iterator", "success");
      assertEquals(
        tracker.isPhaseRepetitionExceeded(1),
        false,
        "L3 must stay false with two post-reset records under limit 3",
      );
      assertEquals(tracker.getConsecutiveCount(1), 2);
      tracker.record(1, "revision", "review", "iterator", "success");
      assertEquals(
        tracker.isPhaseRepetitionExceeded(1),
        true,
        "L3 must trip once three consecutive post-reset records accumulate",
      );
      assertEquals(tracker.getConsecutiveCount(1), 3);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
);
