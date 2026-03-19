import { assertEquals } from "jsr:@std/assert";
import type { GitHubClient } from "./github-client.ts";
import type {
  IssueCriteria,
  IssueDetail,
  IssueListItem,
} from "./github-client.ts";
import { IssueStore } from "./issue-store.ts";
import { OutboxProcessor } from "./outbox-processor.ts";

/** Stub GitHubClient that records calls and can be configured to fail. */
class StubGitHubClient implements GitHubClient {
  calls: { method: string; args: unknown[] }[] = [];
  #failOn: Set<string> = new Set();
  #createdIssueNumber = 99;

  failOn(method: string): void {
    this.#failOn.add(method);
  }

  async getIssueLabels(_issueNumber: number): Promise<string[]> {
    return await Promise.resolve([]);
  }

  async updateIssueLabels(
    issueNumber: number,
    labelsToRemove: string[],
    labelsToAdd: string[],
  ): Promise<void> {
    this.calls.push({
      method: "updateIssueLabels",
      args: [issueNumber, labelsToRemove, labelsToAdd],
    });
    if (this.#failOn.has("updateIssueLabels")) {
      throw new Error("updateIssueLabels failed");
    }
    await Promise.resolve();
  }

  async addIssueComment(
    issueNumber: number,
    comment: string,
  ): Promise<void> {
    this.calls.push({
      method: "addIssueComment",
      args: [issueNumber, comment],
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

  async closeIssue(issueNumber: number): Promise<void> {
    this.calls.push({
      method: "closeIssue",
      args: [issueNumber],
    });
    if (this.#failOn.has("closeIssue")) {
      throw new Error("closeIssue failed");
    }
    await Promise.resolve();
  }

  async listIssues(_criteria: IssueCriteria): Promise<IssueListItem[]> {
    return await Promise.resolve([]);
  }

  async getIssueDetail(_issueNumber: number): Promise<IssueDetail> {
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
}

/** Create a temp IssueStore with outbox directory ready. */
async function setupStore(
  issueNumber: number,
): Promise<{ store: IssueStore; tmp: string }> {
  const tmp = await Deno.makeTempDir();
  const store = new IssueStore(tmp);
  const outboxDir = store.getOutboxPath(issueNumber);
  await Deno.mkdir(outboxDir, { recursive: true });
  return { store, tmp };
}

/** Write an outbox action file. */
async function writeAction(
  store: IssueStore,
  issueNumber: number,
  filename: string,
  action: Record<string, unknown>,
): Promise<void> {
  const outboxDir = store.getOutboxPath(issueNumber);
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
    const processor = new OutboxProcessor(github, store);
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
    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(40);

    assertEquals(results.length, 1);
    assertEquals(results[0].action, "close-issue");
    assertEquals(results[0].success, true);

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

    const processor = new OutboxProcessor(github, store);
    const results = await processor.process(60);

    assertEquals(results.length, 2);
    assertEquals(results[0].success, true);
    assertEquals(results[0].action, "comment");
    assertEquals(results[1].success, false);
    assertEquals(results[1].action, "close-issue");
    assertEquals(typeof results[1].error, "string");

    // Outbox should NOT be cleared on partial failure
    const entries: string[] = [];
    for await (const entry of Deno.readDir(store.getOutboxPath(60))) {
      entries.push(entry.name);
    }
    assertEquals(entries.length, 2);
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
