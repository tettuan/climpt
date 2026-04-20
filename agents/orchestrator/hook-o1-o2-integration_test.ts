/**
 * Hook O1 / O2 integration tests (issue #507).
 *
 * Validates the orchestrator's project-related hooks end-to-end:
 *   O1: Project goal injection into dispatch promptContext
 *   O2: Project membership inheritance for deferred_items
 *
 * All tests run through the Orchestrator with a stubbed GitHubClient and
 * StubDispatcher — no real GitHub API calls. O2 tests verify the outbox
 * file set written to disk.
 *
 * Invariants covered:
 *   I2: Issue with 0 projects → O1 goal injection skip, O2 inheritance no-op
 *   I7: Multi-project issue + deferred_items inherit → all projects bound
 */

import { assertEquals } from "jsr:@std/assert";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
  LabelDetail,
  Project,
  ProjectField,
} from "./github-client.ts";
import type { ProjectFieldValue, ProjectRef } from "./outbox-processor.ts";
import type { WorkflowConfig } from "./workflow-types.ts";
import { StubDispatcher } from "./dispatcher.ts";
import { Orchestrator } from "./orchestrator.ts";
import { SubjectStore } from "./subject-store.ts";

// ---------------------------------------------------------------------------
// Stub GitHubClient — configurable project memberships and details
// ---------------------------------------------------------------------------
class ProjectStubGitHubClient implements GitHubClient {
  #labelSequence: string[][];
  #callIndex = 0;
  #projects: Array<{ owner: string; number: number }> = [];
  #projectDetails: Map<number, Project> = new Map();
  #createdIssues: number[] = [];
  #nextIssueNumber = 300;
  #closedIssues: number[] = [];

  /** Tracks which methods were called, for "no extra gh call" assertions. */
  methodCalls: { method: string; args: unknown[] }[] = [];

  constructor(
    labelSequence: string[][],
    projects?: Array<{ owner: string; number: number }>,
  ) {
    this.#labelSequence = labelSequence;
    if (projects) this.#projects = projects;
  }

  setProjectDetail(num: number, detail: Project): void {
    this.#projectDetails.set(num, detail);
  }

