import { assertEquals } from "jsr:@std/assert";
import { IssueSyncer } from "./issue-syncer.ts";
import { SubjectStore } from "./subject-store.ts";
import type {
  GitHubClient,
  IssueCriteria,
  IssueDetail,
  IssueListItem,
} from "./github-client.ts";
import type { ProjectFieldValue, ProjectRef } from "./outbox-processor.ts";

/** Stub GitHub client with configurable return values. */
class StubGitHubClient implements GitHubClient {
  #issues: IssueListItem[];
  #details: Map<number, IssueDetail>;
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
