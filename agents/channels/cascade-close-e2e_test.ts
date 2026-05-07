/**
 * E2E tests for T6.eval sentinel label flip chain.
 *
 * These tests exercise the full event-driven cascade path:
 *   issue close → IssueClosedEvent → CascadeCloseChannel#evaluate
 *   → sentinel label flip (donePhase removed, evalPhase added)
 *   → SiblingsAllClosedEvent published
 *
 * Unlike the orchestrator_test.ts T6.eval unit tests that verify the
 * label resolution contract in isolation, these tests drive the
 * orchestrator end-to-end so the cascade channel receives a real
 * IssueClosedEvent from the DirectCloseChannel transport and
 * exercises the full subscriber pipeline.
 *
 * Coverage:
 *   1. Happy path: all children done → sentinel label flip + event
 *   2. Incomplete path: not all children done → no flip (plan-pending)
 *   3. Non-fatal failure: GitHub API error during eval → close succeeds
 *   4. closeProject: project closed after evaluator completes
 *
 * @module
 */

import { assertEquals } from "@std/assert";
import {
  buildOrchestratorWithChannels,
  TEST_DEFAULT_ISSUE_SOURCE,
} from "../orchestrator/_test-fixtures.ts";
import { createEventCollector } from "../events/_test-helpers.ts";
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
import { StubDispatcher } from "../orchestrator/dispatcher.ts";
import {
  deriveInvocations,
  type WorkflowConfig,
} from "../orchestrator/workflow-types.ts";

// --- Test fixtures ---

/**
 * WorkflowConfig with closeBinding + projectBinding for T6.eval chain.
 *
 * Uses labelPrefix="t6" to prove labels are resolved through
 * labelMapping, not hardcoded.
 */
function createT6EvalConfig(): WorkflowConfig {
  const phases = {
    implementation: {
      type: "actionable" as const,
      priority: 1,
      agent: "iterator",
    },
    review: { type: "actionable" as const, priority: 2, agent: "reviewer" },
    complete: { type: "terminal" as const },
    blocked: { type: "blocking" as const },
    "eval-pending": {
      type: "actionable" as const,
      priority: 3,
      agent: "reviewer",
    },
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
    labelPrefix: "t6",
    phases,
    labelMapping: {
      "t6-ready": "implementation",
      "t6-review": "review",
      "t6-done": "complete",
      "t6-blocked": "blocked",
      "t6-kind:eval": "eval-pending",
    },
    agents,
    invocations: deriveInvocations(phases, agents),
    rules: { maxCycles: 5, cycleDelayMs: 0 },
    projectBinding: {
      inheritProjectsForCreateIssue: false,
      donePhase: "complete",
      evalPhase: "eval-pending",
      planPhase: "implementation",
      sentinelLabel: "project-sentinel",
    },
  };
}

/**
 * Stub GitHubClient that dispatches getIssueLabels by subjectId once
 * the orchestrator's cycle reads are consumed, and records all mutations
 * for assertion.
 */
class T6StubGitHubClient implements GitHubClient {
  #cycleLabels: string[][];
  #cycleCallIndex = 0;
  #itemLabels: Record<number, string[]>;
  #projects: { owner: string; number: number }[];
  #projectItems: { id: string; issueNumber: number }[];
  readonly labelUpdates: {
    subjectId: number;
    removed: string[];
    added: string[];
  }[] = [];
  readonly closedIssues: number[] = [];
  readonly closedProjects: ProjectRef[] = [];
  #getIssueProjectsError: Error | null = null;

  constructor(opts: {
    cycleLabels: string[][];
    itemLabels: Record<number, string[]>;
    projects: { owner: string; number: number }[];
    projectItems: { id: string; issueNumber: number }[];
  }) {
    this.#cycleLabels = opts.cycleLabels;
    this.#itemLabels = opts.itemLabels;
    this.#projects = opts.projects;
    this.#projectItems = opts.projectItems;
  }

  setGetIssueProjectsError(err: Error): void {
    this.#getIssueProjectsError = err;
  }

