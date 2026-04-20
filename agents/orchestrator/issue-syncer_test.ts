import { assertEquals } from "jsr:@std/assert";
import { IssueSyncer } from "./issue-syncer.ts";
import { SubjectStore } from "./subject-store.ts";
import { Queue } from "./queue.ts";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
  Project,
  ProjectField,
} from "./github-client.ts";
import type { ProjectFieldValue, ProjectRef } from "./outbox-processor.ts";
import type { WorkflowConfig } from "./workflow-types.ts";

/** Stub GitHub client with configurable return values. */
class StubGitHubClient implements GitHubClient {
  #issues: IssueListItem[];
  #details: Map<number, IssueDetail>;
  #projectItems: { id: string; issueNumber: number }[] = [];
  labelUpdates: { number: number; remove: string[]; add: string[] }[] = [];
  listIssuesCalls: IssueCriteria[] = [];
  listProjectItemsCalls: ProjectRef[] = [];
  commentCalls: { number: number; comment: string }[] = [];

  constructor(
    issues: IssueListItem[],
    details: Map<number, IssueDetail>,
  ) {
    this.#issues = issues;
    this.#details = details;
  }

  getIssueLabels(subjectId: number): Promise<string[]> {
    const detail = this.#details.get(subjectId);
    return Promise.resolve(detail?.labels ?? []);
  }

  updateIssueLabels(
    subjectId: number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    this.labelUpdates.push({
      number: subjectId,
      remove: labelsToRemove,
      add: labelsToAdd,
    });
    return Promise.resolve();
  }

  addIssueComment(subjectId: number, comment: string): Promise<void> {
    this.commentCalls.push({ number: subjectId, comment });
    return Promise.resolve();
  }

