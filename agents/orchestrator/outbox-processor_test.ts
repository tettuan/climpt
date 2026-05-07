import { assertEquals } from "jsr:@std/assert";
import type { GitHubClient } from "./github-client.ts";
import type {
  IssueCriteria,
  IssueDetail,
  IssueListItem,
} from "./github-client.ts";
import type { ProjectFieldValue, ProjectRef } from "./outbox-processor.ts";
import type { Project, ProjectField } from "./github-client.ts";
import { SubjectStore } from "./subject-store.ts";
import { OutboxProcessor } from "./outbox-processor.ts";
import { OutboxClosePreChannel } from "../channels/outbox-close-pre.ts";
import { createCloseEventBus } from "../events/bus.ts";
import { createRealCloseTransport } from "../transports/close-transport.ts";

/**
 * Build the OutboxClose-pre channel wired against a real CloseTransport
 * delegating to the supplied stub GitHubClient. Tests that exercise the
 * `close-issue` OutboxAction must pass this channel into the processor
 * (PR4-3 / T4.4b cutover): direct `github.closeIssue` invocation from
 * the processor was deleted, so the channel is the only path that
 * reaches the GitHubClient seam.
 */
function buildOutboxClosePre(
  github: GitHubClient,
): OutboxClosePreChannel {
  const bus = createCloseEventBus();
  const transport = createRealCloseTransport(github);
  const channel = new OutboxClosePreChannel({
    closeTransport: transport,
    bus,
    runId: "test-run-outbox",
  });
  channel.register(bus);
  bus.freeze();
  return channel;
}

/** Stub GitHubClient that records calls and can be configured to fail. */
class StubGitHubClient implements GitHubClient {
  calls: { method: string; args: unknown[] }[] = [];
  #failOn: Set<string> = new Set();
  #createdIssueNumber = 99;

