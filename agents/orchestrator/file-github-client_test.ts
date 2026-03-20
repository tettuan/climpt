/**
 * Unit tests for FileGitHubClient
 *
 * Verifies that FileGitHubClient correctly reads/writes issue data
 * via IssueStore, matching the GitHubClient interface contract.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { FileGitHubClient } from "./file-github-client.ts";
import { IssueStore } from "./issue-store.ts";

async function withTempStore(
  fn: (store: IssueStore, client: FileGitHubClient) => Promise<void>,
): Promise<void> {
  const tmp = await Deno.makeTempDir();
  const store = new IssueStore(`${tmp}/issues`);
  const client = new FileGitHubClient(store);
  try {
    await fn(store, client);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

async function seedIssue(
  store: IssueStore,
  num: number,
  labels: string[],
  state = "open",
): Promise<void> {
  await store.writeIssue({
    meta: {
      number: num,
      title: `Issue ${num}`,
      labels,
      state,
      assignees: [],
      milestone: null,
    },
    body: `Body of issue ${num}`,
    comments: [],
  });
}

Deno.test("getIssueLabels reads labels from meta.json", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready", "P1"]);
    const labels = await client.getIssueLabels(1);
    assertEquals(labels, ["ready", "P1"]);
  });
});

Deno.test("updateIssueLabels removes and adds labels", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready", "P1"]);
    await client.updateIssueLabels(1, ["ready"], ["review"]);
    const labels = await client.getIssueLabels(1);
    assertEquals(labels, ["P1", "review"]);
  });
});

Deno.test("updateIssueLabels no-op when empty arrays", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready"]);
    await client.updateIssueLabels(1, [], []);
    const labels = await client.getIssueLabels(1);
    assertEquals(labels, ["ready"]);
  });
});

Deno.test("updateIssueLabels does not add duplicates", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready"]);
    await client.updateIssueLabels(1, [], ["ready"]);
    const labels = await client.getIssueLabels(1);
    assertEquals(labels, ["ready"]);
  });
});

Deno.test("listIssues returns all open issues by default", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready"], "open");
    await seedIssue(store, 2, ["done"], "open");
    await seedIssue(store, 3, ["archived"], "closed");
    const items = await client.listIssues({});
    assertEquals(items.length, 2);
    assertEquals(items[0].number, 1);
    assertEquals(items[1].number, 2);
  });
});

Deno.test("listIssues filters by state", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready"], "open");
    await seedIssue(store, 2, ["done"], "closed");
    const closed = await client.listIssues({ state: "closed" });
    assertEquals(closed.length, 1);
    assertEquals(closed[0].number, 2);

    const all = await client.listIssues({ state: "all" });
    assertEquals(all.length, 2);
  });
});

Deno.test("listIssues filters by labels", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready", "P1"]);
    await seedIssue(store, 2, ["ready", "P2"]);
    await seedIssue(store, 3, ["done"]);
    const items = await client.listIssues({ labels: ["ready"] });
    assertEquals(items.length, 2);

    const p1Only = await client.listIssues({ labels: ["ready", "P1"] });
    assertEquals(p1Only.length, 1);
    assertEquals(p1Only[0].number, 1);
  });
});

Deno.test("listIssues respects limit", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready"]);
    await seedIssue(store, 2, ["ready"]);
    await seedIssue(store, 3, ["ready"]);
    const items = await client.listIssues({ limit: 2 });
    assertEquals(items.length, 2);
  });
});

Deno.test("createIssue auto-numbers from max existing + 1", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 5, ["ready"]);
    await seedIssue(store, 10, ["ready"]);
    const num = await client.createIssue("New issue", ["bug"], "Body text");
    assertEquals(num, 11);
    const labels = await client.getIssueLabels(11);
    assertEquals(labels, ["bug"]);
  });
});

Deno.test("createIssue starts at 1 when store is empty", async () => {
  await withTempStore(async (_store, client) => {
    const num = await client.createIssue("First", [], "Body");
    assertEquals(num, 1);
  });
});

Deno.test("closeIssue updates state to closed", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready"], "open");
    await client.closeIssue(1);
    const meta = await store.readMeta(1);
    assertEquals(meta.state, "closed");
  });
});

Deno.test("addIssueComment creates a comment file", async () => {
  await withTempStore(async (store, client) => {
    await seedIssue(store, 1, ["ready"]);
    await client.addIssueComment(1, "Test comment");
    const comments = await store.readComments(1);
    assertEquals(comments.length, 1);
    assertEquals(comments[0].body, "Test comment");
  });
});

Deno.test("getIssueDetail assembles full issue data", async () => {
  await withTempStore(async (store, client) => {
    await store.writeIssue({
      meta: {
        number: 1,
        title: "Test",
        labels: ["ready"],
        state: "open",
        assignees: ["alice"],
        milestone: "v1",
      },
      body: "Issue body",
      comments: [{ id: "001", body: "Comment 1" }],
    });
    const detail = await client.getIssueDetail(1);
    assertEquals(detail.number, 1);
    assertEquals(detail.title, "Test");
    assertEquals(detail.body, "Issue body");
    assertEquals(detail.labels, ["ready"]);
    assertEquals(detail.assignees, ["alice"]);
    assertEquals(detail.milestone, "v1");
    assertEquals(detail.comments.length, 1);
    assertEquals(detail.comments[0].body, "Comment 1");
  });
});

Deno.test("getIssueDetail handles missing comments dir", async () => {
  await withTempStore(async (_store, client) => {
    const tmp = await Deno.makeTempDir();
    const store2 = new IssueStore(`${tmp}/issues`);
    const client2 = new FileGitHubClient(store2);
    // Write meta and body manually without comments dir
    await Deno.mkdir(`${tmp}/issues/1`, { recursive: true });
    await Deno.writeTextFile(
      `${tmp}/issues/1/meta.json`,
      JSON.stringify({
        number: 1,
        title: "No comments",
        labels: [],
        state: "open",
        assignees: [],
        milestone: null,
      }),
    );
    await Deno.writeTextFile(`${tmp}/issues/1/body.md`, "Body");
    const detail = await client2.getIssueDetail(1);
    assertEquals(detail.comments, []);
    await Deno.remove(tmp, { recursive: true });
  });
});

Deno.test("getIssueLabels rejects for missing issue", async () => {
  await withTempStore(async (_store, client) => {
    await assertRejects(
      () => client.getIssueLabels(999),
      Deno.errors.NotFound,
    );
  });
});
