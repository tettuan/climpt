/**
 * Emission tests (T3.5).
 *
 * Read-only assertions: every event variant in the 8-event ADT must be
 * published from its T3.3 emit site under a representative scenario.
 * The bus is observed; production behavior (verdict, phase, status) is
 * NOT asserted here — that's covered by site-local tests
 * (orchestrator_test.ts, outbox-processor_test.ts, etc.).
 *
 * Why a separate file?
 * - The 8-event ADT is the contract shared across sites. Asserting
 *   emission per-site would scatter the contract; consolidating here
 *   makes the closed enum's coverage visible at a glance.
 * - One scenario can publish multiple variants (e.g. orchestrator.run
 *   produces dispatchPlanned + dispatchCompleted + transitionComputed
 *   + issueClosed + siblingsAllClosed in a single saga). We assert the
 *   union, not the cardinality, so re-orderings inside the orchestrator
 *   don't break these tests.
 *
 * Subscribe-before-freeze: every test constructs a fresh
 * `createCloseEventBus()` (NOT the frozen bus from
 * `buildTestBootArtifacts`) and subscribes the collector pre-freeze.
 * This sidesteps F1 (subscribers must register before boot freeze) by
 * leaving the bus deliberately unfrozen — production freezes after
 * BootKernel.boot, but in shadow mode no consumer of "frozen" semantics
 * runs during these tests.
 *
 * @see agents/events/types.ts (8-event ADT — single source of truth)
 * @see agents/events/_test-helpers.ts (createEventCollector)
 */

import { assert, assertEquals } from "jsr:@std/assert@1";

import { createCloseEventBus } from "./bus.ts";
import { createEventCollector } from "./_test-helpers.ts";
import type { Event } from "./types.ts";

import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
  Project,
  ProjectField,
} from "../orchestrator/github-client.ts";
import type {
  ProjectFieldValue,
  ProjectRef,
} from "../orchestrator/outbox-processor.ts";
import {
  deriveInvocations,
  type WorkflowConfig,
} from "../orchestrator/workflow-types.ts";
import {
  buildTestDirectClose,
  TEST_DEFAULT_ISSUE_SOURCE,
} from "../orchestrator/_test-fixtures.ts";
import { StubDispatcher } from "../orchestrator/dispatcher.ts";
import { Orchestrator } from "../orchestrator/orchestrator.ts";
import { OutboxProcessor } from "../orchestrator/outbox-processor.ts";
import { SubjectStore } from "../orchestrator/subject-store.ts";
import { OutboxClosePreChannel } from "../channels/outbox-close-pre.ts";
import { BoundaryCloseChannel } from "../channels/boundary-close.ts";
import { CascadeCloseChannel } from "../channels/cascade-close.ts";
import { createRealCloseTransport } from "../transports/close-transport.ts";

import { BoundaryHooks } from "../runner/boundary-hooks.ts";
import { AgentEventEmitter } from "../runner/events.ts";
import { makeStep } from "../common/step-registry/test-helpers.ts";
import type { ExtendedStepsRegistry } from "../common/validation-types.ts";
import type { IterationSummary, RuntimeContext } from "../src_common/types.ts";

import {
  type ExternalStateAdapterConfig,
  ExternalStateVerdictAdapter,
} from "../verdict/external-state-adapter.ts";
import { IssueVerdictHandler } from "../verdict/issue.ts";
import { MockStateChecker } from "../verdict/external-state-checker.ts";

import { registerDiagnosticSubscriber } from "./diagnostic-subscriber.ts";

// ---------------------------------------------------------------------------
// Stubs reused across tests
// ---------------------------------------------------------------------------

/**
 * Minimal `GitHubClient` stub. Drives label sequences for the
 * orchestrator loop; everything else is inert. Distinct from
 * `orchestrator_test.ts` so this file stays self-contained — emission
 * tests must not break when site-local fixtures evolve.
 */
class StubGitHubClient implements GitHubClient {
  #labelSequence: string[][];
  #callIndex = 0;
  #closedIssues: number[] = [];
  #closeIssueShouldThrow = false;
  #projects: Array<{ owner: string; number: number }> = [];
  #projectItems: Array<{ id: string; issueNumber: number }> = [];
  #issueLabelsByNumber: Record<number, string[]> = {};

