/**
 * OutboxProcessor late-binding and post-close trigger tests (issue #487).
 *
 * Gap 1 — Late-binding contract:
 *   `add-to-project` with absent `issueNumber` resolves from the most
 *   recently succeeded `create-issue` result in the same process() call.
 *
 * Gap 2 — Post-close trigger:
 *   Actions with `trigger: "post-close"` are skipped by `process()` and
 *   executed by `processPostClose()` after T6 close.
 */

import { assertEquals, assertRejects } from "jsr:@std/assert";
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

// ---------------------------------------------------------------------------
// Spy GitHub client that records all calls with arguments
// ---------------------------------------------------------------------------
class SpyGitHubClient implements GitHubClient {
  calls: { method: string; args: unknown[] }[] = [];
  #nextIssueNumber = 100;

  async getIssueLabels(_subjectId: number): Promise<string[]> {
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
  reopenIssue(_subjectId: number): Promise<void> {
    return Promise.reject(new Error("not implemented"));
  }
  getRecentComments(
    _subjectId: number,
    _limit: number,
  ): Promise<{ body: string; createdAt: string }[]> {
    return Promise.resolve([]);
  }
  async listIssues(_criteria: IssueCriteria): Promise<IssueListItem[]> {
    return await Promise.resolve([]);
  }
  async getIssueDetail(_subjectId: number): Promise<IssueDetail> {
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
  async createLabel(
    _name: string,
    _color: string,
    _description: string,
  ): Promise<void> {
    await Promise.resolve();
  }
  async updateLabel(
    _name: string,
    _color: string,
    _description: string,
  ): Promise<void> {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function setupStore(
  subjectId: number,
): Promise<{ store: SubjectStore; tmp: string }> {
  const tmp = await Deno.makeTempDir();
  const store = new SubjectStore(tmp);
  const outboxDir = store.getOutboxPath(subjectId);
  await Deno.mkdir(outboxDir, { recursive: true });
  return { store, tmp };
}

async function writeAction(
  store: SubjectStore,
  subjectId: number,
  filename: string,
  action: Record<string, unknown>,
): Promise<void> {
  const outboxDir = store.getOutboxPath(subjectId);
  await Deno.writeTextFile(
    `${outboxDir}/${filename}`,
    JSON.stringify(action),
  );
}

// ===========================================================================
// Gap 1: Late-binding contract tests
// ===========================================================================

Deno.test("late-binding: add-to-project uses preceding create-issue result", async () => {
  const { store, tmp } = await setupStore(100);
  try {
    // create-issue followed by add-to-project (issueNumber absent)
    await writeAction(store, 100, "000-deferred-000.json", {
      action: "create-issue",
      title: "Child issue",
      labels: ["kind:impl"],
      body: "body",
    });
    await writeAction(store, 100, "000-deferred-001.json", {
      action: "add-to-project",
      project: { owner: "testorg", number: 1 },
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(100);

    assertEquals(results.length, 2);
    assertEquals(results[0].action, "create-issue");
    assertEquals(results[0].success, true);
    assertEquals(results[1].action, "add-to-project");
    assertEquals(results[1].success, true);

    // Verify addIssueToProject was called with the newly created issue number
    const addCall = github.calls.find((c) => c.method === "addIssueToProject");
    assertEquals(addCall !== undefined, true);
    // createIssue returns 100 (first call)
    assertEquals(addCall!.args[1], 100);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("late-binding: multiple create-issue + add-to-project pairs", async () => {
  const { store, tmp } = await setupStore(101);
  try {
    // Item 0: create + bind
    await writeAction(store, 101, "000-deferred-000.json", {
      action: "create-issue",
      title: "Child A",
      labels: [],
      body: "a",
    });
    await writeAction(store, 101, "000-deferred-001.json", {
      action: "add-to-project",
      project: { owner: "org", number: 1 },
    });
    // Item 1: create + bind
    await writeAction(store, 101, "000-deferred-002.json", {
      action: "create-issue",
      title: "Child B",
      labels: [],
      body: "b",
    });
    await writeAction(store, 101, "000-deferred-003.json", {
      action: "add-to-project",
      project: { owner: "org", number: 1 },
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(101);

    assertEquals(results.length, 4);
    assertEquals(results.every((r) => r.success), true);

    // First add-to-project should use issue 100 (first create)
    const addCalls = github.calls.filter(
      (c) => c.method === "addIssueToProject",
    );
    assertEquals(addCalls.length, 2);
    assertEquals(addCalls[0].args[1], 100); // first create returns 100
    assertEquals(addCalls[1].args[1], 101); // second create returns 101
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("late-binding: explicit issueNumber overrides late-binding", async () => {
  const { store, tmp } = await setupStore(102);
  try {
    await writeAction(store, 102, "000-deferred-000.json", {
      action: "create-issue",
      title: "Child",
      labels: [],
      body: "body",
    });
    await writeAction(store, 102, "000-deferred-001.json", {
      action: "add-to-project",
      project: { owner: "org", number: 1 },
      issueNumber: 42, // explicit — should NOT use late-binding
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(102);

    assertEquals(results.length, 2);
    assertEquals(results.every((r) => r.success), true);

    const addCall = github.calls.find((c) => c.method === "addIssueToProject");
    assertEquals(addCall!.args[1], 42); // explicit overrides late-binding
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("late-binding: add-to-project without preceding create-issue fails", async () => {
  const { store, tmp } = await setupStore(103);
  try {
    // Only add-to-project, no preceding create-issue
    await writeAction(store, 103, "001-bind.json", {
      action: "add-to-project",
      project: { owner: "org", number: 1 },
      // issueNumber absent — and no create-issue in cycle
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(103);

    assertEquals(results.length, 1);
    assertEquals(results[0].success, false);
    assertEquals(
      results[0].error!.includes("late-binding"),
      true,
      "Error message should mention late-binding",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("late-binding: state resets between process() calls", async () => {
  const { store, tmp } = await setupStore(104);
  try {
    // First call: create-issue
    await writeAction(store, 104, "000-deferred-000.json", {
      action: "create-issue",
      title: "First",
      labels: [],
      body: "body",
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    await processor.process(104);

    // Second call: add-to-project without create-issue should fail
    await writeAction(store, 104, "001-bind.json", {
      action: "add-to-project",
      project: { owner: "org", number: 1 },
    });

    const results = await processor.process(104);
    assertEquals(results.length, 1);
    assertEquals(results[0].success, false);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ===========================================================================
// Gap 2: Post-close trigger tests
// ===========================================================================

Deno.test("post-close: process() skips actions with trigger: post-close", async () => {
  const { store, tmp } = await setupStore(200);
  try {
    await writeAction(store, 200, "001-comment.json", {
      action: "comment",
      body: "pre-close comment",
    });
    await writeAction(store, 200, "002-status.json", {
      action: "update-project-item-field",
      project: { owner: "org", number: 1 },
      itemId: "PVTI_123",
      fieldId: "STATUS",
      value: "Done",
      trigger: "post-close",
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(200);

    // Only the comment should be processed
    assertEquals(results.length, 1);
    assertEquals(results[0].action, "comment");
    assertEquals(results[0].success, true);

    // The post-close file should still exist
    const entries: string[] = [];
    for await (const entry of Deno.readDir(store.getOutboxPath(200))) {
      entries.push(entry.name);
    }
    assertEquals(entries, ["002-status.json"]);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("post-close: processPostClose() executes only post-close actions", async () => {
  const { store, tmp } = await setupStore(201);
  try {
    // Mix of pre-close and post-close actions
    await writeAction(store, 201, "001-comment.json", {
      action: "comment",
      body: "pre-close",
    });
    await writeAction(store, 201, "002-status.json", {
      action: "update-project-item-field",
      project: { owner: "org", number: 1 },
      itemId: "PVTI_42",
      fieldId: "STATUS_FIELD",
      value: { optionId: "done-opt" },
      trigger: "post-close",
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);

    // Phase 1: process() runs pre-close actions only
    const preResults = await processor.process(201);
    assertEquals(preResults.length, 1);
    assertEquals(preResults[0].action, "comment");

    // Phase 2: processPostClose() runs post-close actions only
    const postResults = await processor.processPostClose(201);
    assertEquals(postResults.length, 1);
    assertEquals(postResults[0].action, "update-project-item-field");
    assertEquals(postResults[0].success, true);

    // Verify the field update call
    const updateCall = github.calls.find(
      (c) => c.method === "updateProjectItemField",
    );
    assertEquals(updateCall !== undefined, true);
    assertEquals(updateCall!.args[1], "PVTI_42");
    assertEquals(updateCall!.args[2], "STATUS_FIELD");
    assertEquals(updateCall!.args[3], { optionId: "done-opt" });

    // All files should be cleaned up
    const entries: string[] = [];
    for await (const entry of Deno.readDir(store.getOutboxPath(201))) {
      entries.push(entry.name);
    }
    assertEquals(entries, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("post-close: processPostClose() is no-op when no post-close actions", async () => {
  const { store, tmp } = await setupStore(202);
  try {
    await writeAction(store, 202, "001-comment.json", {
      action: "comment",
      body: "normal action",
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);

    // process() handles the normal action
    await processor.process(202);

    // processPostClose() finds nothing
    const postResults = await processor.processPostClose(202);
    assertEquals(postResults, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("post-close: close-project action with post-close trigger", async () => {
  const { store, tmp } = await setupStore(203);
  try {
    await writeAction(store, 203, "001-close-project.json", {
      action: "close-project",
      project: { owner: "org", number: 5 },
      trigger: "post-close",
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);

    // process() skips it
    const preResults = await processor.process(203);
    assertEquals(preResults, []);

    // processPostClose() executes it
    const postResults = await processor.processPostClose(203);
    assertEquals(postResults.length, 1);
    assertEquals(postResults[0].action, "close-project");
    assertEquals(postResults[0].success, true);

    const closeCall = github.calls.find((c) => c.method === "closeProject");
    assertEquals(closeCall!.args[0], { owner: "org", number: 5 });
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ===========================================================================
// New action type validation tests
// ===========================================================================

Deno.test("add-to-project action validation: requires project", async () => {
  const { store, tmp } = await setupStore(300);
  try {
    await writeAction(store, 300, "001-bind.json", {
      action: "add-to-project",
      // missing project
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(300);

    assertEquals(results.length, 1);
    assertEquals(results[0].success, false);
    assertEquals(results[0].error!.includes("project"), true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("add-to-project: project ref by id", async () => {
  const { store, tmp } = await setupStore(301);
  try {
    await writeAction(store, 301, "000-deferred-000.json", {
      action: "create-issue",
      title: "Test",
      labels: [],
      body: "body",
    });
    await writeAction(store, 301, "000-deferred-001.json", {
      action: "add-to-project",
      project: { id: "PVT_abc123" },
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(301);

    assertEquals(results.length, 2);
    assertEquals(results.every((r) => r.success), true);

    const addCall = github.calls.find((c) => c.method === "addIssueToProject");
    assertEquals(addCall!.args[0], { id: "PVT_abc123" });
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("update-project-item-field action validation", async () => {
  const { store, tmp } = await setupStore(302);
  try {
    await writeAction(store, 302, "001-update.json", {
      action: "update-project-item-field",
      project: { owner: "org", number: 1 },
      itemId: "PVTI_1",
      fieldId: "FLD_1",
      value: "In Progress",
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(302);

    assertEquals(results.length, 1);
    assertEquals(results[0].success, true);
    assertEquals(results[0].action, "update-project-item-field");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("close-project action execution", async () => {
  const { store, tmp } = await setupStore(303);
  try {
    await writeAction(store, 303, "001-close.json", {
      action: "close-project",
      project: { owner: "org", number: 3 },
    });

    const github = new SpyGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(303);

    assertEquals(results.length, 1);
    assertEquals(results[0].success, true);

    const call = github.calls.find((c) => c.method === "closeProject");
    assertEquals(call!.args[0], { owner: "org", number: 3 });
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