  failOn(method: string): void {
    this.#failOn.add(method);
  }

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
    if (this.#failOn.has("updateIssueLabels")) {
      throw new Error("updateIssueLabels failed");
    }
    await Promise.resolve();
  }

  async addIssueComment(
    subjectId: number,
    comment: string,
  ): Promise<void> {
    this.calls.push({
      method: "addIssueComment",
      args: [subjectId, comment],
    });
    if (this.#failOn.has("addIssueComment")) {
      throw new Error("addIssueComment failed");
    }
    await Promise.resolve();
  }

  async createIssue(
    title: string,
    labels: string[],
    body: string,
  ): Promise<number> {
    this.calls.push({
      method: "createIssue",
      args: [title, labels, body],
    });
    if (this.#failOn.has("createIssue")) {
      throw new Error("createIssue failed");
    }
    return await Promise.resolve(this.#createdIssueNumber);
  }

  async closeIssue(subjectId: number): Promise<void> {
    this.calls.push({
      method: "closeIssue",
      args: [subjectId],
    });
    if (this.#failOn.has("closeIssue")) {
      throw new Error("closeIssue failed");
    }
    await Promise.resolve();
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

  async listLabelsDetailed(): Promise<
    { name: string; color: string; description: string }[]
  > {
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
  removeProjectItem(
    _project: ProjectRef,
    _itemId: string,
  ): Promise<void> {
    this.calls.push({
      method: "removeProjectItem",
      args: [_project, _itemId],
    });
    if (this.#failOn.has("removeProjectItem")) {
      throw new Error("removeProjectItem failed");
    }
    return Promise.resolve();
  }
}

/** Create a temp SubjectStore with outbox directory ready. */
async function setupStore(
  subjectId: number,
): Promise<{ store: SubjectStore; tmp: string }> {
  const tmp = await Deno.makeTempDir();
  const store = new SubjectStore(tmp);
  const outboxDir = store.getOutboxPath(subjectId);
  await Deno.mkdir(outboxDir, { recursive: true });
  return { store, tmp };
}

/** Write an outbox action file. */
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

Deno.test("process empty outbox returns empty results", async () => {
  const { store, tmp } = await setupStore(1);
  try {
    const github = new StubGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(1);
    assertEquals(results, []);
    assertEquals(github.calls.length, 0);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("process single comment action", async () => {
  const { store, tmp } = await setupStore(10);
  try {
    await writeAction(store, 10, "001-comment.json", {
      action: "comment",
      body: "Hello from outbox",
    });

    const github = new StubGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(10);

    assertEquals(results.length, 1);
    assertEquals(results[0].sequence, 1);
    assertEquals(results[0].action, "comment");
    assertEquals(results[0].success, true);
    assertEquals(results[0].error, undefined);

    assertEquals(github.calls.length, 1);
    assertEquals(github.calls[0].method, "addIssueComment");
    assertEquals(github.calls[0].args, [10, "Hello from outbox"]);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("process multiple actions in sequence order", async () => {
  const { store, tmp } = await setupStore(5);
  try {
    await writeAction(store, 5, "003-close.json", {
      action: "close-issue",
    });
    await writeAction(store, 5, "001-comment.json", {
      action: "comment",
      body: "First",
    });
    await writeAction(store, 5, "002-labels.json", {
      action: "update-labels",
      add: ["done"],
      remove: ["in-progress"],
    });

    const github = new StubGitHubClient();
    const processor = new OutboxProcessor(
      github,
      store,
      undefined,
      undefined,
      buildOutboxClosePre(github),
    );
    const results = await processor.process(5);

    assertEquals(results.length, 3);
    assertEquals(results[0].sequence, 1);
    assertEquals(results[0].action, "comment");
    assertEquals(results[1].sequence, 2);
    assertEquals(results[1].action, "update-labels");
    assertEquals(results[2].sequence, 3);
    assertEquals(results[2].action, "close-issue");

    assertEquals(github.calls[0].method, "addIssueComment");
    assertEquals(github.calls[1].method, "updateIssueLabels");
    assertEquals(github.calls[2].method, "closeIssue");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("process create-issue action", async () => {
  const { store, tmp } = await setupStore(20);
  try {
    await writeAction(store, 20, "001-create.json", {
      action: "create-issue",
      title: "Sub-task",
      labels: ["sub", "auto"],
      body: "Created by agent",
    });

    const github = new StubGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(20);

    assertEquals(results.length, 1);
    assertEquals(results[0].action, "create-issue");
    assertEquals(results[0].success, true);

    assertEquals(github.calls[0].method, "createIssue");
    assertEquals(github.calls[0].args, [
      "Sub-task",
      ["sub", "auto"],
      "Created by agent",
    ]);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("process update-labels action", async () => {
  const { store, tmp } = await setupStore(30);
  try {
    await writeAction(store, 30, "001-labels.json", {
      action: "update-labels",
      add: ["reviewed"],
      remove: ["needs-review"],
    });

    const github = new StubGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(30);

    assertEquals(results.length, 1);
    assertEquals(results[0].action, "update-labels");
    assertEquals(results[0].success, true);

    assertEquals(github.calls[0].method, "updateIssueLabels");
    assertEquals(github.calls[0].args, [30, ["needs-review"], ["reviewed"]]);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("process close-issue action", async () => {
  const { store, tmp } = await setupStore(40);
  try {
    await writeAction(store, 40, "001-close.json", {
      action: "close-issue",
    });

    const github = new StubGitHubClient();
    const processor = new OutboxProcessor(
      github,
      store,
      undefined,
      undefined,
      buildOutboxClosePre(github),
    );
    const results = await processor.process(40);

    assertEquals(results.length, 1);
    assertEquals(results[0].action, "close-issue");
    assertEquals(results[0].success, true);

    // PR4-3 (T4.4b cutover): the processor delegates close-issue to the
    // OutboxClose-pre channel which routes through the
    // `createRealCloseTransport(github)` seam → `github.closeIssue(40)`.
    // The transport call surfaces as `closeIssue` on the stub client.
    assertEquals(github.calls[0].method, "closeIssue");
    assertEquals(github.calls[0].args, [40]);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("outbox cleared after successful processing", async () => {
  const { store, tmp } = await setupStore(50);
  try {
    await writeAction(store, 50, "001-comment.json", {
      action: "comment",
      body: "test",
    });

    const github = new StubGitHubClient();
    const processor = new OutboxProcessor(github, store);
    await processor.process(50);

    // Outbox directory should be empty
    const entries: string[] = [];
    for await (const entry of Deno.readDir(store.getOutboxPath(50))) {
      entries.push(entry.name);
    }
    assertEquals(entries, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("partial failure: results reflect both success and failure", async () => {
  const { store, tmp } = await setupStore(60);
  try {
    await writeAction(store, 60, "001-comment.json", {
      action: "comment",
      body: "this succeeds",
    });
    await writeAction(store, 60, "002-close.json", {
      action: "close-issue",
    });

    const github = new StubGitHubClient();
    github.failOn("closeIssue");

    const processor = new OutboxProcessor(
      github,
      store,
      undefined,
      undefined,
      buildOutboxClosePre(github),
    );
    const results = await processor.process(60);

    assertEquals(results.length, 2);
    assertEquals(results[0].success, true);
    assertEquals(results[0].action, "comment");
    assertEquals(results[1].success, false);
    assertEquals(results[1].action, "close-issue");
    assertEquals(typeof results[1].error, "string");

    // Per-file deletion (issue #486): succeeded file removed, only
    // the failed file remains for retry.
    const entries: string[] = [];
    for await (const entry of Deno.readDir(store.getOutboxPath(60))) {
      entries.push(entry.name);
    }
    assertEquals(entries.length, 1);
    assertEquals(entries[0], "002-close.json");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("partial failure retry: succeeded actions not re-executed (issue #486)", async () => {
  const { store, tmp } = await setupStore(65);
  try {
    // Cycle 1: three create-issue actions, last one fails.
    await writeAction(store, 65, "000-deferred-000.json", {
      action: "create-issue",
      title: "Task A",
      labels: ["bug"],
      body: "body-a",
    });
    await writeAction(store, 65, "000-deferred-001.json", {
      action: "create-issue",
      title: "Task B",
      labels: ["bug"],
      body: "body-b",
    });
    await writeAction(store, 65, "000-deferred-002.json", {
      action: "create-issue",
      title: "Task C",
      labels: ["invalid-label"],
      body: "body-c",
    });

    const github = new StubGitHubClient();
    // Make the third createIssue fail (simulates label validation error).
    let createCount = 0;
    const origCreate = github.createIssue.bind(github);
    github.createIssue = async (
      title: string,
      labels: string[],
      body: string,
    ) => {
      createCount++;
      if (createCount === 3) {
        throw new Error("Label not found: invalid-label");
      }
      return await origCreate(title, labels, body);
    };

    const processor = new OutboxProcessor(github, store);
    const results1 = await processor.process(65);

    // Verify cycle 1 results.
    assertEquals(results1.length, 3);
    assertEquals(results1[0].success, true);
    assertEquals(results1[0].filename, "000-deferred-000.json");
    assertEquals(results1[1].success, true);
    assertEquals(results1[1].filename, "000-deferred-001.json");
    assertEquals(results1[2].success, false);
    assertEquals(results1[2].filename, "000-deferred-002.json");

    // Only the failed file should remain.
    const entries1: string[] = [];
    for await (const entry of Deno.readDir(store.getOutboxPath(65))) {
      entries1.push(entry.name);
    }
    entries1.sort();
    assertEquals(entries1, ["000-deferred-002.json"]);

    // Cycle 2: process again (fix simulated — all succeed now).
    const github2 = new StubGitHubClient();
    const processor2 = new OutboxProcessor(github2, store);
    const results2 = await processor2.process(65);

    // Only the previously-failed action should be retried.
    assertEquals(results2.length, 1);
    assertEquals(results2[0].success, true);
    assertEquals(results2[0].filename, "000-deferred-002.json");
    assertEquals(results2[0].action, "create-issue");

    // Verify zero re-execution of succeeded actions from cycle 1.
    assertEquals(github2.calls.length, 1);
    assertEquals(github2.calls[0].args[0], "Task C");

    // Outbox should be empty after all-success cycle 2.
    const entries2: string[] = [];
    for await (const entry of Deno.readDir(store.getOutboxPath(65))) {
      entries2.push(entry.name);
    }
    assertEquals(entries2, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("result includes filename for each action", async () => {
  const { store, tmp } = await setupStore(68);
  try {
    await writeAction(store, 68, "001-comment.json", {
      action: "comment",
      body: "test",
    });
    await writeAction(store, 68, "002-labels.json", {
      action: "update-labels",
      add: ["done"],
      remove: [],
    });

    const github = new StubGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(68);

    assertEquals(results[0].filename, "001-comment.json");
    assertEquals(results[1].filename, "002-labels.json");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("unknown action type produces error result", async () => {
  const { store, tmp } = await setupStore(70);
  try {
    await writeAction(store, 70, "001-unknown.json", {
      action: "do-something-weird",
    });

    const github = new StubGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(70);

    assertEquals(results.length, 1);
    assertEquals(results[0].success, false);
    assertEquals(results[0].action, "do-something-weird");
    assertEquals(typeof results[0].error, "string");
    assertEquals(github.calls.length, 0);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// remove-from-project outbox action
// ---------------------------------------------------------------------------

Deno.test("process remove-from-project action calls removeProjectItem", async () => {
  const { store, tmp } = await setupStore(80);
  try {
    await writeAction(store, 80, "001-remove.json", {
      action: "remove-from-project",
      project: { owner: "org", number: 1 },
      itemId: "PVTI_123",
    });

    const github = new StubGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(80);

    assertEquals(results.length, 1);
    assertEquals(results[0].action, "remove-from-project");
    assertEquals(results[0].success, true);

    assertEquals(github.calls.length, 1);
    assertEquals(github.calls[0].method, "removeProjectItem");
    assertEquals(github.calls[0].args[0], { owner: "org", number: 1 });
    assertEquals(github.calls[0].args[1], "PVTI_123");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("remove-from-project validates itemId is required", async () => {
  const { store, tmp } = await setupStore(81);
  try {
    await writeAction(store, 81, "001-remove.json", {
      action: "remove-from-project",
      project: { owner: "org", number: 1 },
      // itemId intentionally missing
    });

    const github = new StubGitHubClient();
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(81);

    assertEquals(results.length, 1);
    assertEquals(results[0].success, false);
    assertEquals(
      results[0].error,
      "remove-from-project action requires 'itemId' string",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