  constructor(labelSequence: string[][]) {
    this.#labelSequence = labelSequence;
  }

  setProjects(projects: Array<{ owner: string; number: number }>): void {
    this.#projects = projects;
  }

  setProjectItems(
    items: Array<{ id: string; issueNumber: number }>,
  ): void {
    this.#projectItems = items;
  }

  setIssueLabels(byNumber: Record<number, string[]>): void {
    this.#issueLabelsByNumber = byNumber;
  }

  setCloseIssueShouldThrow(v: boolean): void {
    this.#closeIssueShouldThrow = v;
  }

  get closedIssues(): readonly number[] {
    return this.#closedIssues;
  }

  getIssueLabels(subjectId: number): Promise<string[]> {
    // Per-issue override wins (used by sentinel-cascade tests where
    // the orchestrator inspects sibling labels mid-run).
    if (this.#issueLabelsByNumber[subjectId] !== undefined) {
      return Promise.resolve([...this.#issueLabelsByNumber[subjectId]]);
    }
    const idx = Math.min(this.#callIndex, this.#labelSequence.length - 1);
    const labels = this.#labelSequence[idx];
    this.#callIndex++;
    return Promise.resolve([...labels]);
  }

  updateIssueLabels(): Promise<void> {
    return Promise.resolve();
  }
  addIssueComment(): Promise<void> {
    return Promise.resolve();
  }
  createIssue(): Promise<number> {
    return Promise.resolve(999);
  }
  closeIssue(subjectId: number): Promise<void> {
    if (this.#closeIssueShouldThrow) {
      return Promise.reject(new Error("gh issue close failed"));
    }
    this.#closedIssues.push(subjectId);
    return Promise.resolve();
  }
  reopenIssue(): Promise<void> {
    return Promise.reject(new Error("not implemented"));
  }
  getRecentComments(): Promise<{ body: string; createdAt: string }[]> {
    return Promise.resolve([]);
  }
  listIssues(_c: IssueCriteria): Promise<IssueListItem[]> {
    return Promise.resolve([]);
  }
  getIssueDetail(): Promise<IssueDetail> {
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
  createLabel(): Promise<void> {
    return Promise.resolve();
  }
  updateLabel(): Promise<void> {
    return Promise.resolve();
  }
  addIssueToProject(): Promise<string> {
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
  closeProject(): Promise<void> {
    return Promise.resolve();
  }
  getProjectItemIdForIssue(): Promise<string | null> {
    return Promise.resolve(null);
  }
  listProjectItems(): Promise<{ id: string; issueNumber: number }[]> {
    return Promise.resolve([...this.#projectItems]);
  }
  getIssueProjects(): Promise<Array<{ owner: string; number: number }>> {
    return Promise.resolve([...this.#projects]);
  }
  createProjectFieldOption(
    _project: ProjectRef,
    _fieldId: string,
    name: string,
  ): Promise<{ id: string; name: string }> {
    return Promise.resolve({ id: `OPT_${name}`, name });
  }
  listUserProjects(): Promise<Project[]> {
    return Promise.resolve([]);
  }
  getProject(): Promise<Project> {
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
  getProjectFields(): Promise<ProjectField[]> {
    return Promise.resolve([]);
  }
  removeProjectItem(): Promise<void> {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Workflow config fixtures
// ---------------------------------------------------------------------------

/** Workflow with closeBinding direct on the reviewer (D-channel exercise). */
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

// ---------------------------------------------------------------------------
// 1/8 + 2/8 + 4/8: DispatchPlanned, DispatchCompleted, TransitionComputed
// ---------------------------------------------------------------------------

Deno.test("emission: DispatchPlanned + DispatchCompleted fire on every cycle", async () => {
  const bus = createCloseEventBus();
  const collector = createEventCollector(bus);

  const config = createCloseOnCompleteConfig();
  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator = new Orchestrator(
    config,
    github,
    dispatcher,
    /* cwd */ undefined,
    /* artifactEmitter */ undefined,
    /* agentRegistry */ undefined,
    bus,
    "test-run-1",
  );

  await orchestrator.run(1);

  const planned = collector.byKind("dispatchPlanned");
  const completed = collector.byKind("dispatchCompleted");
  assert(
    planned.length >= 1,
    `Expected dispatchPlanned to fire at least once; got ${planned.length}`,
  );
  assert(
    completed.length >= 1,
    `Expected dispatchCompleted to fire at least once; got ${completed.length}`,
  );
  // Payload sanity — assert the discriminator + structural fields, not
  // the entire shape (T3 emit sites own field-by-field correctness).
  assertEquals(planned[0].kind, "dispatchPlanned");
  assertEquals(planned[0].source, "workflow");
  assertEquals(typeof planned[0].agentId, "string");
  assertEquals(typeof planned[0].phase, "string");
  assertEquals(planned[0].runId, "test-run-1");

  assertEquals(completed[0].kind, "dispatchCompleted");
  assertEquals(typeof completed[0].outcome, "string");
  assertEquals(completed[0].runId, "test-run-1");
});

Deno.test("emission: TransitionComputed fires after computeTransition", async () => {
  const bus = createCloseEventBus();
  const collector = createEventCollector(bus);

  const config = createCloseOnCompleteConfig();
  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator = new Orchestrator(
    config,
    github,
    dispatcher,
    undefined,
    undefined,
    undefined,
    bus,
    "test-run-transition",
  );

  await orchestrator.run(1);

  const transitions = collector.byKind("transitionComputed");
  assert(
    transitions.length >= 2,
    `Expected at least 2 transitions (impl→review, review→complete); got ${transitions.length}`,
  );
  // First transition: implementation → review on iterator success.
  const first = transitions[0];
  assertEquals(first.fromPhase, "implementation");
  assertEquals(first.toPhase, "review");
  assertEquals(first.outcome, "success");
  // Second transition: review → complete on reviewer approved.
  const second = transitions[1];
  assertEquals(second.fromPhase, "review");
  assertEquals(second.toPhase, "complete");
  assertEquals(second.outcome, "approved");
});

// ---------------------------------------------------------------------------
// 5/8 D-channel: IssueClosed (DirectClose, channel="D")
// ---------------------------------------------------------------------------

Deno.test('emission: IssueClosed (channel "D") fires on direct closeBinding', async () => {
  const bus = createCloseEventBus();
  const collector = createEventCollector(bus);

  const config = createCloseOnCompleteConfig();
  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  // PR4-2b: DirectCloseChannel publishes IssueClosed on its own
  // execute success path. Wire the channel against the test bus so
  // the collector observes the publish.
  const { directClose } = buildTestDirectClose({
    bus,
    github,
    runId: "test-run-d-close",
  });
  bus.freeze();
  const orchestrator = new Orchestrator(
    config,
    github,
    dispatcher,
    undefined,
    undefined,
    undefined,
    bus,
    "test-run-d-close",
    directClose,
  );

  await orchestrator.run(1);

  const closed = collector.byKind("issueClosed");
  // DirectCloseChannel.execute publishes IssueClosed(channel="D") on
  // close success. Filter so future C/E emissions in the same run
  // don't pollute this assertion.
  const dClosed = closed.filter((e) => e.channel === "D");
  assertEquals(
    dClosed.length,
    1,
    `Expected exactly one D-channel IssueClosed; got ${dClosed.length}. ` +
      `Fix: DirectCloseChannel.execute must publish IssueClosed after ` +
      `closeTransport.close resolves.`,
  );
  assertEquals(dClosed[0].subjectId, 1);
  assertEquals(dClosed[0].runId, "test-run-d-close");
  // D channel has no outboxPhase discriminator (only "C" carries it).
  assertEquals(dClosed[0].outboxPhase, undefined);
});

// ---------------------------------------------------------------------------
// 6/8 D-channel: IssueCloseFailed
// ---------------------------------------------------------------------------

Deno.test('emission: IssueCloseFailed (channel "D") fires when closeIssue throws', async () => {
  const bus = createCloseEventBus();
  const collector = createEventCollector(bus);

  const config = createCloseOnCompleteConfig();
  const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
  github.setCloseIssueShouldThrow(true);
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const { directClose } = buildTestDirectClose({
    bus,
    github,
    runId: "test-run-d-fail",
  });
  bus.freeze();
  const orchestrator = new Orchestrator(
    config,
    github,
    dispatcher,
    undefined,
    undefined,
    undefined,
    bus,
    "test-run-d-fail",
    directClose,
  );

  await orchestrator.run(1);

  const failed = collector.byKind("issueCloseFailed");
  const dFailed = failed.filter((e) => e.channel === "D");
  assertEquals(
    dFailed.length,
    1,
    `Expected exactly one D-channel IssueCloseFailed when closeIssue throws; got ${dFailed.length}. ` +
      `Fix: DirectCloseChannel.execute must publish IssueCloseFailed when ` +
      `the close transport throws.`,
  );
  assertEquals(dFailed[0].subjectId, 1);
  assertEquals(typeof dFailed[0].reason, "string");
  assert(
    dFailed[0].reason.length > 0,
    "issueCloseFailed.reason must carry a non-empty diagnostic string",
  );
});

// ---------------------------------------------------------------------------
// 8/8 + 5/8 C-channel: OutboxActionDecided + IssueClosed (channel="C")
// ---------------------------------------------------------------------------

Deno.test('emission: OutboxActionDecided + IssueClosed (channel "C") fire on close-issue action', async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const bus = createCloseEventBus();
    const collector = createEventCollector(bus);

    const store = new SubjectStore(tmp);
    const subjectId = 7;
    const outboxDir = store.getOutboxPath(subjectId);
    await Deno.mkdir(outboxDir, { recursive: true });
    await Deno.writeTextFile(
      `${outboxDir}/001-close.json`,
      JSON.stringify({ action: "close-issue" }),
    );

    const github = new StubGitHubClient([]);
    // PR4-3 (T4.4b): wire OutboxClose-pre into the processor. The
    // channel publishes IssueClosed(channel: "C", outboxPhase: "pre")
    // on success — exactly the event the test asserts.
    const closeTransport = createRealCloseTransport(github);
    const outboxClosePre = new OutboxClosePreChannel({
      closeTransport,
      bus,
      runId: "test-run-c",
    });
    outboxClosePre.register(bus);
    const processor = new OutboxProcessor(
      github,
      store,
      bus,
      "test-run-c",
      outboxClosePre,
    );

    const results = await processor.process(subjectId);
    assertEquals(results.length, 1);
    assertEquals(results[0].success, true);

    const decided = collector.byKind("outboxActionDecided");
    assertEquals(
      decided.length,
      1,
      `Expected one OutboxActionDecided per recognised action; got ${decided.length}. ` +
        `Where: outbox-processor.ts validate→execute boundary.`,
    );
    assertEquals(decided[0].action.action, "close-issue");
    assertEquals(decided[0].outboxPhase, "pre");

    const closed = collector.byKind("issueClosed").filter((e) =>
      e.channel === "C"
    );
    assertEquals(
      closed.length,
      1,
      `Expected one C-channel IssueClosed for close-issue execute; got ${closed.length}. ` +
        `Where: outbox-processor.ts after close-issue execute.`,
    );
    assertEquals(closed[0].outboxPhase, "pre");
    assertEquals(closed[0].subjectId, subjectId);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test('emission: OutboxActionDecided.outboxPhase is "post" when processing post-close', async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const bus = createCloseEventBus();
    const collector = createEventCollector(bus);

    const store = new SubjectStore(tmp);
    const subjectId = 8;
    const outboxDir = store.getOutboxPath(subjectId);
    await Deno.mkdir(outboxDir, { recursive: true });
    await Deno.writeTextFile(
      `${outboxDir}/001-comment.json`,
      JSON.stringify({
        action: "comment",
        body: "post-close comment",
        trigger: "post-close",
      }),
    );

    const github = new StubGitHubClient([]);
    const processor = new OutboxProcessor(github, store, bus, "test-run-cpost");
    await processor.processPostClose(subjectId);

    const decided = collector.byKind("outboxActionDecided");
    assertEquals(decided.length, 1);
    assertEquals(
      decided[0].outboxPhase,
      "post",
      "processPostClose() must publish with outboxPhase=post (event-flow §A 8/8).",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// 3/8: ClosureBoundaryReached
// ---------------------------------------------------------------------------

function createClosureRegistry(): ExtendedStepsRegistry {
  return {
    agentId: "test-agent",
    version: "1.0.0",
    c1: "steps",
    steps: {
      "closure.test": makeStep({
        kind: "closure" as const,
        address: { c1: "steps", c2: "closure", c3: "test", edition: "default" },
        stepId: "closure.test",
        name: "Closure Test",
        uvVariables: [],
        usesStdin: false,
        structuredGate: {
          allowedIntents: ["closing"],
          intentField: "next_action.action",
          intentSchemaRef: "#/test",
        },
      }),
    },
  };
}

function createMockLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    log: () => Promise.resolve(),
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
    addContext: () => {},
    getLogPath: () => "/tmp/claude/mock.log",
    logSdkMessage: () => {},
    setToolContext: () => {},
    clearToolContext: () => {},
  };
}

Deno.test("emission: ClosureBoundaryReached fires for closure step via boundary hook", async () => {
  const bus = createCloseEventBus();
  const collector = createEventCollector(bus);

  const registry = createClosureRegistry();
  const emitter = new AgentEventEmitter();
  const hooks = new BoundaryHooks({
    getStepsRegistry: () => registry,
    getEventEmitter: () => emitter,
    getBus: () => bus,
    getRunId: () => "test-run-closure",
    getSubjectId: () => 99,
    getAgentId: () => "test-agent",
  });

  const summary: IterationSummary = {
    iteration: 1,
    assistantResponses: [],
    toolsUsed: [],
    errors: [],
    structuredOutput: { next_action: { action: "closing" } },
  };
  const ctx: RuntimeContext = {
    verdictHandler: {} as unknown as RuntimeContext["verdictHandler"],
    promptResolver: {} as RuntimeContext["promptResolver"],
    logger: createMockLogger() as unknown as RuntimeContext["logger"],
    cwd: "/tmp/claude/test",
  };

  await hooks.invokeBoundaryHook("closure.test", summary, ctx);

  const reached = collector.byKind("closureBoundaryReached");
  assertEquals(
    reached.length,
    1,
    `Expected exactly one ClosureBoundaryReached; got ${reached.length}. ` +
      `Where: boundary-hooks.ts after eventEmitter.emit.`,
  );
  assertEquals(reached[0].stepId, "closure.test");
  assertEquals(reached[0].agentId, "test-agent");
  assertEquals(reached[0].subjectId, 99);
  assertEquals(reached[0].runId, "test-run-closure");
});

// ---------------------------------------------------------------------------
// 7/8: SiblingsAllClosed (sentinel-cascade)
// ---------------------------------------------------------------------------

Deno.test("emission: SiblingsAllClosed fires when sentinel cascade triggers", async () => {
  const bus = createCloseEventBus();
  const collector = createEventCollector(bus);

  const config = createCloseOnCompleteConfig();
  // T6.eval needs a distinct evalPhase so resolvePhaseLabel doesn't
  // collide with the closing cycle's actionable phase. Mirrors the
  // orchestrator_test sentinel scenario.
  config.phases = {
    ...config.phases,
    "eval-pending": { type: "actionable", priority: 3, agent: "reviewer" },
  };
  config.labelMapping = {
    ready: "implementation",
    review: "review",
    done: "complete",
    blocked: "blocked",
    "kind:eval": "eval-pending",
  };
  config.projectBinding = {
    inheritProjectsForCreateIssue: false,
    donePhase: "complete",
    evalPhase: "eval-pending",
    planPhase: "implementation",
    sentinelLabel: "project-sentinel",
  };

  const github = new StubGitHubClient([
    ["ready"],
    ["review"],
    ["done"],
  ]);

  // After the saga close, T6.eval inspects every project item's labels.
  // Issue #1 is the just-closed subject (done); #100 is the sentinel.
  // Override getIssueLabels so the cycle reads its sequence, then
  // post-close per-item reads return the per-issue map.
  let cycleCallsConsumed = 0;
  const sequenceReads = 3;
  const itemLabelsByIssue: Record<number, string[]> = {
    1: ["done"],
    100: ["project-sentinel", "done"],
  };
  github.getIssueLabels = (subjectId: number) => {
    if (cycleCallsConsumed < sequenceReads) {
      cycleCallsConsumed++;
      const cycleLabels = [["ready"], ["review"], ["done"]][
        cycleCallsConsumed - 1
      ];
      return Promise.resolve([...cycleLabels]);
    }
    const itemLabels = itemLabelsByIssue[subjectId];
    if (itemLabels === undefined) {
      throw new Error(`Test stub: no labels for issue #${subjectId}`);
    }
    return Promise.resolve([...itemLabels]);
  };
  github.setProjects([{ owner: "org-a", number: 10 }]);
  github.setProjectItems([
    { id: "PVT_item_1", issueNumber: 1 },
    { id: "PVT_item_100", issueNumber: 100 },
  ]);

  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  // PR4-3 (T4.4b): cascade detection + SiblingsAllClosed publish moved
  // from orchestrator T6.eval into CascadeCloseChannel. The channel
  // subscribes to `IssueClosedEvent` and queries
  // getIssueProjects/listProjectItems/getIssueLabels — exactly the
  // sequence the orchestrator did. Wire the channel against the same
  // config the orchestrator runs against so projectBinding lookup
  // matches.
  const { directClose } = buildTestDirectClose({
    bus,
    github,
    runId: "test-run-cascade",
    workflow: config,
  });
  bus.freeze();
  const orchestrator = new Orchestrator(
    config,
    github,
    dispatcher,
    undefined,
    undefined,
    undefined,
    bus,
    "test-run-cascade",
    directClose,
  );

  await orchestrator.run(1);

  const cascade = collector.byKind("siblingsAllClosed");
  assertEquals(
    cascade.length,
    1,
    `Expected one SiblingsAllClosed when sentinel cascade triggers; got ${cascade.length}. ` +
      `Where: orchestrator.ts T6.eval before sentinel relabel.`,
  );
  assertEquals(cascade[0].parentSubjectId, 100);
  assertEquals(
    cascade[0].closedChildren,
    [1],
    "closedChildren must list non-sentinel project items.",
  );
});

// ---------------------------------------------------------------------------
// 5/8 E-channel: IssueClosed (BoundaryClose, channel="E")
// ---------------------------------------------------------------------------

Deno.test('emission: IssueClosed (channel "E") fires from external-state-adapter close', async () => {
  const bus = createCloseEventBus();
  const collector = createEventCollector(bus);

  // PR4-3 (T4.4c): the adapter no longer shells out to `gh issue
  // close` — it delegates to BoundaryClose.handleBoundary which goes
  // through the boot-frozen CloseTransport. Use a mock transport that
  // simply records the call so the success path publishes IssueClosed.
  const closed: import("../orchestrator/workflow-types.ts").SubjectRef[] = [];
  const closeTransport:
    import("../transports/close-transport.ts").CloseTransport = {
      kind: "mock" as const,
      close(subjectId) {
        closed.push(subjectId);
        return Promise.resolve();
      },
    };
  const boundaryClose = new BoundaryCloseChannel({
    closeTransport,
    bus,
    runId: "test-run-e",
  });
  boundaryClose.register(bus);

  const checker = new MockStateChecker();
  checker.setIssueState(42, false);
  const handler = new IssueVerdictHandler(
    { issueNumber: 42, repo: "owner/repo" },
    checker,
  );
  const config: ExternalStateAdapterConfig = {
    issueNumber: 42,
    repo: "owner/repo",
    github: { defaultClosureAction: "close" },
  };
  const adapter = new ExternalStateVerdictAdapter(handler, config);
  adapter.setBoundaryClose(boundaryClose);

  await adapter.onBoundaryHook({
    stepId: "closure.issue",
    kind: "closure",
    structuredOutput: { closure_action: "close" },
  });

  const closedE = collector.byKind("issueClosed").filter((e) =>
    e.channel === "E"
  );
  assertEquals(
    closedE.length,
    1,
    `Expected one E-channel IssueClosed from adapter close; got ${closedE.length}. ` +
      `Where: BoundaryCloseChannel.execute success.`,
  );
  assertEquals(closedE[0].subjectId, 42);
  assertEquals(closedE[0].runId, "test-run-e");
  assertEquals(closed, [42]);
});

Deno.test('emission: IssueCloseFailed (channel "E") fires when adapter close throws', async () => {
  const bus = createCloseEventBus();
  const collector = createEventCollector(bus);

  // PR4-3 (T4.4c): failure path now exercised through a throwing
  // CloseTransport. The channel catches, publishes
  // IssueCloseFailed(channel: "E"), and rethrows; the adapter
  // swallows the rethrow (close failure is non-fatal for the closure
  // step).
  const closeTransport:
    import("../transports/close-transport.ts").CloseTransport = {
      kind: "mock" as const,
      close(_subjectId) {
        return Promise.reject(new Error("gh issue close failed (test)"));
      },
    };
  const boundaryClose = new BoundaryCloseChannel({
    closeTransport,
    bus,
    runId: "test-run-e-fail",
  });
  boundaryClose.register(bus);

  const checker = new MockStateChecker();
  checker.setIssueState(43, false);
  const handler = new IssueVerdictHandler(
    { issueNumber: 43, repo: "owner/repo" },
    checker,
  );
  const config: ExternalStateAdapterConfig = {
    issueNumber: 43,
    repo: "owner/repo",
    github: { defaultClosureAction: "close" },
  };
  const adapter = new ExternalStateVerdictAdapter(handler, config);
  adapter.setBoundaryClose(boundaryClose);

  await adapter.onBoundaryHook({
    stepId: "closure.issue",
    kind: "closure",
    structuredOutput: { closure_action: "close" },
  });

  const failedE = collector.byKind("issueCloseFailed").filter((e) =>
    e.channel === "E"
  );
  assertEquals(
    failedE.length,
    1,
    `Expected one E-channel IssueCloseFailed when transport throws; got ${failedE.length}. ` +
      `Where: BoundaryCloseChannel.execute catch.`,
  );
  assertEquals(failedE[0].subjectId, 43);
  assert(
    failedE[0].reason.length > 0,
    "issueCloseFailed.reason must carry a diagnostic message",
  );
});

// ---------------------------------------------------------------------------
// Diagnostic snapshot — JSONL well-formedness
// ---------------------------------------------------------------------------

Deno.test("emission: diagnostic JSONL is well-formed (one parseable line per event)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const bus = createCloseEventBus();
    const runId = "diag-run-1";
    registerDiagnosticSubscriber(bus, {
      runId,
      logDir: tmp,
      enabled: true,
    });

    const config = createCloseOnCompleteConfig();
    const github = new StubGitHubClient([["ready"], ["review"], ["done"]]);
    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });
    const orchestrator = new Orchestrator(
      config,
      github,
      dispatcher,
      undefined,
      undefined,
      undefined,
      bus,
      runId,
    );
    await orchestrator.run(1);

    // Disk write is fire-and-forget inside the subscriber. Yield enough
    // microtasks for the writes triggered during run() to flush before
    // we read.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const logPath = `${tmp}/events-${runId}.jsonl`;
    const text = await Deno.readTextFile(logPath);
    const lines = text.split("\n").filter((l) => l.length > 0);
    assert(
      lines.length > 0,
      `Diagnostic JSONL must have at least one line for a real run; got ${lines.length}.`,
    );
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        throw new Error(
          `Malformed JSONL line: ${JSON.stringify(line)} (${
            e instanceof Error ? e.message : String(e)
          })`,
        );
      }
      assertEquals(
        typeof (parsed as Event).kind,
        "string",
        `Each line must encode an Event with a string 'kind' discriminator; got ${
          JSON.stringify(parsed)
        }`,
      );
      assertEquals(
        typeof (parsed as Event).runId,
        "string",
        "Each line must carry runId for boot correlation",
      );
    }
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
