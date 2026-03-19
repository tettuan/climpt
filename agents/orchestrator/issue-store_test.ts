import { assertEquals, assertRejects } from "jsr:@std/assert";
import { IssueStore } from "./issue-store.ts";
import type { IssueData } from "./issue-store.ts";

function makeIssueData(number: number): IssueData {
  return {
    meta: {
      number,
      title: `Issue ${number}`,
      labels: ["bug", "priority:high"],
      state: "open",
      assignees: ["alice"],
      milestone: "v1.0",
    },
    body: `Body of issue ${number}`,
    comments: [
      { id: "100", body: "First comment" },
      { id: "200", body: "Second comment" },
    ],
  };
}

Deno.test("writeIssue creates correct directory structure", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeIssue(makeIssueData(42));

    const metaStat = await Deno.stat(`${tmp}/42/meta.json`);
    assertEquals(metaStat.isFile, true);

    const bodyStat = await Deno.stat(`${tmp}/42/body.md`);
    assertEquals(bodyStat.isFile, true);

    const c100 = await Deno.stat(`${tmp}/42/comments/100.md`);
    assertEquals(c100.isFile, true);

    const c200 = await Deno.stat(`${tmp}/42/comments/200.md`);
    assertEquals(c200.isFile, true);

    const outbox = await Deno.stat(`${tmp}/42/outbox`);
    assertEquals(outbox.isDirectory, true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("readMeta returns stored metadata", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const data = makeIssueData(7);
    await store.writeIssue(data);

    const meta = await store.readMeta(7);
    assertEquals(meta, data.meta);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("readBody returns stored body", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const data = makeIssueData(3);
    await store.writeIssue(data);

    const body = await store.readBody(3);
    assertEquals(body, "Body of issue 3");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("readComments returns all comments", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const data = makeIssueData(5);
    await store.writeIssue(data);

    const comments = await store.readComments(5);
    assertEquals(comments.length, 2);
    assertEquals(comments[0], { id: "100", body: "First comment" });
    assertEquals(comments[1], { id: "200", body: "Second comment" });
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("listIssues returns sorted issue numbers", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeIssue(makeIssueData(30));
    await store.writeIssue(makeIssueData(5));
    await store.writeIssue(makeIssueData(12));

    const issues = await store.listIssues();
    assertEquals(issues, [5, 12, 30]);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("listIssues returns empty for empty store", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const issues = await store.listIssues();
    assertEquals(issues, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("updateMeta merges partial updates", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeIssue(makeIssueData(1));

    await store.updateMeta(1, { state: "closed", labels: ["wontfix"] });
    const meta = await store.readMeta(1);
    assertEquals(meta.state, "closed");
    assertEquals(meta.labels, ["wontfix"]);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("updateMeta preserves unchanged fields", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeIssue(makeIssueData(1));

    await store.updateMeta(1, { state: "closed" });
    const meta = await store.readMeta(1);
    assertEquals(meta.number, 1);
    assertEquals(meta.title, "Issue 1");
    assertEquals(meta.labels, ["bug", "priority:high"]);
    assertEquals(meta.assignees, ["alice"]);
    assertEquals(meta.milestone, "v1.0");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("getOutboxPath returns correct path", () => {
  const store = new IssueStore("/data/issues");
  assertEquals(store.getOutboxPath(42), "/data/issues/42/outbox");
});

Deno.test("clearOutbox removes files but keeps directory", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeIssue(makeIssueData(9));

    const outboxDir = store.getOutboxPath(9);
    await Deno.writeTextFile(`${outboxDir}/action.json`, "{}");
    await Deno.writeTextFile(`${outboxDir}/note.md`, "note");

    await store.clearOutbox(9);

    const entries: string[] = [];
    for await (const entry of Deno.readDir(outboxDir)) {
      entries.push(entry.name);
    }
    assertEquals(entries, []);

    const stat = await Deno.stat(outboxDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("writeIssue with empty comments creates no comment files", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const data = makeIssueData(10);
    data.comments = [];
    await store.writeIssue(data);

    const entries: string[] = [];
    for await (const entry of Deno.readDir(`${tmp}/10/comments`)) {
      entries.push(entry.name);
    }
    assertEquals(entries, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("readMeta throws for nonexistent issue", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await assertRejects(
      () => store.readMeta(999),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
