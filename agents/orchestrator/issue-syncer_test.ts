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
import {
  deriveInvocations,
  type IssueSource,
  type WorkflowConfig,
} from "./workflow-types.ts";
import { TEST_DEFAULT_ISSUE_SOURCE } from "./_test-fixtures.ts";

/**
 * Default `IssueSource` for tests that exercise the legacy "no CLI args"
 * behavior — `ghRepoIssues` with the implicit unbound-only filter.
 */
const REPO_ISSUES_UNBOUND: IssueSource = TEST_DEFAULT_ISSUE_SOURCE;

/**
 * `ghRepoIssues` variant with the escape-hatch `projectMembership: "any"`,
 * the ADT replacement for the legacy `criteria.allProjects = true`.
 */
const REPO_ISSUES_ANY: IssueSource = {
  kind: "ghRepoIssues",
  projectMembership: "any",
};

/** Stub GitHub client with configurable return values. */
class StubGitHubClient implements GitHubClient {
  #issues: IssueListItem[];
  #details: Map<number, IssueDetail>;
  #projectItems: { id: string; issueNumber: number }[] = [];
  #issueProjects: Map<number, Array<{ owner: string; number: number }>> =
    new Map();
  labelUpdates: { number: number; remove: string[]; add: string[] }[] = [];
  listIssuesCalls: IssueCriteria[] = [];
  listProjectItemsCalls: ProjectRef[] = [];
  getIssueProjectsCalls: number[] = [];
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
  setIssueProjects(
    map: Record<number, Array<{ owner: string; number: number }>>,
  ): void {
    this.#issueProjects = new Map(
      Object.entries(map).map(([k, v]) => [Number(k), v]),
    );
  }
  getIssueProjects(
    issueNumber: number,
  ): Promise<Array<{ owner: string; number: number }>> {
    this.getIssueProjectsCalls.push(issueNumber);
    return Promise.resolve(this.#issueProjects.get(issueNumber) ?? []);
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

    await syncer.sync(REPO_ISSUES_ANY);

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

    const result = await syncer.sync(REPO_ISSUES_ANY);
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

    const result = await syncer.sync(REPO_ISSUES_ANY);
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
    await syncer.sync(REPO_ISSUES_ANY);

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

Deno.test("ghRepoIssues fields project to listIssues criteria correctly", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeStub([]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    // Source-level fields (labels, state, limit) project to the
    // transport-level IssueCriteria consumed by `listIssues`.
    await syncer.sync({
      kind: "ghRepoIssues",
      labels: ["bug", "urgent"],
      state: "open",
      limit: 50,
      projectMembership: "any",
    });

    assertEquals(github.listIssuesCalls.length, 1);
    const expected: IssueCriteria = {
      labels: ["bug", "urgent"],
      state: "open",
      limit: 50,
    };
    assertEquals(github.listIssuesCalls[0], expected);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Per-project filtering
// ---------------------------------------------------------------------------

Deno.test("ghProject filters to project member issues only", async () => {
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
      kind: "ghProject",
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

Deno.test("ghRepoIssues with projectMembership=unbound keeps only unbound issues", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeStub([10, 20, 30]);
    // Issue 20 is bound to a project; 10 and 30 are unbound.
    github.setIssueProjects({
      20: [{ owner: "tettuan", number: 41 }],
    });
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const result = await syncer.sync(REPO_ISSUES_UNBOUND);

    // Only unbound issues (10, 30) are processed.
    assertEquals(result, [10, 30]);
    // listProjectItems must not be called for the ghRepoIssues variant.
    assertEquals(github.listProjectItemsCalls.length, 0);
    // getIssueProjects called once per listed issue (membership probe).
    assertEquals(github.getIssueProjectsCalls.sort((a, b) => a - b), [
      10,
      20,
      30,
    ]);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ghRepoIssues with projectMembership=any bypasses the unbound filter", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeStub([10, 20, 30]);
    github.setIssueProjects({
      20: [{ owner: "tettuan", number: 41 }],
    });
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const result = await syncer.sync(REPO_ISSUES_ANY);

    // Every listed issue is kept regardless of project membership.
    assertEquals(result, [10, 20, 30]);
    // No project queries needed in escape-hatch mode.
    assertEquals(github.listProjectItemsCalls.length, 0);
    assertEquals(github.getIssueProjectsCalls.length, 0);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ghProject with no matching issues returns empty", async () => {
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
      kind: "ghProject",
      project: { owner: "org", number: 5 },
    });

    assertEquals(result, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ghProject calls listProjectItems exactly once", async () => {
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
    await syncer.sync({ kind: "ghProject", project: projectRef });

    assertEquals(github.listProjectItemsCalls.length, 1);
    assertEquals(github.listProjectItemsCalls[0], projectRef);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ghRepoIssues never calls listProjectItems", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeStub([10, 20]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    await syncer.sync(REPO_ISSUES_ANY);

    assertEquals(github.listProjectItemsCalls.length, 0);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ghProject + labels applies both gh filter and project intersection", async () => {
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

    const result = await syncer.sync({
      kind: "ghProject",
      project: { owner: "org", number: 5 },
      labels: ["kind:impl"],
      state: "open",
      limit: 50,
    });

    // Label/state/limit fields are projected onto the gh listIssues call.
    assertEquals(github.listIssuesCalls.length, 1);
    const expected: IssueCriteria = {
      labels: ["kind:impl"],
      state: "open",
      limit: 50,
    };
    assertEquals(github.listIssuesCalls[0], expected);

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

Deno.test("explicit variant skips listing and syncs declared ids only", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    // Empty list ensures the explicit variant's listing-skip is verified.
    // Detail lookups still need to resolve the declared ids.
    const detailMap = new Map<number, IssueDetail>();
    detailMap.set(7, makeDetail(7));
    detailMap.set(11, makeDetail(11));
    const github = new StubGitHubClient([], detailMap);

    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const result = await syncer.sync({
      kind: "explicit",
      issueIds: [7, 11],
    });

    assertEquals(result, [7, 11]);
    // Listing must not be consulted in the explicit variant.
    assertEquals(github.listIssuesCalls.length, 0);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Multi-project per-project dispatch filter (e2e)
// ---------------------------------------------------------------------------

/**
 * Fixture layout for multi-project tests:
 *
 *   Issue 10 — project A only
 *   Issue 20 — project B only
 *   Issue 30 — both project A and project B
 *   Issue 40 — no project (unbound)
 *
 * StubGitHubClient.listIssues always returns all four.
 * Per-project filtering is exercised by varying the ghProject source.
 */
function makeMultiProjectStub(): StubGitHubClient {
  const github = makeStub([10, 20, 30, 40]);
  github.setIssueProjects({
    10: [{ owner: "tettuan", number: 1 }],
    20: [{ owner: "tettuan", number: 2 }],
    30: [{ owner: "tettuan", number: 1 }, { owner: "tettuan", number: 2 }],
  });
  return github;
}

const PROJECT_A: { owner: string; number: number } = {
  owner: "tettuan",
  number: 1,
};
const PROJECT_B: { owner: string; number: number } = {
  owner: "tettuan",
  number: 2,
};

Deno.test("ghProject A dispatches only project-A members (excludes B-only and unbound)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeMultiProjectStub();
    // Project A contains issues 10 and 30
    github.setProjectItems([
      { id: "PVTI_10", issueNumber: 10 },
      { id: "PVTI_30", issueNumber: 30 },
    ]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const result = await syncer.sync({
      kind: "ghProject",
      project: PROJECT_A,
    });

    assertEquals(result, [10, 30]);
    // Issue 20 (B-only) must not be in the store
    let notFound20 = false;
    try {
      await store.readMeta(20);
    } catch {
      notFound20 = true;
    }
    assertEquals(
      notFound20,
      true,
      "Issue 20 (project-B only) must not be synced for project A",
    );
    // Issue 40 (unbound) must not be in the store
    let notFound40 = false;
    try {
      await store.readMeta(40);
    } catch {
      notFound40 = true;
    }
    assertEquals(
      notFound40,
      true,
      "Issue 40 (unbound) must not be synced for project A",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ghProject B dispatches only project-B members (excludes A-only and unbound)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeMultiProjectStub();
    // Project B contains issues 20 and 30
    github.setProjectItems([
      { id: "PVTI_20", issueNumber: 20 },
      { id: "PVTI_30", issueNumber: 30 },
    ]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const result = await syncer.sync({
      kind: "ghProject",
      project: PROJECT_B,
    });

    assertEquals(result, [20, 30]);
    // Issue 10 (A-only) must not be in the store
    let notFound10 = false;
    try {
      await store.readMeta(10);
    } catch {
      notFound10 = true;
    }
    assertEquals(
      notFound10,
      true,
      "Issue 10 (project-A only) must not be synced for project B",
    );
    // Issue 40 (unbound) must not be in the store
    let notFound40 = false;
    try {
      await store.readMeta(40);
    } catch {
      notFound40 = true;
    }
    assertEquals(
      notFound40,
      true,
      "Issue 40 (unbound) must not be synced for project B",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("shared issue (both A and B) appears in each project filter independently", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeMultiProjectStub();
    // Project A contains issues 10 and 30
    github.setProjectItems([
      { id: "PVTI_10", issueNumber: 10 },
      { id: "PVTI_30", issueNumber: 30 },
    ]);
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const resultA = await syncer.sync({
      kind: "ghProject",
      project: PROJECT_A,
    });
    assertEquals(
      resultA.includes(30),
      true,
      "Issue 30 must appear in project A results",
    );

    // Reset store for project B run
    const tmpB = await Deno.makeTempDir();
    try {
      const githubB = makeMultiProjectStub();
      githubB.setProjectItems([
        { id: "PVTI_20", issueNumber: 20 },
        { id: "PVTI_30", issueNumber: 30 },
      ]);
      const storeB = new SubjectStore(tmpB);
      const syncerB = new IssueSyncer(githubB, storeB);

      const resultB = await syncerB.sync({
        kind: "ghProject",
        project: PROJECT_B,
      });
      assertEquals(
        resultB.includes(30),
        true,
        "Issue 30 must appear in project B results",
      );
    } finally {
      await Deno.remove(tmpB, { recursive: true });
    }
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ghRepoIssues with projectMembership=any dispatches all issues regardless of project (regression)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeMultiProjectStub();
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const result = await syncer.sync(REPO_ISSUES_ANY);

    // All four issues must be dispatched
    assertEquals(result, [10, 20, 30, 40]);
    // No project queries needed in escape-hatch mode
    assertEquals(github.listProjectItemsCalls.length, 0);
    assertEquals(github.getIssueProjectsCalls.length, 0);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("ghRepoIssues with unbound keeps only project-free issues in multi-project env", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const github = makeMultiProjectStub();
    const store = new SubjectStore(tmp);
    const syncer = new IssueSyncer(github, store);

    const result = await syncer.sync(REPO_ISSUES_UNBOUND);

    // Only issue 40 (unbound) survives; 10, 20, 30 all have project membership
    assertEquals(result, [40]);
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
      kind: "ghProject",
      project: { owner: "org", number: 5 },
    });
    // Issue 20 excluded by project filter
    assertEquals(synced, [10, 30, 40]);

    // Build queue from synced issues
    const queuePhases = {
      ready: { type: "actionable" as const, priority: 1, agent: "writer" },
    };
    const queueAgents = {
      writer: { role: "transformer" as const, outputPhase: "done" },
    };
    const workflowConfig: WorkflowConfig = {
      version: "1",
      issueSource: TEST_DEFAULT_ISSUE_SOURCE,
      phases: queuePhases,
      labelMapping: { ready: "ready" },
      agents: queueAgents,
      invocations: deriveInvocations(queuePhases, queueAgents),
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
