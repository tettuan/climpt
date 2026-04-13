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

// === writeWorkflowState / readWorkflowState ===

Deno.test("writeWorkflowState creates workflow-state.{workflowId}.json", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeWorkflowState(42, {
      issueNumber: 42,
      currentPhase: "review",
      cycleCount: 2,
      correlationId: "wf-test-001",
      history: [
        {
          from: "implementation",
          to: "review",
          agent: "iterator",
          outcome: "success",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
        {
          from: "review",
          to: "revision",
          agent: "reviewer",
          outcome: "rejected",
          timestamp: "2026-01-01T00:01:00.000Z",
        },
      ],
    }, "docs");

    const stat = await Deno.stat(`${tmp}/42/workflow-state.docs.json`);
    assertEquals(stat.isFile, true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("readWorkflowState returns stored state", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const state = {
      issueNumber: 7,
      currentPhase: "review",
      cycleCount: 1,
      correlationId: "wf-test-002",
      history: [
        {
          from: "implementation",
          to: "review",
          agent: "iterator",
          outcome: "success",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    await store.writeWorkflowState(7, state, "default");

    const loaded = await store.readWorkflowState(7, "default");
    assertEquals(loaded, state);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("readWorkflowState returns null for nonexistent issue", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const result = await store.readWorkflowState(999, "default");
    assertEquals(result, null);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("readWorkflowState returns null when issue dir exists but no state file", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeIssue(makeIssueData(5));
    const result = await store.readWorkflowState(5, "default");
    assertEquals(result, null);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("writeWorkflowState overwrites existing state", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeWorkflowState(3, {
      issueNumber: 3,
      currentPhase: "review",
      cycleCount: 1,
      correlationId: "wf-test-old",
      history: [],
    }, "default");
    await store.writeWorkflowState(3, {
      issueNumber: 3,
      currentPhase: "complete",
      cycleCount: 2,
      correlationId: "wf-test-new",
      history: [
        {
          from: "review",
          to: "complete",
          agent: "reviewer",
          outcome: "approved",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ],
    }, "default");

    const loaded = await store.readWorkflowState(3, "default");
    assertEquals(loaded!.currentPhase, "complete");
    assertEquals(loaded!.cycleCount, 2);
    assertEquals(loaded!.correlationId, "wf-test-new");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("different workflowIds do not collide", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeWorkflowState(1, {
      issueNumber: 1,
      currentPhase: "review",
      cycleCount: 1,
      correlationId: "wf-docs",
      history: [],
    }, "docs");
    await store.writeWorkflowState(1, {
      issueNumber: 1,
      currentPhase: "testing",
      cycleCount: 3,
      correlationId: "wf-code",
      history: [],
    }, "code");

    const docs = await store.readWorkflowState(1, "docs");
    const code = await store.readWorkflowState(1, "code");
    assertEquals(docs!.currentPhase, "review");
    assertEquals(docs!.cycleCount, 1);
    assertEquals(code!.currentPhase, "testing");
    assertEquals(code!.cycleCount, 3);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// === writeWorkflowPayload / readWorkflowPayload ===

Deno.test("writeWorkflowPayload creates workflow-payload.{workflowId}.json", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeWorkflowPayload(42, "sample-wf", {
      prNumber: 42,
      verdict: "approved",
      nested: { score: 3 },
    });

    const stat = await Deno.stat(`${tmp}/42/workflow-payload.sample-wf.json`);
    assertEquals(stat.isFile, true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("readWorkflowPayload returns previously written payload", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const payload = {
      prNumber: 7,
      baseBranch: "develop",
      flags: ["alpha", "beta"],
    };
    await store.writeWorkflowPayload(7, "sample-wf", payload);

    const loaded = await store.readWorkflowPayload(7, "sample-wf");
    assertEquals(loaded, payload);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("readWorkflowPayload returns undefined when file is absent", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const result = await store.readWorkflowPayload(999, "missing-wf");
    assertEquals(result, undefined);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("writeWorkflowPayload isolates distinct workflowIds", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeWorkflowPayload(1, "wf-a", { marker: "a" });
    await store.writeWorkflowPayload(1, "wf-b", { marker: "b" });

    const a = await store.readWorkflowPayload(1, "wf-a");
    const b = await store.readWorkflowPayload(1, "wf-b");

    assertEquals(a, { marker: "a" });
    assertEquals(b, { marker: "b" });
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("readWorkflowPayload propagates JSON parse errors", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    // Seed a corrupt payload file
    await Deno.mkdir(`${tmp}/5`, { recursive: true });
    await Deno.writeTextFile(
      `${tmp}/5/workflow-payload.bad-wf.json`,
      "{ not json",
    );

    await assertRejects(() => store.readWorkflowPayload(5, "bad-wf"));
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// === acquireLock ===

Deno.test("acquireLock succeeds and release removes lock file", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const lock = await store.acquireLock("default");
    assertEquals(lock !== null, true);

    // Lock file at store root
    const stat = await Deno.stat(`${tmp}/.lock.default`);
    assertEquals(stat.isFile, true);

    await lock!.release();

    // Lock file should be removed
    await assertRejects(
      () => Deno.stat(`${tmp}/.lock.default`),
      Deno.errors.NotFound,
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("acquireLock returns null when same workflow lock is already held", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const first = await store.acquireLock("default");
    assertEquals(first !== null, true);

    const second = await store.acquireLock("default");
    assertEquals(second, null);

    await first!.release();
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("acquireLock allows reacquisition after release", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);

    const first = await store.acquireLock("default");
    await first!.release();

    const second = await store.acquireLock("default");
    await second!.release();
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("acquireLock: different workflowIds do not conflict", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);

    const lockDocs = await store.acquireLock("docs");
    const lockCode = await store.acquireLock("code");

    assertEquals(lockDocs !== null, true);
    assertEquals(lockCode !== null, true);

    await lockDocs!.release();
    await lockCode!.release();
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// === acquireIssueLock ===

Deno.test("acquireIssueLock: acquire and release", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const lock = await store.acquireIssueLock("default", 42);
    assertEquals(lock !== null, true);
    lock!.release();
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("acquireIssueLock: same issue conflicts", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const first = await store.acquireIssueLock("default", 42);
    assertEquals(first !== null, true);

    const second = await store.acquireIssueLock("default", 42);
    assertEquals(second, null);

    first!.release();
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("acquireIssueLock: different issues do not conflict", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const lock42 = await store.acquireIssueLock("default", 42);
    const lock99 = await store.acquireIssueLock("default", 99);

    assertEquals(lock42 !== null, true);
    assertEquals(lock99 !== null, true);

    lock42!.release();
    lock99!.release();
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("acquireIssueLock: workflow lock and issue lock do not conflict", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const batchLock = await store.acquireLock("default");
    const issueLock = await store.acquireIssueLock("default", 42);

    assertEquals(batchLock !== null, true);
    assertEquals(issueLock !== null, true);

    batchLock!.release();
    issueLock!.release();
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("acquireLock: leftover lock file from dead process can be acquired", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);

    // Simulate a leftover lock file: create it, open+lock it, then close
    // (closing the fd releases the flock but leaves the file on disk)
    const lockPath = `${tmp}/.lock.default`;
    const file = await Deno.open(lockPath, { create: true, write: true });
    await file.lock(true);
    file.unlockSync();
    file.close();

    // A new acquireLock should succeed despite the leftover file
    const lock = await store.acquireLock("default");
    assertEquals(lock !== null, true);
    lock!.release();
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("acquireLock: release is idempotent (double release does not throw)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const lock = await store.acquireLock("default");
    assertEquals(lock !== null, true);

    await lock!.release();
    // Second release — file already gone, should not throw
    await lock!.release();
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
