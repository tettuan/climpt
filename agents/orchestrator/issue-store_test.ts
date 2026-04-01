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

Deno.test("acquireLock: stale lock from dead PID is cleaned up", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const lockPath = `${tmp}/.lock.default`;

    // Simulate a leftover lock from a dead process (PID 999999 is very unlikely alive)
    await Deno.mkdir(tmp, { recursive: true });
    await Deno.writeTextFile(
      lockPath,
      JSON.stringify({ pid: 999999, acquiredAt: new Date().toISOString() }),
    );

    // acquireLock should detect dead PID and reclaim
    const lock = await store.acquireLock("default");
    assertEquals(lock !== null, true);
    await lock!.release();
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("acquireLock: corrupt lock file is treated as stale", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const lockPath = `${tmp}/.lock.default`;

    // Write garbage to lock file
    await Deno.mkdir(tmp, { recursive: true });
    await Deno.writeTextFile(lockPath, "not json");

    const lock = await store.acquireLock("default");
    assertEquals(lock !== null, true);
    await lock!.release();
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("acquireLock: lock older than 30 minutes is treated as stale even with alive PID", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const lockPath = `${tmp}/.lock.default`;

    // Simulate a lock from the current process (alive) but 31 minutes old
    const oldTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    await Deno.mkdir(tmp, { recursive: true });
    await Deno.writeTextFile(
      lockPath,
      JSON.stringify({ pid: Deno.pid, acquiredAt: oldTime }),
    );

    // Should detect as stale via timeout and reclaim
    const lock = await store.acquireLock("default");
    assertEquals(lock !== null, true);
    await lock!.release();
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("acquireLock: lock within 30 minutes from alive PID is NOT stale", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const lockPath = `${tmp}/.lock.default`;

    // Simulate a recent lock from the current process (alive, within timeout)
    await Deno.mkdir(tmp, { recursive: true });
    await Deno.writeTextFile(
      lockPath,
      JSON.stringify({ pid: Deno.pid, acquiredAt: new Date().toISOString() }),
    );

    // Should NOT reclaim — PID alive and within timeout
    const lock = await store.acquireLock("default");
    assertEquals(lock, null);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("acquireLock: isProcessAlive uses ps -p (cross-user safe)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const lockPath = `${tmp}/.lock.default`;

    // PID 1 (launchd/init) is always alive but owned by root.
    // With the old kill -0 approach, this would return false (EPERM).
    // With ps -p, it correctly returns true → lock should NOT be reclaimed.
    await Deno.mkdir(tmp, { recursive: true });
    await Deno.writeTextFile(
      lockPath,
      JSON.stringify({ pid: 1, acquiredAt: new Date().toISOString() }),
    );

    const lock = await store.acquireLock("default");
    assertEquals(lock, null);
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

// === Signal / unload cleanup ===

Deno.test("acquireLock: lock file is cleaned up on unload event", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const lock = await store.acquireLock("default");
    assertEquals(lock !== null, true);

    const lockPath = `${tmp}/.lock.default`;
    const stat = await Deno.stat(lockPath);
    assertEquals(stat.isFile, true);

    // Simulate process unload — dispatchEvent fires registered listeners
    globalThis.dispatchEvent(new Event("unload"));

    // Lock file should be removed by unload handler
    await assertRejects(
      () => Deno.stat(lockPath),
      Deno.errors.NotFound,
    );

    // Release after unload is still safe (idempotent)
    await lock!.release();
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("acquireLock: release detaches signal/unload handlers (no leak)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    const lock = await store.acquireLock("default");
    assertEquals(lock !== null, true);

    await lock!.release();

    // Write a new lock file manually
    const lockPath = `${tmp}/.lock.default`;
    await Deno.writeTextFile(
      lockPath,
      JSON.stringify({
        pid: Deno.pid,
        acquiredAt: new Date().toISOString(),
      }),
    );

    // Simulate unload — should NOT remove the manually-written lock
    // because release() already detached the handler
    globalThis.dispatchEvent(new Event("unload"));

    const stat = await Deno.stat(lockPath);
    assertEquals(stat.isFile, true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
