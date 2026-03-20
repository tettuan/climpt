import { assertEquals } from "jsr:@std/assert";
import { Queue } from "./queue.ts";
import type { QueuePriorityConfig } from "./queue.ts";
import { IssueStore } from "./issue-store.ts";
import type { IssueData } from "./issue-store.ts";
import type { WorkflowConfig } from "./workflow-types.ts";

// === Helpers ===

function makeWorkflowConfig(): WorkflowConfig {
  return {
    version: "1",
    phases: {
      ready: { type: "actionable", priority: 1, agent: "writer" },
      review: { type: "actionable", priority: 2, agent: "reviewer" },
      done: { type: "terminal" },
      blocked: { type: "blocking" },
    },
    labelMapping: {
      ready: "ready",
      review: "review",
      done: "done",
      blocked: "blocked",
    },
    agents: {
      writer: { role: "transformer", outputPhase: "review" },
      reviewer: {
        role: "validator",
        outputPhases: { pass: "done", fail: "ready" },
      },
    },
    rules: { maxCycles: 5, cycleDelayMs: 0 },
  };
}

function makePriorityConfig(
  overrides?: Partial<QueuePriorityConfig>,
): QueuePriorityConfig {
  return {
    labels: ["P1", "P2", "P3"],
    ...overrides,
  };
}

function makeIssue(
  number: number,
  labels: string[],
): IssueData {
  return {
    meta: {
      number,
      title: `Issue ${number}`,
      labels,
      state: "open",
      assignees: [],
      milestone: null,
    },
    body: "",
    comments: [],
  };
}

// === Tests ===

Deno.test("buildQueue sorts by priority (P1 first)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeIssue(makeIssue(1, ["ready", "P3"]));
    await store.writeIssue(makeIssue(2, ["ready", "P1"]));
    await store.writeIssue(makeIssue(3, ["ready", "P2"]));

    const queue = new Queue(makeWorkflowConfig(), store, makePriorityConfig());
    const items = await queue.buildQueue();

    assertEquals(items.length, 3);
    assertEquals(items[0].issueNumber, 2);
    assertEquals(items[0].priority, "P1");
    assertEquals(items[1].issueNumber, 3);
    assertEquals(items[1].priority, "P2");
    assertEquals(items[2].issueNumber, 1);
    assertEquals(items[2].priority, "P3");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("buildQueue skips terminal and blocking issues", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeIssue(makeIssue(1, ["ready", "P1"]));
    await store.writeIssue(makeIssue(2, ["done", "P1"]));
    await store.writeIssue(makeIssue(3, ["blocked", "P2"]));

    const queue = new Queue(makeWorkflowConfig(), store, makePriorityConfig());
    const items = await queue.buildQueue();

    assertEquals(items.length, 1);
    assertEquals(items[0].issueNumber, 1);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("buildQueue handles issues without priority label", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeIssue(makeIssue(1, ["ready"]));

    const queue = new Queue(makeWorkflowConfig(), store, makePriorityConfig());
    const items = await queue.buildQueue();

    // No priority label and no defaultLabel => skipped
    assertEquals(items.length, 0);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("buildQueue returns empty for empty store", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);

    const queue = new Queue(makeWorkflowConfig(), store, makePriorityConfig());
    const items = await queue.buildQueue();

    assertEquals(items, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("buildQueue assigns defaultLabel when no priority label found", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeIssue(makeIssue(1, ["ready", "P1"]));
    await store.writeIssue(makeIssue(2, ["ready"]));

    const queue = new Queue(
      makeWorkflowConfig(),
      store,
      makePriorityConfig({ defaultLabel: "P3" }),
    );
    const items = await queue.buildQueue();

    assertEquals(items.length, 2);
    // P1 first, then P3 (default)
    assertEquals(items[0].issueNumber, 1);
    assertEquals(items[0].priority, "P1");
    assertEquals(items[1].issueNumber, 2);
    assertEquals(items[1].priority, "P3");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("buildQueue with scopeIssues filters to specified issues", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeIssue(makeIssue(1, ["ready", "P1"]));
    await store.writeIssue(makeIssue(2, ["ready", "P2"]));
    await store.writeIssue(makeIssue(3, ["ready", "P3"]));

    const queue = new Queue(makeWorkflowConfig(), store, makePriorityConfig());
    const items = await queue.buildQueue([1, 3]);

    assertEquals(items.length, 2);
    assertEquals(items[0].issueNumber, 1);
    assertEquals(items[1].issueNumber, 3);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("buildQueue with empty scopeIssues returns empty queue", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const store = new IssueStore(tmp);
    await store.writeIssue(makeIssue(1, ["ready", "P1"]));

    const queue = new Queue(makeWorkflowConfig(), store, makePriorityConfig());
    const items = await queue.buildQueue([]);

    assertEquals(items.length, 0);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