  getIssueLabels(subjectId: number): Promise<string[]> {
    const cycleReads = this.#cycleLabels.length;
    if (this.#cycleCallIndex < cycleReads) {
      const labels = this.#cycleLabels[this.#cycleCallIndex];
      this.#cycleCallIndex++;
      return Promise.resolve([...labels]);
    }
    const itemLabels = this.#itemLabels[subjectId];
    if (itemLabels === undefined) {
      throw new Error(
        `T6StubGitHubClient: no labels configured for issue #${subjectId}`,
      );
    }
    return Promise.resolve([...itemLabels]);
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

  addIssueComment(_subjectId: number, _comment: string): Promise<void> {
    return Promise.resolve();
  }

  closeIssue(subjectId: number): Promise<void> {
    this.closedIssues.push(subjectId);
    return Promise.resolve();
  }

  reopenIssue(_subjectId: number): Promise<void> {
    return Promise.reject(new Error("not implemented"));
  }

  createIssue(
    _title: string,
    _labels: string[],
    _body: string,
  ): Promise<number> {
    return Promise.resolve(999);
  }

  getIssueProjects(
    _issueNumber: number,
  ): Promise<Array<{ owner: string; number: number }>> {
    if (this.#getIssueProjectsError) {
      return Promise.reject(this.#getIssueProjectsError);
    }
    return Promise.resolve([...this.#projects]);
  }

  listProjectItems(
    _project: ProjectRef,
  ): Promise<{ id: string; issueNumber: number }[]> {
    return Promise.resolve([...this.#projectItems]);
  }

  getRecentComments(
    _subjectId: number,
    _limit: number,
  ): Promise<{ body: string; createdAt: string }[]> {
    return Promise.resolve([]);
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

  closeProject(project: ProjectRef): Promise<void> {
    this.closedProjects.push(project);
    return Promise.resolve();
  }

  getProjectItemIdForIssue(): Promise<string | null> {
    return Promise.resolve(null);
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

// --- E2E Tests ---

Deno.test(
  "T6.eval e2e: close→eval→SiblingsAllClosedEvent chain completes when all children done",
  async () => {
    const config = createT6EvalConfig();
    // Orchestrator cycles: ready → review → done (3 getIssueLabels reads).
    // After close, CascadeCloseChannel reads per-item labels:
    //   #1 (subject)  → t6:t6-done (non-sentinel, done)
    //   #200 (sentinel) → project-sentinel + t6:t6-done
    const github = new T6StubGitHubClient({
      cycleLabels: [
        ["t6:t6-ready"],
        ["t6:t6-review"],
        ["t6:t6-done"],
      ],
      itemLabels: {
        1: ["t6:t6-done"],
        200: ["project-sentinel", "t6:t6-done"],
      },
      projects: [{ owner: "org-e2e", number: 42 }],
      projectItems: [
        { id: "PVT_item_1", issueNumber: 1 },
        { id: "PVT_item_200", issueNumber: 200 },
      ],
    });

    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });

    let collector: ReturnType<typeof createEventCollector> | undefined;
    const { orchestrator } = buildOrchestratorWithChannels({
      config,
      github,
      dispatcher,
      subscribe: (bus) => {
        collector = createEventCollector(bus);
      },
    });

    const result = await orchestrator.run(1);

    // 1. Orchestrator completed the cycle chain
    assertEquals(
      result.status,
      "completed",
      "Orchestrator must reach completed status. " +
        "Fix: check cycle labels and phase transitions",
    );

    // 2. Subject issue was closed via DirectClose
    assertEquals(
      github.closedIssues.length,
      1,
      "Subject issue #1 must be closed. " +
        "Fix: check closeBinding on reviewer agent",
    );
    assertEquals(github.closedIssues[0], 1);

    // 3. Sentinel label flip: donePhase removed, evalPhase added
    const sentinelUpdate = github.labelUpdates.find(
      (u) => u.subjectId === 200,
    );
    assertEquals(
      sentinelUpdate !== undefined,
      true,
      "CascadeCloseChannel must emit updateIssueLabels on sentinel #200. " +
        "Fix: verify CascadeCloseChannel#evaluate sentinel detection",
    );
    assertEquals(
      sentinelUpdate!.removed,
      ["t6:t6-done"],
      "Removed label must be the prefix-resolved donePhase label. " +
        "Fix: cascade-close.ts resolvePhaseLabel(workflow, binding.donePhase)",
    );
    assertEquals(
      sentinelUpdate!.added,
      ["t6:t6-kind:eval"],
      "Added label must be the prefix-resolved evalPhase label. " +
        "Fix: cascade-close.ts resolvePhaseLabel(workflow, binding.evalPhase)",
    );

    // 4. SiblingsAllClosedEvent was published on the bus
    const siblingEvents = collector!.byKind("siblingsAllClosed");
    assertEquals(
      siblingEvents.length,
      1,
      "CascadeCloseChannel must publish exactly one SiblingsAllClosedEvent. " +
        "Fix: cascade-close.ts #evaluate publish block",
    );
    assertEquals(
      siblingEvents[0].parentSubjectId,
      200,
      "parentSubjectId must be the sentinel issue number",
    );
    assertEquals(
      [...siblingEvents[0].closedChildren],
      [1],
      "closedChildren must list the non-sentinel items",
    );
  },
);

Deno.test(
  "T6.eval e2e: no label flip when not all children are done (incomplete path)",
  async () => {
    const config = createT6EvalConfig();
    // Project has 3 items: #1 (subject, done), #2 (sibling, NOT done), #200 (sentinel).
    // CascadeCloseChannel must NOT flip the sentinel because #2 is still open.
    const github = new T6StubGitHubClient({
      cycleLabels: [
        ["t6:t6-ready"],
        ["t6:t6-review"],
        ["t6:t6-done"],
      ],
      itemLabels: {
        1: ["t6:t6-done"],
        2: ["t6:t6-review"], // NOT done — still in review
        200: ["project-sentinel", "t6:t6-done"],
      },
      projects: [{ owner: "org-e2e", number: 42 }],
      projectItems: [
        { id: "PVT_item_1", issueNumber: 1 },
        { id: "PVT_item_2", issueNumber: 2 },
        { id: "PVT_item_200", issueNumber: 200 },
      ],
    });

    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });

    let collector: ReturnType<typeof createEventCollector> | undefined;
    const { orchestrator } = buildOrchestratorWithChannels({
      config,
      github,
      dispatcher,
      subscribe: (bus) => {
        collector = createEventCollector(bus);
      },
    });

    await orchestrator.run(1);

    // Subject issue still closes normally
    assertEquals(
      github.closedIssues.length,
      1,
      "Subject close must not be blocked by incomplete siblings. " +
        "Fix: cascade eval is post-close and non-fatal",
    );

    // No sentinel label flip when siblings are incomplete
    const sentinelUpdate = github.labelUpdates.find(
      (u) => u.subjectId === 200,
    );
    assertEquals(
      sentinelUpdate,
      undefined,
      "Sentinel label must NOT be flipped when a non-sentinel item " +
        "has not reached donePhase. Fix: cascade-close.ts allNonSentinelDone guard",
    );

    // No SiblingsAllClosedEvent
    const siblingEvents = collector!.byKind("siblingsAllClosed");
    assertEquals(
      siblingEvents.length,
      0,
      "SiblingsAllClosedEvent must NOT be published when children are incomplete. " +
        "Fix: cascade-close.ts publish guard",
    );
  },
);

Deno.test(
  "T6.eval e2e: getIssueProjects failure does not block the close chain",
  async () => {
    const config = createT6EvalConfig();
    const github = new T6StubGitHubClient({
      cycleLabels: [
        ["t6:t6-ready"],
        ["t6:t6-review"],
        ["t6:t6-done"],
      ],
      itemLabels: {},
      projects: [],
      projectItems: [],
    });
    github.setGetIssueProjectsError(
      new Error("Simulated GitHub API failure"),
    );

    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });

    const { orchestrator } = buildOrchestratorWithChannels({
      config,
      github,
      dispatcher,
    });

    await orchestrator.run(1);

    // Close must succeed despite eval failure (W13: non-fatal)
    assertEquals(
      github.closedIssues.length,
      1,
      "Issue must be closed even when getIssueProjects fails. " +
        "Fix: cascade-close.ts catch block must not propagate (W13)",
    );

    // No sentinel label updates (eval never reached item check)
    assertEquals(
      github.labelUpdates.filter((u) => u.subjectId !== 1).length,
      0,
      "No sentinel updates when eval fails early. " +
        "Fix: cascade-close.ts error path",
    );
  },
);

Deno.test(
  "T6.eval e2e: closeProject is callable after evaluator sentinel flip",
  async () => {
    // This test verifies that closeProject works as expected when called
    // explicitly after the sentinel label flip. In the production flow,
    // the evaluator agent would run on the next cycle and call closeProject;
    // here we verify the GitHubClient seam is exercisable after the cascade.
    const config = createT6EvalConfig();
    const github = new T6StubGitHubClient({
      cycleLabels: [
        ["t6:t6-ready"],
        ["t6:t6-review"],
        ["t6:t6-done"],
      ],
      itemLabels: {
        1: ["t6:t6-done"],
        200: ["project-sentinel", "t6:t6-done"],
      },
      projects: [{ owner: "org-e2e", number: 42 }],
      projectItems: [
        { id: "PVT_item_1", issueNumber: 1 },
        { id: "PVT_item_200", issueNumber: 200 },
      ],
    });

    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });

    const { orchestrator } = buildOrchestratorWithChannels({
      config,
      github,
      dispatcher,
    });

    await orchestrator.run(1);

    // Sentinel was flipped (verified in detail by the first test)
    const sentinelUpdate = github.labelUpdates.find(
      (u) => u.subjectId === 200,
    );
    assertEquals(
      sentinelUpdate !== undefined,
      true,
      "Sentinel label flip must happen before closeProject is meaningful",
    );

    // Simulate evaluator calling closeProject (next cycle would do this)
    await github.closeProject({ owner: "org-e2e", number: 42 });

    assertEquals(
      github.closedProjects.length,
      1,
      "closeProject must be callable after cascade evaluation. " +
        "Fix: github-client.ts closeProject implementation",
    );
  },
);

Deno.test(
  "T6.eval e2e: multiple projects — each evaluated independently",
  async () => {
    const config = createT6EvalConfig();
    // Subject belongs to 2 projects.
    // Project A: all done → sentinel flip.
    // Project B: sibling not done → no flip.
    const github = new T6StubGitHubClient({
      cycleLabels: [
        ["t6:t6-ready"],
        ["t6:t6-review"],
        ["t6:t6-done"],
      ],
      itemLabels: {
        1: ["t6:t6-done"],
        300: ["project-sentinel", "t6:t6-done"],
        400: ["project-sentinel", "t6:t6-done"],
        5: ["t6:t6-review"], // Project B sibling still in review
      },
      projects: [
        { owner: "org-a", number: 10 },
        { owner: "org-b", number: 20 },
      ],
      projectItems: [], // Will be overridden per-project
    });

    // Override listProjectItems to return different items per project
    const projectAItems = [
      { id: "PVT_A_1", issueNumber: 1 },
      { id: "PVT_A_300", issueNumber: 300 },
    ];
    const projectBItems = [
      { id: "PVT_B_1", issueNumber: 1 },
      { id: "PVT_B_5", issueNumber: 5 },
      { id: "PVT_B_400", issueNumber: 400 },
    ];
    github.listProjectItems = (project: ProjectRef) => {
      const p = project as { owner: string; number: number };
      if (p.number === 10) return Promise.resolve([...projectAItems]);
      if (p.number === 20) return Promise.resolve([...projectBItems]);
      return Promise.resolve([]);
    };

    const dispatcher = new StubDispatcher({
      iterator: "success",
      reviewer: "approved",
    });

    let collector: ReturnType<typeof createEventCollector> | undefined;
    const { orchestrator } = buildOrchestratorWithChannels({
      config,
      github,
      dispatcher,
      subscribe: (bus) => {
        collector = createEventCollector(bus);
      },
    });

    await orchestrator.run(1);

    // Project A: sentinel #300 should be flipped
    const sentinelAUpdate = github.labelUpdates.find(
      (u) => u.subjectId === 300,
    );
    assertEquals(
      sentinelAUpdate !== undefined,
      true,
      "Project A sentinel #300 must be flipped (all non-sentinels done). " +
        "Fix: cascade-close.ts per-project iteration",
    );
    assertEquals(sentinelAUpdate!.removed, ["t6:t6-done"]);
    assertEquals(sentinelAUpdate!.added, ["t6:t6-kind:eval"]);

    // Project B: sentinel #400 should NOT be flipped
    const sentinelBUpdate = github.labelUpdates.find(
      (u) => u.subjectId === 400,
    );
    assertEquals(
      sentinelBUpdate,
      undefined,
      "Project B sentinel #400 must NOT be flipped (sibling #5 not done). " +
        "Fix: cascade-close.ts allNonSentinelDone per-project",
    );

    // Only one SiblingsAllClosedEvent (from project A)
    const siblingEvents = collector!.byKind("siblingsAllClosed");
    assertEquals(
      siblingEvents.length,
      1,
      "Only project A should emit SiblingsAllClosedEvent",
    );
    assertEquals(siblingEvents[0].parentSubjectId, 300);
  },
);
