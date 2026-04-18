/**
 * Deferred items project inheritance tests (issue #487, design §2.4 Hook O2).
 *
 * Validates that DeferredItemsEmitter correctly pairs `create-issue` actions
 * with `add-to-project` actions when parentProjects are provided, and that
 * the OutboxProcessor's late-binding contract resolves the issueNumber.
 */

import { assertEquals } from "jsr:@std/assert";
import type { GitHubClient } from "./github-client.ts";
import type {
  IssueCriteria,
  IssueDetail,
  IssueListItem,
  LabelDetail,
} from "./github-client.ts";
import type { ProjectFieldValue, ProjectRef } from "./outbox-processor.ts";
import { SubjectStore } from "./subject-store.ts";
import { OutboxProcessor } from "./outbox-processor.ts";
import { DeferredItemsEmitter } from "./deferred-items-emitter.ts";

// ---------------------------------------------------------------------------
// Spy GitHub client
// ---------------------------------------------------------------------------
class SpyGitHubClient implements GitHubClient {
  calls: { method: string; args: unknown[] }[] = [];
  #nextIssueNumber = 200;

  async getIssueLabels(): Promise<string[]> {
    return await Promise.resolve([]);
  }
  async updateIssueLabels(
    subjectId: number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    this.calls.push({
      method: "updateIssueLabels",
      args: [subjectId, labelsToRemove, labelsToAdd],
    });
    await Promise.resolve();
  }
  async addIssueComment(subjectId: number, comment: string): Promise<void> {
    this.calls.push({
      method: "addIssueComment",
      args: [subjectId, comment],
    });
    await Promise.resolve();
  }
  async createIssue(
    title: string,
    labels: string[],
    body: string,
  ): Promise<number> {
    const num = this.#nextIssueNumber++;
    this.calls.push({ method: "createIssue", args: [title, labels, body] });
    return await Promise.resolve(num);
  }
  async closeIssue(subjectId: number): Promise<void> {
    this.calls.push({ method: "closeIssue", args: [subjectId] });
    await Promise.resolve();
  }
  reopenIssue(): Promise<void> {
    return Promise.reject(new Error("not implemented"));
  }
  getRecentComments(): Promise<{ body: string; createdAt: string }[]> {
    return Promise.resolve([]);
  }
  async listIssues(_criteria: IssueCriteria): Promise<IssueListItem[]> {
    return await Promise.resolve([]);
  }
  async getIssueDetail(): Promise<IssueDetail> {
    return await Promise.resolve({
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
  async listLabels(): Promise<string[]> {
    return await Promise.resolve([]);
  }
  async listLabelsDetailed(): Promise<LabelDetail[]> {
    return await Promise.resolve([]);
  }
  async createLabel(): Promise<void> {
    await Promise.resolve();
  }
  async updateLabel(): Promise<void> {
    await Promise.resolve();
  }
  async addIssueToProject(
    project: ProjectRef,
    issueNumber: number,
  ): Promise<string> {
    this.calls.push({
      method: "addIssueToProject",
      args: [project, issueNumber],
    });
    return await Promise.resolve(`PVTI_${issueNumber}`);
  }
  async updateProjectItemField(
    project: ProjectRef,
    itemId: string,
    fieldId: string,
    value: ProjectFieldValue,
  ): Promise<void> {
    this.calls.push({
      method: "updateProjectItemField",
      args: [project, itemId, fieldId, value],
    });
    await Promise.resolve();
  }
  async closeProject(project: ProjectRef): Promise<void> {
    this.calls.push({ method: "closeProject", args: [project] });
    await Promise.resolve();
  }
}

// ===========================================================================
// Inheritance: emit + process round-trip
// ===========================================================================

Deno.test("inheritance: single item inherits parent project", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new SubjectStore(tmp);
    const emitter = new DeferredItemsEmitter(store);

    const parentProjects: ProjectRef[] = [
      { owner: "myorg", number: 1 },
    ];

    const result = await emitter.emit(
      42,
      {
        deferred_items: [
          { title: "Sub-task", body: "Do X", labels: ["kind:impl"] },
        ],
      },
      parentProjects,
    );

    // 1 create-issue path (only create-issue tracked for idempotency)
    assertEquals(result.count, 1);
    assertEquals(result.paths.length, 1);
    assertEquals(result.emittedKeys.length, 1);

    // Verify files written: create-issue + add-to-project
    const outboxDir = store.getOutboxPath(42);
    const files: string[] = [];
    for await (const entry of Deno.readDir(outboxDir)) {
      if (entry.isFile) files.push(entry.name);
    }
    files.sort();
    assertEquals(files.length, 2);
    assertEquals(files[0], "000-deferred-000.json"); // create-issue
    assertEquals(files[1], "000-deferred-001.json"); // add-to-project

    // Verify file contents
    const createContent = JSON.parse(
      await Deno.readTextFile(`${outboxDir}/${files[0]}`),
    );
    assertEquals(createContent.action, "create-issue");
    assertEquals(createContent.title, "Sub-task");

    const bindContent = JSON.parse(
      await Deno.readTextFile(`${outboxDir}/${files[1]}`),
    );
    assertEquals(bindContent.action, "add-to-project");
    assertEquals(bindContent.project, { owner: "myorg", number: 1 });
    assertEquals(bindContent.issueNumber, undefined); // late-bind

    // Process through OutboxProcessor
    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const processResults = await processor.process(42);

    assertEquals(processResults.length, 2);
    assertEquals(processResults.every((r) => r.success), true);

    // Verify late-binding resolved correctly
    const addCall = github.calls.find((c) => c.method === "addIssueToProject");
    assertEquals(addCall!.args[0], { owner: "myorg", number: 1 });
    assertEquals(addCall!.args[1], 200); // first createIssue returns 200
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("inheritance: item inherits multiple parent projects", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new SubjectStore(tmp);
    const emitter = new DeferredItemsEmitter(store);

    const parentProjects: ProjectRef[] = [
      { owner: "org", number: 1 },
      { owner: "org", number: 2 },
    ];

    await emitter.emit(
      50,
      {
        deferred_items: [
          { title: "Task", body: "body", labels: [] },
        ],
      },
      parentProjects,
    );

    // Files: create-issue + 2 add-to-project
    const outboxDir = store.getOutboxPath(50);
    const files: string[] = [];
    for await (const entry of Deno.readDir(outboxDir)) {
      if (entry.isFile) files.push(entry.name);
    }
    files.sort();
    assertEquals(files.length, 3);

    // Process and verify
    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(50);

    assertEquals(results.length, 3);
    assertEquals(results.every((r) => r.success), true);

    const addCalls = github.calls.filter(
      (c) => c.method === "addIssueToProject",
    );
    assertEquals(addCalls.length, 2);
    // Both use the same created issue number (200)
    assertEquals(addCalls[0].args[1], 200);
    assertEquals(addCalls[1].args[1], 200);
    // Different projects
    assertEquals(addCalls[0].args[0], { owner: "org", number: 1 });
    assertEquals(addCalls[1].args[0], { owner: "org", number: 2 });
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("inheritance: explicit projects override parent projects", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new SubjectStore(tmp);
    const emitter = new DeferredItemsEmitter(store);

    const parentProjects: ProjectRef[] = [
      { owner: "org", number: 1 },
    ];

    await emitter.emit(
      51,
      {
        deferred_items: [
          {
            title: "Task",
            body: "body",
            labels: [],
            projects: [{ owner: "other", number: 9 }],
          },
        ],
      },
      parentProjects,
    );

    const outboxDir = store.getOutboxPath(51);
    const files: string[] = [];
    for await (const entry of Deno.readDir(outboxDir)) {
      if (entry.isFile) files.push(entry.name);
    }
    files.sort();
    // create-issue + 1 add-to-project (explicit, not inherited)
    assertEquals(files.length, 2);

    const bindContent = JSON.parse(
      await Deno.readTextFile(`${outboxDir}/${files[1]}`),
    );
    assertEquals(bindContent.project, { owner: "other", number: 9 });
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("inheritance: empty projects array opts out", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new SubjectStore(tmp);
    const emitter = new DeferredItemsEmitter(store);

    const parentProjects: ProjectRef[] = [
      { owner: "org", number: 1 },
    ];

    await emitter.emit(
      52,
      {
        deferred_items: [
          { title: "Task", body: "body", labels: [], projects: [] },
        ],
      },
      parentProjects,
    );

    const outboxDir = store.getOutboxPath(52);
    const files: string[] = [];
    for await (const entry of Deno.readDir(outboxDir)) {
      if (entry.isFile) files.push(entry.name);
    }
    // Only create-issue, no add-to-project (opt-out)
    assertEquals(files.length, 1);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("inheritance: no parentProjects means no binding", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new SubjectStore(tmp);
    const emitter = new DeferredItemsEmitter(store);

    // No parentProjects argument
    await emitter.emit(53, {
      deferred_items: [
        { title: "Task", body: "body", labels: [] },
      ],
    });

    const outboxDir = store.getOutboxPath(53);
    const files: string[] = [];
    for await (const entry of Deno.readDir(outboxDir)) {
      if (entry.isFile) files.push(entry.name);
    }
    // Only create-issue
    assertEquals(files.length, 1);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("inheritance: multiple items each inherit parent projects", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new SubjectStore(tmp);
    const emitter = new DeferredItemsEmitter(store);

    const parentProjects: ProjectRef[] = [
      { owner: "org", number: 1 },
    ];

    await emitter.emit(
      54,
      {
        deferred_items: [
          { title: "A", body: "a", labels: [] },
          { title: "B", body: "b", labels: [] },
        ],
      },
      parentProjects,
    );

    // 2 create-issue + 2 add-to-project = 4 files
    const outboxDir = store.getOutboxPath(54);
    const files: string[] = [];
    for await (const entry of Deno.readDir(outboxDir)) {
      if (entry.isFile) files.push(entry.name);
    }
    files.sort();
    assertEquals(files.length, 4);

    // Process and verify late-binding for each pair
    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(54);

    assertEquals(results.length, 4);
    assertEquals(results.every((r) => r.success), true);

    const addCalls = github.calls.filter(
      (c) => c.method === "addIssueToProject",
    );
    assertEquals(addCalls.length, 2);
    assertEquals(addCalls[0].args[1], 200); // first item's issue
    assertEquals(addCalls[1].args[1], 201); // second item's issue
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
