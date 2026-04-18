import { assertEquals } from "jsr:@std/assert";
import { IssueSyncer } from "./issue-syncer.ts";
import { SubjectStore } from "./subject-store.ts";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
  Project,
  ProjectField,
} from "./github-client.ts";
import type { ProjectFieldValue, ProjectRef } from "./outbox-processor.ts";

/** Stub GitHub client with configurable return values. */
class StubGitHubClient implements GitHubClient {
  #issues: IssueListItem[];
  #details: Map<number, IssueDetail>;
  #projectItems: { id: string; issueNumber: number }[] = [];
  labelUpdates: { number: number; remove: string[]; add: string[] }[] = [];
  listIssuesCalls: IssueCriteria[] = [];
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
    _project: ProjectRef,
  ): Promise<{ id: string; issueNumber: number }[]> {
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

function makeDetail(num: number): IssueDetail {
  return {
    number: num,
    title: `Issue ${num}`,
    body: `Body of issue ${num}`,
    labels: ["bug"],
    state: "open",
    assignees: ["alice"],
    milestone: null,
    comments: [{ id: `c${num}`, body: `Comment on ${num}` }],
  };
}

function makeListItem(num: number): IssueListItem {
  return {
    number: num,
    title: `Issue ${num}`,
    labels: ["bug"],
    state: "open",
  };
}

function makeStub(
  nums: number[],
): StubGitHubClient {
  const items = nums.map(makeListItem);
  const details = new Map<number, IssueDetail>();
  for (const num of nums) {
    details.set(num, makeDetail(num));
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