  createIssue(
    _title: string,
    _labels: string[],
    _body: string,
  ): Promise<number> {
    return Promise.resolve(0);
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
      return Promise.reject(new Error(`No detail for issue #${subjectId}`));
    }
    return Promise.resolve(detail);
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
  setProjectItems(items: { id: string; issueNumber: number }[]): void {
    this.#projectItems = items;
  }
  listProjectItems(
    project: ProjectRef,
  ): Promise<{ id: string; issueNumber: number }[]> {
    this.listProjectItemsCalls.push(project);
    return Promise.resolve(this.#projectItems);
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

function makeDetail(num: number, labels = ["bug"]): IssueDetail {
  return {
    number: num,
    title: `Issue ${num}`,
    body: `Body of issue ${num}`,
    labels,
    state: "open",
    assignees: ["alice"],
    milestone: null,
    comments: [{ id: `c${num}`, body: `Comment on ${num}` }],
  };
}

function makeListItem(num: number, labels = ["bug"]): IssueListItem {
  return {
    number: num,
    title: `Issue ${num}`,
    labels,
    state: "open",
  };
}

function makeStub(
  nums: number[],
): StubGitHubClient {
  const items = nums.map((n) => makeListItem(n));
  const details = new Map<number, IssueDetail>();
  for (const num of nums) {
    details.set(num, makeDetail(num));
  }
  return new StubGitHubClient(items, details);
}

function makeStubWithLabels(
  entries: { num: number; labels: string[] }[],
): StubGitHubClient {
  const items = entries.map((e) => makeListItem(e.num, e.labels));
  const details = new Map<number, IssueDetail>();
  for (const e of entries) {
    details.set(e.num, makeDetail(e.num, e.labels));
  }
  return new StubGitHubClient(items, details);
}

Deno.test("sync fetches and stores all issues", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeStub([10, 20]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    await syncer.sync({});

    const meta10 = await store.readMeta(10);
    assertEquals(meta10.number, 10);
    assertEquals(meta10.title, "Issue 10");
    assertEquals(meta10.labels, ["bug"]);

    const body20 = await store.readBody(20);
    assertEquals(body20, "Body of issue 20");

    const comments10 = await store.readComments(10);
    assertEquals(comments10.length, 1);
    assertEquals(comments10[0].id, "c10");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("sync returns sorted issue numbers", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeStub([30, 5, 15]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const result = await syncer.sync({});
    assertEquals(result, [5, 15, 30]);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("sync with empty list returns empty array", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeStub([]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const result = await syncer.sync({});
    assertEquals(result, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("pushLabels updates both GitHub and local store", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeStub([7]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    // Pre-populate store with issue 7
    await syncer.sync({});

    // Verify initial labels
    const before = await store.readMeta(7);
    assertEquals(before.labels, ["bug"]);

    // Push label changes: remove "bug", add "feature"
    await syncer.pushLabels(7, ["bug"], ["feature"]);

    // Verify GitHub was called
    assertEquals(github.labelUpdates.length, 1);
    assertEquals(github.labelUpdates[0].number, 7);
    assertEquals(github.labelUpdates[0].remove, ["bug"]);
    assertEquals(github.labelUpdates[0].add, ["feature"]);

    // Verify local store was updated
    const after = await store.readMeta(7);
    assertEquals(after.labels, ["feature"]);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("listIssues criteria passed correctly to GitHub client", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeStub([]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const criteria: IssueCriteria = {
      labels: ["bug", "urgent"],
      state: "open",
      limit: 50,
    };

    await syncer.sync(criteria);

    assertEquals(github.listIssuesCalls.length, 1);
    assertEquals(github.listIssuesCalls[0], criteria);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Per-project filtering
// ---------------------------------------------------------------------------

Deno.test("sync with project filters to project member issues only", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeStub([10, 20, 30]);
    // Only issues 10 and 30 belong to the project
    github.setProjectItems([
      { id: "PVTI_10", issueNumber: 10 },
      { id: "PVTI_30", issueNumber: 30 },
    ]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const result = await syncer.sync({
      project: { owner: "org", number: 5 },
    });

    // Only project member issues are synced
    assertEquals(result, [10, 30]);
    // Issue 20 should not be in the store
    let notFound = false;
    try {
      await store.readMeta(20);
    } catch {
      notFound = true;
    }
    assertEquals(notFound, true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("sync without project syncs all issues (backward compatible)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeStub([10, 20, 30]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const result = await syncer.sync({});

    assertEquals(result, [10, 20, 30]);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("sync with project and no matching issues returns empty", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeStub([10, 20]);
    // Project has different issues
    github.setProjectItems([
      { id: "PVTI_99", issueNumber: 99 },
    ]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const result = await syncer.sync({
      project: { owner: "org", number: 5 },
    });

    assertEquals(result, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("sync with project calls listProjectItems exactly once", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeStub([10, 20, 30]);
    github.setProjectItems([
      { id: "PVTI_10", issueNumber: 10 },
      { id: "PVTI_30", issueNumber: 30 },
    ]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const projectRef = { owner: "org", number: 5 };
    await syncer.sync({ project: projectRef });

    assertEquals(github.listProjectItemsCalls.length, 1);
    assertEquals(github.listProjectItemsCalls[0], projectRef);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("sync without project does not call listProjectItems", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeStub([10, 20]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    await syncer.sync({});

    assertEquals(github.listProjectItemsCalls.length, 0);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("sync with project and labels applies both filters (intersection)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    // listIssues returns items matching label criteria
    const github = makeStub([10, 20, 30]);
    // Project only contains issues 10 and 30
    github.setProjectItems([
      { id: "PVTI_10", issueNumber: 10 },
      { id: "PVTI_30", issueNumber: 30 },
    ]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const criteria: IssueCriteria = {
      labels: ["kind:impl"],
      state: "open",
      limit: 50,
      project: { owner: "org", number: 5 },
    };
    const result = await syncer.sync(criteria);

    // Label/state/limit criteria passed to listIssues
    assertEquals(github.listIssuesCalls.length, 1);
    assertEquals(github.listIssuesCalls[0], criteria);

    // Project intersection further filtered: only 10 and 30 are members
    assertEquals(result, [10, 30]);

    // Issue 20 is not stored (excluded by project filter)
    let notFound = false;
    try {
      await store.readMeta(20);
    } catch {
      notFound = true;
    }
    assertEquals(notFound, true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Prioritizer orders within project-filtered set
// ---------------------------------------------------------------------------

Deno.test("queue orders project-filtered issues by priority; non-members never surface", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    // 4 issues: 10 (P3), 20 (P1), 30 (P2), 40 (P1)
    // All have "ready" label for phase resolution
    const github = makeStubWithLabels([
      { num: 10, labels: ["ready", "P3"] },
      { num: 20, labels: ["ready", "P1"] },
      { num: 30, labels: ["ready", "P2"] },
      { num: 40, labels: ["ready", "P1"] },
    ]);
    // Project only contains 10, 30, 40 — issue 20 is NOT a member
    github.setProjectItems([
      { id: "PVTI_10", issueNumber: 10 },
      { id: "PVTI_30", issueNumber: 30 },
      { id: "PVTI_40", issueNumber: 40 },
    ]);

    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    // Sync with project filter
    const synced = await syncer.sync({
      project: { owner: "org", number: 5 },
    });
    // Issue 20 excluded by project filter
    assertEquals(synced, [10, 30, 40]);

    // Build queue from synced issues
    const workflowConfig: WorkflowConfig = {
      version: "1",
      phases: {
        ready: { type: "actionable", priority: 1, agent: "writer" },
      },
      labelMapping: { ready: "ready" },
      agents: {
        writer: { role: "transformer", outputPhase: "done" },
      },
      rules: { maxCycles: 5, cycleDelayMs: 0 },
    };

    const queue = new Queue(workflowConfig, store, {
      labels: ["P1", "P2", "P3"],
    });
    const items = await queue.buildQueue(synced);

    // 3 items (issue 20 never surfaces)
    assertEquals(items.length, 3);

    // Ordered by priority: P1 first, then P2, then P3
    assertEquals(items[0].subjectId, 40);
    assertEquals(items[0].priority, "P1");
    assertEquals(items[1].subjectId, 30);
    assertEquals(items[1].priority, "P2");
    assertEquals(items[2].subjectId, 10);
    assertEquals(items[2].priority, "P3");

    // Issue 20 (non-member) is not in the queue
    const queuedIds = items.map((item) => item.subjectId);
    assertEquals(queuedIds.includes(20), false);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