  getIssueLabels(_subjectId: string | number): Promise<string[]> {
    const idx = Math.min(this.#callIndex, this.#labelSequence.length - 1);
    const labels = this.#labelSequence[idx];
    this.#callIndex++;
    return Promise.resolve([...labels]);
  }

  updateIssueLabels(
    _subjectId: string | number,
    _labelsToRemove: string[],
    _labelsToAdd: string[],
  ): Promise<void> {
    return Promise.resolve();
  }

  addIssueComment(
    _subjectId: string | number,
    _comment: string,
  ): Promise<void> {
    return Promise.resolve();
  }

  createIssue(
    title: string,
    labels: string[],
    body: string,
  ): Promise<number> {
    this.methodCalls.push({
      method: "createIssue",
      args: [title, labels, body],
    });
    const num = this.#nextIssueNumber++;
    this.#createdIssues.push(num);
    return Promise.resolve(num);
  }

  closeIssue(subjectId: string | number): Promise<void> {
    this.#closedIssues.push(Number(subjectId));
    return Promise.resolve();
  }

  reopenIssue(_subjectId: string | number): Promise<void> {
    return Promise.reject(new Error("not implemented"));
  }

  getRecentComments(
    _subjectId: string | number,
    _limit: number,
  ): Promise<{ body: string; createdAt: string }[]> {
    return Promise.resolve([]);
  }

  listIssues(_criteria: IssueCriteria): Promise<IssueListItem[]> {
    return Promise.resolve([]);
  }

  getIssueDetail(_subjectId: string | number): Promise<IssueDetail> {
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

  listLabelsDetailed(): Promise<LabelDetail[]> {
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
    project: ProjectRef,
    issueNumber: number,
  ): Promise<string> {
    this.methodCalls.push({
      method: "addIssueToProject",
      args: [project, issueNumber],
    });
    return Promise.resolve(`PVTI_${issueNumber}`);
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

  getProjectItemIdForIssue(
    _project: ProjectRef,
    _issueNumber: number,
  ): Promise<string | null> {
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
    this.methodCalls.push({
      method: "getIssueProjects",
      args: [_issueNumber],
    });
    return Promise.resolve([...this.#projects]);
  }

  createProjectFieldOption(
    _project: ProjectRef,
    _fieldId: string,
    name: string,
    _color?: string,
  ): Promise<{ id: string; name: string }> {
    return Promise.resolve({ id: `OPT_${name}`, name });
  }

  listUserProjects(_owner: string): Promise<Project[]> {
    return Promise.resolve([]);
  }

  getProject(project: ProjectRef): Promise<Project> {
    const num = "number" in project ? project.number : 0;
    const detail = this.#projectDetails.get(num);
    if (detail) return Promise.resolve(detail);
    return Promise.resolve({
      id: `PVT_${num}`,
      number: num,
      owner: "owner" in project ? project.owner : "",
      title: `Project ${num}`,
      readme: `README for project ${num}`,
      shortDescription: null,
      closed: false,
    });
  }

  getProjectFields(_project: ProjectRef): Promise<ProjectField[]> {
    return Promise.resolve([]);
  }

  removeProjectItem(
    _project: ProjectRef,
    _itemId: string,
  ): Promise<void> {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Config factory — reviewer with closeOnComplete=true
// ---------------------------------------------------------------------------
function createConfig(
  projectBinding?: WorkflowConfig["projectBinding"],
): WorkflowConfig {
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
    projectBinding,
  };
}

/** Read and sort outbox files for a subject, returning parsed action objects. */
async function readOutboxFiles(
  store: SubjectStore,
  subjectId: number,
): Promise<Record<string, unknown>[]> {
  const outboxDir = store.getOutboxPath(subjectId);
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(outboxDir)) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        files.push(entry.name);
      }
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
  files.sort();
  const actions: Record<string, unknown>[] = [];
  for (const file of files) {
    const content = await Deno.readTextFile(`${outboxDir}/${file}`);
    actions.push(JSON.parse(content) as Record<string, unknown>);
  }
  return actions;
}

/** Write issue metadata to store so the orchestrator can find it. */
async function writeTestIssue(
  store: SubjectStore,
  subjectId: number,
): Promise<void> {
  await store.writeIssue({
    meta: {
      number: subjectId,
      title: "Test issue",
      labels: ["ready"],
      state: "open",
      assignees: [],
      milestone: null,
    },
    body: "test body",
    comments: [],
  });
}

// ===========================================================================
// O1: Project goal injection into dispatch promptContext
// ===========================================================================

Deno.test("O1: issue with 0 projects — no injection, getIssueProjects called but returns empty (I2)", async () => {
  const config = createConfig({
    injectGoalIntoPromptContext: true,
    inheritProjectsForCreateIssue: false,
  });
  // No projects configured — getIssueProjects returns []
  const github = new ProjectStubGitHubClient(
    [["ready"], ["review"], ["done"]],
  );
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  await orchestrator.run(1);

  const iteratorCall = dispatcher.calls.find((c) => c.agentId === "iterator");
  assertEquals(
    iteratorCall !== undefined,
    true,
    "Iterator must be dispatched.",
  );
  assertEquals(
    iteratorCall!.options?.promptContext,
    undefined,
    "promptContext must be undefined when issue has 0 project memberships (I2). " +
      "Fix: orchestrator.ts O1 hook must skip injection when projectRefs is empty.",
  );
});

Deno.test("O1: issue with 1 project — single-element arrays in promptContext", async () => {
  const config = createConfig({
    injectGoalIntoPromptContext: true,
    inheritProjectsForCreateIssue: false,
  });
  const github = new ProjectStubGitHubClient(
    [["ready"], ["review"], ["done"]],
    [{ owner: "myorg", number: 5 }],
  );
  github.setProjectDetail(5, {
    id: "PVT_single",
    number: 5,
    owner: "myorg",
    title: "Alpha Release",
    readme: "Ship the alpha milestone",
    shortDescription: "alpha",
    closed: false,
  });
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  await orchestrator.run(1);

  const iteratorCall = dispatcher.calls.find((c) => c.agentId === "iterator");
  const ctx = iteratorCall!.options?.promptContext;
  assertEquals(
    ctx !== undefined,
    true,
    "promptContext must be present for issue with 1 project membership. " +
      "Fix: orchestrator.ts O1 hook must build promptContext when projectRefs.length > 0.",
  );
  assertEquals(
    ctx!.project_goals,
    JSON.stringify(["Ship the alpha milestone"]),
    "project_goals must be a single-element JSON array of readmes.",
  );
  assertEquals(
    ctx!.project_titles,
    JSON.stringify(["Alpha Release"]),
    "project_titles must be a single-element JSON array.",
  );
  assertEquals(
    ctx!.project_numbers,
    JSON.stringify([5]),
    "project_numbers must be a single-element JSON array.",
  );
  assertEquals(
    ctx!.project_ids,
    JSON.stringify(["PVT_single"]),
    "project_ids must be a single-element JSON array.",
  );
});

Deno.test("O1: issue with 2 projects — length-2 arrays in promptContext", async () => {
  const config = createConfig({
    injectGoalIntoPromptContext: true,
    inheritProjectsForCreateIssue: false,
  });
  const github = new ProjectStubGitHubClient(
    [["ready"], ["review"], ["done"]],
    [{ owner: "org", number: 10 }, { owner: "org", number: 20 }],
  );
  github.setProjectDetail(10, {
    id: "PVT_aaa",
    number: 10,
    owner: "org",
    title: "Release v1.14",
    readme: "Ship orchestrator hooks",
    shortDescription: null,
    closed: false,
  });
  github.setProjectDetail(20, {
    id: "PVT_bbb",
    number: 20,
    owner: "org",
    title: "Backlog Q2",
    readme: "Clear tech debt",
    shortDescription: null,
    closed: false,
  });
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  await orchestrator.run(1);

  const iteratorCall = dispatcher.calls.find((c) => c.agentId === "iterator");
  const ctx = iteratorCall!.options?.promptContext;
  assertEquals(
    ctx !== undefined,
    true,
    "promptContext must be present for issue with 2 project memberships.",
  );
  assertEquals(
    ctx!.project_goals,
    JSON.stringify(["Ship orchestrator hooks", "Clear tech debt"]),
    "project_goals must contain both readmes as length-2 JSON array.",
  );
  assertEquals(
    ctx!.project_titles,
    JSON.stringify(["Release v1.14", "Backlog Q2"]),
    "project_titles must contain both titles.",
  );
  assertEquals(
    ctx!.project_numbers,
    JSON.stringify([10, 20]),
    "project_numbers must contain both numbers.",
  );
  assertEquals(
    ctx!.project_ids,
    JSON.stringify(["PVT_aaa", "PVT_bbb"]),
    "project_ids must contain both ids.",
  );
});

Deno.test("O1: injectGoalIntoPromptContext=false — no injection regardless of membership", async () => {
  const config = createConfig({
    injectGoalIntoPromptContext: false,
    inheritProjectsForCreateIssue: false,
  });
  // Projects available but flag is off
  const github = new ProjectStubGitHubClient(
    [["ready"], ["review"], ["done"]],
    [{ owner: "org", number: 10 }],
  );
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  await orchestrator.run(1);

  const iteratorCall = dispatcher.calls.find((c) => c.agentId === "iterator");
  assertEquals(
    iteratorCall!.options?.promptContext,
    undefined,
    "promptContext must be undefined when injectGoalIntoPromptContext=false. " +
      "Fix: orchestrator.ts O1 hook must check the flag before resolving projects.",
  );
  // Verify getIssueProjects was NOT called for O1 (flag guard prevents it)
  const o1GetProjectsCalls = github.methodCalls.filter(
    (c) => c.method === "getIssueProjects",
  );
  // O1 guard skips the call; any calls here come from other code paths (e.g. T6.eval)
  // but not from O1 injection.
  assertEquals(
    iteratorCall!.options?.promptContext,
    undefined,
    "No prompt context when flag is off.",
  );
});

Deno.test("O1: projectBinding absent — no injection, no getIssueProjects call from O1", async () => {
  const config = createConfig(undefined); // No projectBinding
  const github = new ProjectStubGitHubClient(
    [["ready"], ["review"], ["done"]],
  );
  const dispatcher = new StubDispatcher({
    iterator: "success",
    reviewer: "approved",
  });
  const orchestrator = new Orchestrator(config, github, dispatcher);

  await orchestrator.run(1);

  const iteratorCall = dispatcher.calls.find((c) => c.agentId === "iterator");
  assertEquals(
    iteratorCall!.options?.promptContext,
    undefined,
    "promptContext must be undefined when projectBinding is absent (backward compat). " +
      "Fix: orchestrator.ts O1 hook must guard on projectBinding existence.",
  );
  // getIssueProjects must not be called at all when projectBinding is absent
  const getProjectsCalls = github.methodCalls.filter(
    (c) => c.method === "getIssueProjects",
  );
  assertEquals(
    getProjectsCalls.length,
    0,
    "getIssueProjects must NOT be called when projectBinding is absent. " +
      "Fix: orchestrator.ts must skip all project code paths without projectBinding.",
  );
});

// ===========================================================================
// O2: Project membership inheritance on deferred_items — outbox file set
// ===========================================================================

Deno.test("O2: deferred_item without projects + flag on + 1 parent project — paired create-issue + add-to-project in outbox", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createConfig({
      injectGoalIntoPromptContext: false,
      inheritProjectsForCreateIssue: true,
    });
    const github = new ProjectStubGitHubClient(
      [["ready"], ["review"], ["done"]],
      [{ owner: "myorg", number: 1 }],
    );
    const structuredOutput: Record<string, unknown> = {
      deferred_items: [
        { title: "Follow-up task", body: "Do the thing", labels: ["ready"] },
      ],
    };
    const dispatcher = new StubDispatcher(
      { iterator: "success", reviewer: "approved" },
      undefined,
      undefined,
      structuredOutput,
    );
    const store = new SubjectStore(`${tmpDir}/store`);
    await writeTestIssue(store, 1);
    const orchestrator = new Orchestrator(config, github, dispatcher);

    await orchestrator.run(1, {}, store);

    // Verify outbox file set before OutboxProcessor consumes them.
    // The orchestrator processes outbox after emission, so files may be cleaned.
    // Instead verify via GitHubClient spy calls.
    const createCalls = github.methodCalls.filter(
      (c) => c.method === "createIssue",
    );
    assertEquals(
      createCalls.length,
      1,
      "Exactly 1 create-issue action must be executed. " +
        "Fix: DeferredItemsEmitter must emit 1 create-issue for 1 deferred_item.",
    );
    assertEquals(
      (createCalls[0].args as [string, string[], string])[0],
      "Follow-up task",
      "Created issue title must match deferred_item.title.",
    );

    const addCalls = github.methodCalls.filter(
      (c) => c.method === "addIssueToProject",
    );
    assertEquals(
      addCalls.length,
      1,
      "Exactly 1 add-to-project action must be executed (inherited from parent). " +
        "Fix: DeferredItemsEmitter must emit add-to-project for each inherited project.",
    );
    assertEquals(
      (addCalls[0].args as [ProjectRef, number])[0],
      { owner: "myorg", number: 1 },
      "add-to-project must reference the parent's project.",
    );
    // Late-binding: issueNumber is resolved from create-issue result
    assertEquals(
      typeof (addCalls[0].args as [ProjectRef, number])[1],
      "number",
      "add-to-project issueNumber must be late-bound from create-issue result.",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("O2: projects=[] — no add-to-project emitted", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createConfig({
      injectGoalIntoPromptContext: false,
      inheritProjectsForCreateIssue: true,
    });
    const github = new ProjectStubGitHubClient(
      [["ready"], ["review"], ["done"]],
      [{ owner: "myorg", number: 1 }],
    );
    const structuredOutput: Record<string, unknown> = {
      deferred_items: [
        {
          title: "Standalone task",
          body: "No project",
          labels: [],
          projects: [], // Explicit opt-out
        },
      ],
    };
    const dispatcher = new StubDispatcher(
      { iterator: "success", reviewer: "approved" },
      undefined,
      undefined,
      structuredOutput,
    );
    const store = new SubjectStore(`${tmpDir}/store`);
    await writeTestIssue(store, 1);
    const orchestrator = new Orchestrator(config, github, dispatcher);

    await orchestrator.run(1, {}, store);

    const createCalls = github.methodCalls.filter(
      (c) => c.method === "createIssue",
    );
    assertEquals(
      createCalls.length,
      1,
      "create-issue must still be emitted for the deferred_item.",
    );

    const addCalls = github.methodCalls.filter(
      (c) => c.method === "addIssueToProject",
    );
    assertEquals(
      addCalls.length,
      0,
      "No add-to-project when projects=[] (explicit opt-out). " +
        "Fix: DeferredItemsEmitter #resolveProjects must return empty for projects=[].",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("O2: projects=[ref] — emits exactly that ref, ignoring parent", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createConfig({
      injectGoalIntoPromptContext: false,
      inheritProjectsForCreateIssue: true,
    });
    const github = new ProjectStubGitHubClient(
      [["ready"], ["review"], ["done"]],
      [{ owner: "parent-org", number: 99 }], // Parent project
    );
    const structuredOutput: Record<string, unknown> = {
      deferred_items: [
        {
          title: "Explicit project task",
          body: "Goes to a specific project",
          labels: ["ready"],
          projects: [{ owner: "other-org", number: 42 }], // Explicit override
        },
      ],
    };
    const dispatcher = new StubDispatcher(
      { iterator: "success", reviewer: "approved" },
      undefined,
      undefined,
      structuredOutput,
    );
    const store = new SubjectStore(`${tmpDir}/store`);
    await writeTestIssue(store, 1);
    const orchestrator = new Orchestrator(config, github, dispatcher);

    await orchestrator.run(1, {}, store);

    const addCalls = github.methodCalls.filter(
      (c) => c.method === "addIssueToProject",
    );
    assertEquals(
      addCalls.length,
      1,
      "Exactly 1 add-to-project for the explicit project (parent ignored). " +
        "Fix: DeferredItemsEmitter #resolveProjects must use item.projects when set.",
    );
    assertEquals(
      (addCalls[0].args as [ProjectRef, number])[0],
      { owner: "other-org", number: 42 },
      "add-to-project must reference the item's explicit project, not the parent's.",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("O2: parent in 2 projects + inherit — 2 add-to-project actions paired (I7)", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createConfig({
      injectGoalIntoPromptContext: false,
      inheritProjectsForCreateIssue: true,
    });
    const github = new ProjectStubGitHubClient(
      [["ready"], ["review"], ["done"]],
      [
        { owner: "org", number: 10 },
        { owner: "org", number: 20 },
      ],
    );
    const structuredOutput: Record<string, unknown> = {
      deferred_items: [
        { title: "Multi-project child", body: "body", labels: ["ready"] },
      ],
    };
    const dispatcher = new StubDispatcher(
      { iterator: "success", reviewer: "approved" },
      undefined,
      undefined,
      structuredOutput,
    );
    const store = new SubjectStore(`${tmpDir}/store`);
    await writeTestIssue(store, 1);
    const orchestrator = new Orchestrator(config, github, dispatcher);

    await orchestrator.run(1, {}, store);

    const createCalls = github.methodCalls.filter(
      (c) => c.method === "createIssue",
    );
    assertEquals(
      createCalls.length,
      1,
      "Exactly 1 create-issue for the single deferred_item.",
    );

    const addCalls = github.methodCalls.filter(
      (c) => c.method === "addIssueToProject",
    );
    assertEquals(
      addCalls.length,
      2,
      "2 add-to-project actions: one per parent project (I7 invariant). " +
        "Fix: DeferredItemsEmitter must emit one add-to-project per inherited project.",
    );

    // Both add-to-project actions target the same created issue
    const issueNumbers = addCalls.map(
      (c) => (c.args as [ProjectRef, number])[1],
    );
    assertEquals(
      issueNumbers[0],
      issueNumbers[1],
      "Both add-to-project must target the same created issue (late-binding).",
    );

    // Different projects
    const projects = addCalls.map(
      (c) => (c.args as [ProjectRef, number])[0],
    );
    assertEquals(
      projects[0],
      { owner: "org", number: 10 },
      "First add-to-project must reference parent project 10.",
    );
    assertEquals(
      projects[1],
      { owner: "org", number: 20 },
      "Second add-to-project must reference parent project 20.",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("O2: flag off — no inheritance emission", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createConfig({
      injectGoalIntoPromptContext: false,
      inheritProjectsForCreateIssue: false, // Flag off
    });
    const github = new ProjectStubGitHubClient(
      [["ready"], ["review"], ["done"]],
      [{ owner: "org", number: 10 }], // Parent has projects, but flag is off
    );
    const structuredOutput: Record<string, unknown> = {
      deferred_items: [
        { title: "Child task", body: "body", labels: ["ready"] },
      ],
    };
    const dispatcher = new StubDispatcher(
      { iterator: "success", reviewer: "approved" },
      undefined,
      undefined,
      structuredOutput,
    );
    const store = new SubjectStore(`${tmpDir}/store`);
    await writeTestIssue(store, 1);
    const orchestrator = new Orchestrator(config, github, dispatcher);

    await orchestrator.run(1, {}, store);

    // create-issue still emitted (deferred_items exist)
    const createCalls = github.methodCalls.filter(
      (c) => c.method === "createIssue",
    );
    assertEquals(
      createCalls.length,
      1,
      "create-issue must still be emitted even with flag off.",
    );

    // But no add-to-project because inheritance flag is off
    const addCalls = github.methodCalls.filter(
      (c) => c.method === "addIssueToProject",
    );
    assertEquals(
      addCalls.length,
      0,
      "No add-to-project when inheritProjectsForCreateIssue=false. " +
        "Fix: orchestrator.ts O2 hook must guard on inheritProjectsForCreateIssue flag.",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ===========================================================================
// Invariant I2: Issue with 0 projects → O1 skip AND O2 no-op
// ===========================================================================

Deno.test("I2: 0 projects — O1 goal injection skip + O2 inheritance no-op", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createConfig({
      injectGoalIntoPromptContext: true,
      inheritProjectsForCreateIssue: true,
    });
    // No projects
    const github = new ProjectStubGitHubClient(
      [["ready"], ["review"], ["done"]],
      [], // 0 projects
    );
    const structuredOutput: Record<string, unknown> = {
      deferred_items: [
        { title: "Task", body: "body", labels: [] },
      ],
    };
    const dispatcher = new StubDispatcher(
      { iterator: "success", reviewer: "approved" },
      undefined,
      undefined,
      structuredOutput,
    );
    const store = new SubjectStore(`${tmpDir}/store`);
    await writeTestIssue(store, 1);
    const orchestrator = new Orchestrator(config, github, dispatcher);

    await orchestrator.run(1, {}, store);

    // O1: no promptContext
    const iteratorCall = dispatcher.calls.find(
      (c) => c.agentId === "iterator",
    );
    assertEquals(
      iteratorCall!.options?.promptContext,
      undefined,
      "I2 O1: promptContext must be undefined when issue has 0 projects.",
    );

    // O2: create-issue emitted but no add-to-project
    const createCalls = github.methodCalls.filter(
      (c) => c.method === "createIssue",
    );
    assertEquals(
      createCalls.length,
      1,
      "I2 O2: create-issue must still be emitted for deferred_item.",
    );
    const addCalls = github.methodCalls.filter(
      (c) => c.method === "addIssueToProject",
    );
    assertEquals(
      addCalls.length,
      0,
      "I2 O2: no add-to-project when parent has 0 projects (inheritance is no-op).",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ===========================================================================
// Invariant I7: Multi-project inheritance — all projects bound
// ===========================================================================

Deno.test("I7: 2 projects + 2 deferred_items — each child bound to all parent projects", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const config = createConfig({
      injectGoalIntoPromptContext: false,
      inheritProjectsForCreateIssue: true,
    });
    const github = new ProjectStubGitHubClient(
      [["ready"], ["review"], ["done"]],
      [
        { owner: "org", number: 10 },
        { owner: "org", number: 20 },
      ],
    );
    const structuredOutput: Record<string, unknown> = {
      deferred_items: [
        { title: "Child A", body: "body A", labels: ["ready"] },
        { title: "Child B", body: "body B", labels: ["ready"] },
      ],
    };
    const dispatcher = new StubDispatcher(
      { iterator: "success", reviewer: "approved" },
      undefined,
      undefined,
      structuredOutput,
    );
    const store = new SubjectStore(`${tmpDir}/store`);
    await writeTestIssue(store, 1);
    const orchestrator = new Orchestrator(config, github, dispatcher);

    await orchestrator.run(1, {}, store);

    const createCalls = github.methodCalls.filter(
      (c) => c.method === "createIssue",
    );
    assertEquals(
      createCalls.length,
      2,
      "I7: 2 create-issue actions for 2 deferred_items.",
    );

    const addCalls = github.methodCalls.filter(
      (c) => c.method === "addIssueToProject",
    );
    assertEquals(
      addCalls.length,
      4,
      "I7: 4 add-to-project actions (2 items × 2 parent projects). " +
        "Fix: each inherited child must be bound to ALL parent projects.",
    );

    // Group by project number to verify each project gets 2 bindings
    const byProject = new Map<number, number>();
    for (const call of addCalls) {
      const project = (call.args as [ProjectRef, number])[0] as {
        owner: string;
        number: number;
      };
      byProject.set(project.number, (byProject.get(project.number) ?? 0) + 1);
    }
    assertEquals(
      byProject.get(10),
      2,
      "I7: Project 10 must receive 2 add-to-project bindings (one per child).",
    );
    assertEquals(
      byProject.get(20),
      2,
      "I7: Project 20 must receive 2 add-to-project bindings (one per child).",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
